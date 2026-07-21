import type { CapacitorConfig } from "@capacitor/cli";

// appId is PERMANENT once the app is published — do not change it after
// release. appName is the Android launcher label; keep it in sync with
// APP_NAME in src/appInfo.ts (the in-app display name).
const config: CapacitorConfig = {
  appId: "com.indie.watchtime",
  appName: "WatchTime",
  // Vite builds to dist/; that's what Capacitor packages as the web layer.
  webDir: "dist",
  android: {
    // Let the WebView draw behind the system bars so our own safe-area
    // CSS (env(safe-area-inset-*)) controls the padding; without this the
    // status bar would clip the header on modern edge-to-edge devices.
    adjustMarginsForEdgeToEdge: "auto",
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: "DARK", // dark icons? no — DARK means dark content; we set the real style at runtime to match our dark theme
    },
  },
};

export default config;
