/**
 * TMDB's episode_run_time is an array (sometimes with multiple values for
 * shows with varying episode lengths, sometimes empty for shows lacking the
 * data, confirmed on TMDB's own support forum). Average what's there, or
 * null if there's nothing to average, callers must not assume a number.
 */
export function averageRuntime(episodeRunTimes: number[]): number | null {
  if (!episodeRunTimes || episodeRunTimes.length === 0) return null;
  const sum = episodeRunTimes.reduce((a, b) => a + b, 0);
  return sum / episodeRunTimes.length;
}
