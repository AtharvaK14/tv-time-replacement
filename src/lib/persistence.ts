// Storage durability helpers (Play Store prep, Phase 0).
//
// IndexedDB and localStorage are "best-effort" storage by default: the
// browser/OS may evict them under storage pressure, and an Android WebView
// is no exception. navigator.storage.persist() asks the browser to upgrade
// this origin to persistent storage. Chrome (and the Android WebView) decide
// silently based on engagement heuristics, there is no user prompt, so a
// denial on early runs is normal, not an error. Even "granted" does not
// survive the user tapping "Clear data" or uninstalling, which is why
// backup/restore (backup.ts) exists no matter what this reports.

export type PersistStatus = "granted" | "denied" | "unsupported";

const PERSIST_STATUS_KEY = "storage_persist_status";
const LAST_BACKUP_AT_KEY = "last_backup_at";
const NUDGE_SNOOZED_UNTIL_KEY = "backup_nudge_snoozed_until";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days without a backup before the nudge banner appears. */
export const BACKUP_OVERDUE_DAYS = 30;
/** How long "dismiss" hides the nudge. The underlying risk doesn't go away, so it's a snooze, not a kill switch. */
const NUDGE_SNOOZE_DAYS = 7;
/** A backup this recent counts as mitigation for denied persistence, so the banner doesn't nag daily-backer users forever. */
const FRESH_BACKUP_SUPPRESSES_DENIAL_DAYS = 7;

/** Fired on window after an export or restore updates the last-backup timestamp. */
export const BACKUP_COMPLETED_EVENT = "backup-completed";
/** Fired on window after a restore writes API keys to localStorage, so mounted key fields can re-read them. */
export const API_KEYS_CHANGED_EVENT = "api-keys-changed";

export async function initStoragePersistence(): Promise<PersistStatus> {
  let status: PersistStatus;
  if (!navigator.storage?.persist || !navigator.storage.persisted) {
    status = "unsupported";
  } else {
    try {
      const already = await navigator.storage.persisted();
      status = already || (await navigator.storage.persist()) ? "granted" : "denied";
    } catch {
      // An API failure means we cannot claim the data is protected. Report
      // "denied" rather than "unsupported" so the UI fails toward warning
      // the user, never toward false reassurance.
      status = "denied";
    }
  }
  localStorage.setItem(PERSIST_STATUS_KEY, status);
  return status;
}

export function getStoredPersistStatus(): PersistStatus | null {
  const v = localStorage.getItem(PERSIST_STATUS_KEY);
  return v === "granted" || v === "denied" || v === "unsupported" ? v : null;
}

export async function getStorageEstimate(): Promise<{ usageMB: number; quotaMB: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage === undefined || quota === undefined) return null;
    return { usageMB: usage / (1024 * 1024), quotaMB: quota / (1024 * 1024) };
  } catch {
    return null;
  }
}

// ---- Backup recency / nudge -------------------------------------------------

export function getLastBackupAt(): string | null {
  return localStorage.getItem(LAST_BACKUP_AT_KEY);
}

/**
 * Records that the current data provably exists in a file dated exportedAt.
 * Called after an export, and also after a restore: the file just restored
 * FROM is itself a valid backup of the now-current data. Only moves forward,
 * so restoring an old file never regresses a newer backup timestamp.
 */
export function recordBackupCompleted(exportedAt: string): void {
  const current = getLastBackupAt();
  if (!current || exportedAt > current) {
    localStorage.setItem(LAST_BACKUP_AT_KEY, exportedAt);
  }
  window.dispatchEvent(new Event(BACKUP_COMPLETED_EVENT));
}

export function snoozeBackupNudge(): void {
  const until = new Date(Date.now() + NUDGE_SNOOZE_DAYS * DAY_MS).toISOString();
  localStorage.setItem(NUDGE_SNOOZED_UNTIL_KEY, until);
}

export type NudgeReason = "persist-denied" | "overdue";

/**
 * Whether to show the backup nudge banner, and which message variant.
 * Only nudges when there is actually data to lose. "Never backed up at all"
 * counts as overdue immediately: the brief said 30 days since last backup,
 * but a multi-thousand-episode library with zero backups ever is the
 * maximum-risk case, not a wait-30-days case. Unguaranteed storage
 * (denied/unsupported) triggers the banner too, unless a backup exists
 * recent enough to count as mitigation.
 */
export function shouldShowBackupNudge(
  persistStatus: PersistStatus | null,
  hasAnyLibraryData: boolean
): { show: boolean; reason: NudgeReason | null } {
  if (!hasAnyLibraryData) return { show: false, reason: null };

  const snoozedUntil = localStorage.getItem(NUDGE_SNOOZED_UNTIL_KEY);
  if (snoozedUntil && snoozedUntil > new Date().toISOString()) return { show: false, reason: null };

  const last = getLastBackupAt();
  const ageMs = last ? Date.now() - new Date(last).getTime() : Infinity;

  const persistAtRisk = persistStatus === "denied" || persistStatus === "unsupported";
  if (persistAtRisk && ageMs > FRESH_BACKUP_SUPPRESSES_DENIAL_DAYS * DAY_MS) {
    return { show: true, reason: "persist-denied" };
  }
  if (ageMs > BACKUP_OVERDUE_DAYS * DAY_MS) {
    return { show: true, reason: "overdue" };
  }
  return { show: false, reason: null };
}
