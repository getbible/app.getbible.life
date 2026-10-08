"use client";

import { useEffect } from "react";

/** Keep the reader's compiled interface available after a successful online visit. */
export function OfflineShell() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const checkForUpdate = () => {
      if (!disposed && document.visibilityState === "visible" && navigator.onLine) {
        void registration?.update().catch(() => undefined);
      }
    };
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((value) => {
      if (!disposed) registration = value;
    }).catch(() => {
      // Reading remains available when private browsing or storage policy denies caching.
    });
    window.addEventListener("online", checkForUpdate);
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => {
      disposed = true;
      window.removeEventListener("online", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);
  return null;
}
