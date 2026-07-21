import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

/**
 * Live online/offline status. On native it uses Capacitor's Network plugin
 * (navigator.onLine is unreliable inside an Android WebView — it can report
 * "online" with no actual connectivity); on the web build it falls back to
 * the standard online/offline events.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      let remove: (() => void) | undefined;
      Network.getStatus()
        .then((s) => setOnline(s.connected))
        .catch(() => {});
      Network.addListener("networkStatusChange", (s) => setOnline(s.connected))
        .then((h) => {
          remove = () => h.remove();
        })
        .catch(() => {});
      return () => remove?.();
    }

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
