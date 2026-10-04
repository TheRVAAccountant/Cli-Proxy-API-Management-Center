/**
 * Sorts quota load failures by where they came from, so one bad credential
 * never halts loading for the rest.
 *
 * Management failures arrive as `ApiError` from the management client; upstream
 * provider failures arrive as plain status errors from each fetcher's
 * `createStatusError` (the api-call proxy answers HTTP 200 and carries the
 * upstream status in its body). Only failures that affect every credential stop
 * the queue:
 * - management 401: the client already logs out and the session generation bumps;
 * - management 403 (the backend's IP ban) or a request that never reached it;
 * Everything else, including the api-call proxy's own per-credential 400/502
 * errors and request timeouts, stays on its row. An upstream 429 pauses only
 * that provider for the rest of the batch.
 */

import { isStaleConnectionError, readManagementFailure } from '@/services/api/requestLimiter';
import { getStatusFromError } from '@/utils/quota';

export type QuotaFailureClass =
  'management-auth' | 'management-stop' | 'stale-connection' | 'rate-limited' | 'row';

const isManagementError = (error: unknown): error is Error & { status?: number } =>
  error instanceof Error && error.name === 'ApiError';

export function classifyQuotaFailure(error: unknown): QuotaFailureClass {
  if (isStaleConnectionError(error)) return 'stale-connection';
  if (isManagementError(error)) {
    if (error.status === 401) return 'management-auth';
    if (readManagementFailure(error)) return 'management-stop';
    return 'row';
  }
  if (getStatusFromError(error) === 429) return 'rate-limited';
  return 'row';
}
