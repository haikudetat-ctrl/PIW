// Per-user cap on uncached Google Solar calls from the roof measuring page.
// In memory, so it resets when a server instance recycles and is counted per
// instance: a guard against a runaway loop or a stuck button, not billing
// protection. Google's own quota on the key is the hard stop.

export const LIVE_SOLAR_CALLS_PER_HOUR = 60;
const WINDOW_MS = 60 * 60 * 1000;

export function createLiveCallLimiter(limit = LIVE_SOLAR_CALLS_PER_HOUR, now: () => number = Date.now) {
  const calls = new Map<string, number[]>();
  return {
    tryConsume(userId: string) {
      const cutoff = now() - WINDOW_MS;
      const recent = (calls.get(userId) ?? []).filter((at) => at > cutoff);
      if (recent.length >= limit) {
        calls.set(userId, recent);
        return false;
      }
      recent.push(now());
      calls.set(userId, recent);
      return true;
    },
  };
}

export const liveSolarCallLimiter = createLiveCallLimiter();
