// Threshold for the "Haven't Watched For a While" bucket. TV Time doesn't
// publish an exact number for this, so this is a judgment call: 30 days of
// no watch activity on a followed, in-progress show. Worth revisiting once
// you've used it and have a feel for whether 30 feels too eager or too slow.
export const STALE_DAYS_THRESHOLD = 30;

export function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}
