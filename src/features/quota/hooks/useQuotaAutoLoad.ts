/**
 * Loads quota automatically for every eligible credential once the credential
 * list settles: one attempt per credential per visit (the loader tracks attempts
 * per mount and session). Replaces Devin's separate auto-load hook, which would
 * otherwise fetch Devin credentials twice.
 */

import { useEffect } from 'react';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { selectAutoLoadTargets } from '../autoLoad';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaMap } from '../providers';
import type { QuotaLoadStatus } from '../windowProjection';
import type { QuotaLoadTrigger } from './useQuotaBatchLoader';

export interface QuotaAutoLoadOptions {
  entries: readonly QuotaFileEntry[];
  settled: boolean;
  sessionGeneration: number;
  loadQuota: (targets: readonly QuotaFileEntry[], trigger: QuotaLoadTrigger) => void;
  isPendingNow: (key: string) => boolean;
  wasAttempted: (key: string) => boolean;
}

/** Reads the store directly so quota updates never re-run the auto-load effect. */
export const readStoredQuotaStatus = (entry: QuotaFileEntry): QuotaLoadStatus =>
  getQuotaMap(QUOTA_ADAPTERS[entry.type])[getQuotaCacheKey(entry.file)]?.status ?? 'idle';

export function useQuotaAutoLoad({
  entries,
  settled,
  sessionGeneration,
  loadQuota,
  isPendingNow,
  wasAttempted,
}: QuotaAutoLoadOptions) {
  useEffect(() => {
    if (!settled) return;
    const targets = selectAutoLoadTargets(entries, {
      statusFor: readStoredQuotaStatus,
      isPending: isPendingNow,
      wasAttempted,
    });
    if (targets.length > 0) loadQuota(targets, 'auto');
  }, [entries, isPendingNow, loadQuota, sessionGeneration, settled, wasAttempted]);
}
