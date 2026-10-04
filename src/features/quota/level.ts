/**
 * Remaining-capacity level shared by every quota surface: the card meter, the
 * ledger bars, and the summary strip segments.
 *
 * Callers pass the same value the card body feeds `QuotaMeter` (unrounded for
 * every provider except Kimi, whose body rounds first), so a window never reads
 * green in one view and amber in another at a threshold boundary.
 */

export const QUOTA_LEVEL_HIGH_THRESHOLD = 70;
export const QUOTA_LEVEL_MEDIUM_THRESHOLD = 30;

export type QuotaLevel = 'high' | 'medium' | 'low';

export const clampQuotaPercent = (value: number): number => Math.min(100, Math.max(0, value));

export function quotaLevel(remaining: number): QuotaLevel {
  const value = clampQuotaPercent(remaining);
  if (value >= QUOTA_LEVEL_HIGH_THRESHOLD) return 'high';
  if (value >= QUOTA_LEVEL_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}
