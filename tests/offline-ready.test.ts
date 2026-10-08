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
