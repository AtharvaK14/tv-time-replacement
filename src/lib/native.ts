import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { runTopBackHandler } from "./backHandler";

/**
 * One-time native setup for the Capacitor Android shell. A no-op on the web
 * build (Capacitor.isNativePlatform() is false there), so importing and
 * calling this unconditionally from App is safe.
 *
 * @param onRootBack Called when the back button is pressed and no overlay
 *   handled it. Should navigate toward Home and return true; return false
 *   only when already at the root, which lets the app exit.
 * @returns a cleanup that removes the back-button listener.
 */
export function initNative(onRootBack: () => boolean): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  // Status bar: the app is dark-themed, so use light content. Style.Dark
  // means "light text/icons for a dark background" in Capacitor's API.
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  // Draw behind the status bar so our safe-area CSS controls the inset.
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});

  const listener = CapacitorApp.addListener("backButton", () => {
    // 1) Let the topmost open overlay consume the press.
    if (runTopBackHandler()) return;
    // 2) Otherwise go toward Home; if already there, exit the app.
    if (!onRootBack()) CapacitorApp.exitApp();
  });

  return () => {
    listener.then((h) => h.remove()).catch(() => {});
  };
}
