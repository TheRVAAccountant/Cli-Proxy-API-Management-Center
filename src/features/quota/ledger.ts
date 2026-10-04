/**
 * Ledger view logic: provider groups, a frozen row order while loads run, and
 * each row's display state. React-free; consumed by tests/quotaLedger.test.ts.
 */

import { getQuotaCacheKey } from '@/utils/quota/identity';
import { QUOTA_TAB_ORDER } from './constants';
import type { QuotaNotLoadedReason } from './loadController';
import type { QuotaFileEntry } from './logic';
import type { QuotaProviderType } from './providers/types';
import type { QuotaLoadStatus } from './windowProjection';

export interface QuotaLedgerGroup {
  type: QuotaProviderType;
  entries: QuotaFileEntry[];
}

/** Groups in tab order; rows keep their incoming order within a group. */
export function groupLedgerEntries(entries: readonly QuotaFileEntry[]): QuotaLedgerGroup[] {
  const groups = new Map<QuotaProviderType, QuotaFileEntry[]>();
  entries.forEach((entry) => {
    const list = groups.get(entry.type) ?? [];
    list.push(entry);
    groups.set(entry.type, list);
  });
  return QUOTA_TAB_ORDER.filter((type) => groups.has(type)).map((type) => ({
    type,
    entries: groups.get(type) as QuotaFileEntry[],
  }));
}

/**
 * Applies a remembered order: known keys first in that order, then anything new
 * in its incoming order. Soonest-first sorting is recomputed only when a batch
 * drains, so rows do not jump while results arrive.
 */
export function orderEntriesByKeys(
  entries: readonly QuotaFileEntry[],
  order: readonly string[]
): QuotaFileEntry[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  return entries
    .map((entry, index) => ({ entry, index, rank: rank.get(getQuotaCacheKey(entry.file)) }))
    .sort((a, b) => {
      if (a.rank === undefined && b.rank === undefined) return a.index - b.index;
      if (a.rank === undefined) return 1;
      if (b.rank === undefined) return -1;
      return a.rank - b.rank;
    })
    .map((decorated) => decorated.entry);
}

export type LedgerRowState =
  | { kind: 'loaded'; queued: boolean }
  | { kind: 'loading' }
  | { kind: 'queued' }
  | { kind: 'error' }
  | { kind: 'not-loaded'; reason: QuotaNotLoadedReason | null };

export interface LedgerRowStateInput {
  status: QuotaLoadStatus;
  queued: boolean;
  notLoadedReason: QuotaNotLoadedReason | null;
  /** A recognized paid xAI credential, which bulk loads never probe. */
  billableOnly: boolean;
}

export function resolveLedgerRowState(input: LedgerRowStateInput): LedgerRowState {
  if (input.status === 'loading') return { kind: 'loading' };
  // A loaded row waiting for its per-visit reload keeps showing its numbers.
  if (input.status === 'success') return { kind: 'loaded', queued: input.queued };
  if (input.queued) return { kind: 'queued' };
  if (input.status === 'error') return { kind: 'error' };
  return {
    kind: 'not-loaded',
    reason: input.notLoadedReason ?? (input.billableOnly ? 'billable' : null),
  };
}
