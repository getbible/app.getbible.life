const READY_MESSAGE = "getbible-offline-ready";

/** Confirm the installed worker has the compiled interface as well as Bible data. */
export async function prepareOfflineReader(timeoutMs = 10_000):Promise<boolean> {
  if (!globalThis.isSecureContext || !globalThis.navigator?.serviceWorker || !globalThis.MessageChannel) return false;
  let channel:MessageChannel|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let settled=false;
  const preparation=(async()=>{
    await navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"});
    const registration=await navigator.serviceWorker.ready;
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
  try { return await Promise.race([preparation,timeout]); }
  finally {
    settled=true;
    if (timer!==undefined) clearTimeout(timer);
    channel?.port1.close();channel?.port2.close();
  }
}
