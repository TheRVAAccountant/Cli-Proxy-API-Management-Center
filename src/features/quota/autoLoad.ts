/**
 * Which credentials a bulk quota load may touch.
 *
 * React-free; consumed by tests/quotaAutoLoad.test.ts.
 */

import { isPaidXaiAuthFile } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from './logic';
import type { QuotaLoadStatus } from './windowProjection';

export interface QuotaListSettledInput {
  connected: boolean;
  loading: boolean;
  hasError: boolean;
  filesGeneration: number | null;
  sessionGeneration: number;
}

/**
 * The credential list belongs to this session and finished loading. Until then no
 * quota request may go out: a failed list call is the cheapest place to learn the
 * management key stopped working, before a fan-out burns the backend's ban budget.
 */
export const isQuotaListSettled = (input: QuotaListSettledInput): boolean =>
  input.connected &&
  !input.loading &&
  !input.hasError &&
  input.filesGeneration === input.sessionGeneration;

/**
 * Bulk loads skip disabled credentials and recognized paid xAI ones: probing a paid
 * xAI account sends a billable chat completion, which only its own row action may do.
 */
export const isExcludedFromBulkLoad = (entry: QuotaFileEntry): boolean =>
  entry.file.disabled === true || (entry.type === 'xai' && isPaidXaiAuthFile(entry.file));

export interface QuotaEligibilityContext {
  statusFor: (entry: QuotaFileEntry) => QuotaLoadStatus;
  /** Queued or in flight in the load queue. */
  isPending: (key: string) => boolean;
  /** Load already started during this visit, by any trigger. */
  wasAttempted: (key: string) => boolean;
}

/**
 * Automatic loads: one attempt per credential per visit, whatever it showed before.
 * Errors are not retried automatically within the visit; header Refresh retries them.
 */
export function selectAutoLoadTargets(
  entries: readonly QuotaFileEntry[],
  context: QuotaEligibilityContext
): QuotaFileEntry[] {
  return entries.filter((entry) => {
    const key = getQuotaCacheKey(entry.file);
    return (
      !isExcludedFromBulkLoad(entry) &&
      !context.wasAttempted(key) &&
      !context.isPending(key) &&
      context.statusFor(entry) !== 'loading'
    );
  });
}

/** Header Refresh: every credential a bulk load may touch, including loaded and errored ones. */
export function selectRefreshTargets(
  entries: readonly QuotaFileEntry[],
  context: Pick<QuotaEligibilityContext, 'statusFor'>
): QuotaFileEntry[] {
  return entries.filter(
    (entry) => !isExcludedFromBulkLoad(entry) && context.statusFor(entry) !== 'loading'
  );
}
