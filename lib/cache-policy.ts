/** Revalidate API data monthly, keeping the previous copy usable until refresh succeeds. */
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export function isCacheFresh(savedAt:number, now=Date.now()):boolean {
  return Number.isFinite(savedAt) && savedAt > 0 && savedAt <= now && now - savedAt < CACHE_MAX_AGE_MS;
}
