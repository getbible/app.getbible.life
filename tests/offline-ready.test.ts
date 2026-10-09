import assert from "node:assert/strict";
import test from "node:test";
import { prepareOfflineReader } from "../lib/offline-ready.ts";

function browser(t:{after:(fn:()=>void)=>void},worker:unknown) {
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,"navigator");
  const secureDescriptor=Object.getOwnPropertyDescriptor(globalThis,"isSecureContext");
  Object.defineProperty(globalThis,"navigator",{value:{serviceWorker:worker},configurable:true});
  Object.defineProperty(globalThis,"isSecureContext",{value:true,configurable:true});
  t.after(()=>{
    if(navigatorDescriptor) Object.defineProperty(globalThis,"navigator",navigatorDescriptor);else Reflect.deleteProperty(globalThis,"navigator");
    if(secureDescriptor) Object.defineProperty(globalThis,"isSecureContext",secureDescriptor);else Reflect.deleteProperty(globalThis,"isSecureContext");
  });
}

test("offline preparation requires the active worker to confirm a complete shell",async(t)=>{
  let complete=true;
  const registrations:unknown[]=[];
  const active={postMessage(message:unknown,ports:MessagePort[]) {assert.deepEqual(message,{type:"getbible-offline-ready"});ports[0].postMessage({type:"getbible-offline-ready",ready:complete});}};
  browser(t,{register:async(...args:unknown[])=>{registrations.push(args);},ready:Promise.resolve({active})});
  assert.equal(await prepareOfflineReader(100),true);
  complete=false;
  assert.equal(await prepareOfflineReader(100),false);
  assert.deepEqual(registrations,[ ["/sw.js",{scope:"/",updateViaCache:"none"}], ["/sw.js",{scope:"/",updateViaCache:"none"}] ]);
});

test("failed or stalled service-worker installation never leaves download status waiting",async(t)=>{
  browser(t,{register:async()=>undefined,ready:new Promise(()=>undefined)});
  assert.equal(await prepareOfflineReader(5),false);
  Object.defineProperty(globalThis,"navigator",{value:{serviceWorker:{register:async()=>{throw new Error("Storage unavailable");}}},configurable:true});
  assert.equal(await prepareOfflineReader(100),false);
});

test("unsupported browsers report that the interface could not be prepared",async(t)=>{
  browser(t,undefined);
  assert.equal(await prepareOfflineReader(5),false);
});

test("a cancelled download stops waiting for interface installation immediately",async(t)=>{
  browser(t,{register:async()=>undefined,ready:new Promise(()=>undefined)});
  const controller=new AbortController(),ready=prepareOfflineReader(10_000,controller.signal);
  controller.abort();
  await assert.rejects(ready,{name:"AbortError"});
});

test("offline preparation waits for an installed update rather than approving the previous shell",async(t)=>{
  let state:ServiceWorkerState="installing",changed:(()=>void)|undefined,oldMessages=0,newMessages=0;
  const oldWorker={postMessage() {oldMessages++;}};
  const latestWorker={postMessage(_message:unknown,ports:MessagePort[]) {newMessages++;ports[0].postMessage({type:"getbible-offline-ready",ready:true});}};
  const update={get state(){return state;},addEventListener(_event:string,listener:()=>void){changed=listener;},removeEventListener(){changed=undefined;}};
  const registration:{active:typeof oldWorker|typeof latestWorker;installing:typeof update}={active:oldWorker,installing:update};
  browser(t,{register:async()=>registration,ready:Promise.resolve(registration)});
  const ready=prepareOfflineReader(100);
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(oldMessages,0);assert.equal(newMessages,0);
  registration.active=latestWorker;state="activated";changed?.();
  assert.equal(await ready,true);assert.equal(oldMessages,0);assert.equal(newMessages,1);assert.equal(changed,undefined);
});
