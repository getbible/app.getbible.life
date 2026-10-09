const READY_MESSAGE = "getbible-offline-ready";

/** Confirm the installed worker has the compiled interface as well as Bible data. */
export async function prepareOfflineReader(timeoutMs = 10_000,signal?:AbortSignal):Promise<boolean> {
  signal?.throwIfAborted();
  if (!globalThis.isSecureContext || !globalThis.navigator?.serviceWorker || !globalThis.MessageChannel) return false;
  let channel:MessageChannel|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let removeListener:(()=>void)|undefined;
  let abort:(()=>void)|undefined;
  let settled=false;
  const preparation=(async()=>{
    const registered=await navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"});
    const registration=registered || await navigator.serviceWorker.ready;
    const update=registration.installing || registration.waiting;
    if (update && update.state!=="activated") {
      const activated=await new Promise<boolean>(resolve=>{
        const changed=()=>{
          if (update.state==="activated" || update.state==="redundant") resolve(update.state==="activated");
        };
        removeListener=()=>update.removeEventListener("statechange",changed);
        update.addEventListener("statechange",changed);changed();
      });
      if (!activated) return false;
    }
    if (settled || !registration.active) return false;
    channel=new MessageChannel();
    return await new Promise<boolean>((resolve)=>{
      channel!.port1.onmessage=(event:MessageEvent)=>{
        resolve(event.data?.type===READY_MESSAGE && event.data.ready===true);
      };
      registration.active!.postMessage({type:READY_MESSAGE},[channel!.port2]);
    });
  })().catch(()=>false);
  const timeout=new Promise<boolean>((resolve)=>{timer=setTimeout(()=>resolve(false),Math.max(1,timeoutMs));});
  const cancelled=new Promise<boolean>((_resolve,reject)=>{
    abort=()=>reject(signal?.reason ?? new DOMException("Aborted","AbortError"));
    signal?.addEventListener("abort",abort,{once:true});
  });
  try { return await Promise.race([preparation,timeout,cancelled]); }
  finally {
    settled=true;
    if (timer!==undefined) clearTimeout(timer);
    removeListener?.();
    if(abort) signal?.removeEventListener("abort",abort);
    channel?.port1.close();channel?.port2.close();
  }
}
