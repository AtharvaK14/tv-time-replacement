// Single source of truth for the app's display name, so the header, the
// About screen, and anywhere else it appears never drift apart.
//
// NOTE (Play Store prep): this display name is still PROVISIONAL. "WatchTime"
// collides with an existing Play Store app (WatchTime magazine,
// com.ebnerverlag.watchtime), so it is expected to change before release —
// changing it here updates every in-app surface at once. The Capacitor
// appId is a SEPARATE, permanent identifier set in the native Android
// config during Phase 4, not here; the two are chosen independently.
export const APP_NAME = "WatchTime";
