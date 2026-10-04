/**
 * Summary strip math: per-provider totals over projected window cells.
 *
 * A total is the sum of each reporting credential's displayed (rounded)
 * remaining percent, so the strip always equals the arithmetic visible in the
 * rows (58 + 100 + 100 + 51 + 100 = 409). The denominator is 100 × the
 * credentials the window applies to or whose data is still unknown; a loaded
 * credential that simply lacks the window is left out. Without any reporting
 * credential the total is null and renders as "--".
 *
 * Totals are equal-weighted: they approximate capacity only when a provider's
 * credentials share a plan tier.
 */

import { quotaLevel, type QuotaLevel } from './level';
import type { QuotaProviderType } from './providers/types';
import { displayPercent, type CredentialQuotaProjection } from './windowProjection';
import { findCell, pickSummaryWindows, type WindowMatcher } from './windowSpecs';

/** Above this many credentials the bar shows level bands instead of one segment each. */
export const SUMMARY_SEGMENT_LIMIT = 40;

export type SummarySegmentLevel = QuotaLevel | 'no-data';

export interface SummaryCredential {
  /** Quota cache key; also keys the segment. */
  key: string;
  projection: CredentialQuotaProjection;
}

export interface SummarySegment {
  key: string;
  level: SummarySegmentLevel;
  /** Displayed remaining percent, or null for no data. */
  remaining: number | null;
}

export interface SummaryBand {
  level: SummarySegmentLevel;
  count: number;
}

export interface SummaryWindowTotal {
  label: string | null;
  /** Sum of displayed remaining percents, or null when no credential reports. */
  total: number | null;
  denominator: number;
  reporting: number;
  segments: SummarySegment[] | null;
  bands: SummaryBand[] | null;
  /** Soonest future reset among the counted credentials. */
  earliestResetAtMs: number | null;
}

export interface ProviderSummary {
  provider: QuotaProviderType;
  credentialCount: number;
  /** Credentials whose quota has loaded; below credentialCount the strip says "k/N reporting". */
  loadedCount: number;
  primary: SummaryWindowTotal | null;
  secondary: SummaryWindowTotal | null;
  /** Other reported windows, revealed by Show. */
  revealed: SummaryWindowTotal[];
}

const BAND_ORDER: readonly SummarySegmentLevel[] = ['high', 'medium', 'low', 'no-data'];

export function summarizeWindow(
  credentials: readonly SummaryCredential[],
  matcher: WindowMatcher,
  now: number
): SummaryWindowTotal {
  let total: number | null = null;
  let reporting = 0;
  let label: string | null = null;
  let earliestResetAtMs: number | null = null;
  const segments: SummarySegment[] = [];

  credentials.forEach(({ key, projection }) => {
    const cell = findCell(projection.cells, matcher);
    // A loaded credential without this window is not part of its pool.
    if (projection.status === 'success' && !cell) return;

    const remaining = cell ? displayPercent(cell.remaining) : null;
    if (cell && label === null) label = cell.label;
    if (remaining !== null) {
      total = (total ?? 0) + remaining;
      reporting += 1;
    }
    if (cell?.resetAtMs != null && cell.resetAtMs > now) {
      earliestResetAtMs =
        earliestResetAtMs === null ? cell.resetAtMs : Math.min(earliestResetAtMs, cell.resetAtMs);
    }
    segments.push({
      key,
      remaining,
      level:
        remaining === null || cell?.levelValue == null ? 'no-data' : quotaLevel(cell.levelValue),
    });
  });

  const banded = segments.length > SUMMARY_SEGMENT_LIMIT;
  return {
    label,
    total,
    denominator: segments.length * 100,
    reporting,
    segments: banded ? null : segments,
    bands: banded
      ? BAND_ORDER.map((level) => ({
          level,
          count: segments.filter((segment) => segment.level === level).length,
        })).filter((band) => band.count > 0)
      : null,
    earliestResetAtMs,
  };
}

export function buildProviderSummary(
  provider: QuotaProviderType,
  credentials: readonly SummaryCredential[],
  now: number
): ProviderSummary {
  const projections = credentials.map((credential) => credential.projection);
  const pick = pickSummaryWindows(provider, projections);
  return {
    provider,
    credentialCount: credentials.length,
    loadedCount: projections.filter((projection) => projection.status === 'success').length,
    primary: pick.primary === null ? null : summarizeWindow(credentials, pick.primary, now),
    secondary: pick.secondary === null ? null : summarizeWindow(credentials, pick.secondary, now),
    revealed: pick.revealable.map((id) => summarizeWindow(credentials, id, now)),
  };
}

/** Summaries for every provider that has credentials, in the given provider order. */
export function buildProviderSummaries(
  providerOrder: readonly QuotaProviderType[],
  credentialsByProvider: ReadonlyMap<QuotaProviderType, readonly SummaryCredential[]>,
  now: number
): ProviderSummary[] {
  return providerOrder
    .map((provider) => ({ provider, credentials: credentialsByProvider.get(provider) ?? [] }))
    .filter(({ credentials }) => credentials.length > 0)
    .map(({ provider, credentials }) => buildProviderSummary(provider, credentials, now));
}
