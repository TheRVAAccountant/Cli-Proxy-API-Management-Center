import { describe, expect, test } from 'bun:test';
import { classifyQuotaFailure } from '@/features/quota/quotaErrors';
import { StaleConnectionError } from '@/services/api/requestLimiter';
import { createStatusError } from '@/utils/quota';

const apiError = (fields: { status?: number; code?: string; apiCode?: string }) =>
  Object.assign(new Error('failed'), { name: 'ApiError', ...fields });

describe('quota failure classification', () => {
  test('a management 401 defers to the existing logout path', () => {
    expect(classifyQuotaFailure(apiError({ status: 401 }))).toBe('management-auth');
  });

  test('a management 403 or an unreachable backend stops the queue', () => {
    expect(classifyQuotaFailure(apiError({ status: 403 }))).toBe('management-stop');
    expect(classifyQuotaFailure(apiError({ code: 'ERR_NETWORK' }))).toBe('management-stop');
  });

  test("the api-call proxy's per-credential errors and timeouts stay on their row", () => {
    expect(
      classifyQuotaFailure(apiError({ status: 400, apiCode: 'auth token refresh failed' }))
    ).toBe('row');
    expect(classifyQuotaFailure(apiError({ status: 502, apiCode: 'request failed' }))).toBe('row');
    expect(classifyQuotaFailure(apiError({ status: 404 }))).toBe('row');
    expect(classifyQuotaFailure(apiError({ code: 'ECONNABORTED' }))).toBe('row');
  });

  test('upstream statuses classify by provider meaning', () => {
    expect(classifyQuotaFailure(createStatusError('expired', 401))).toBe('row');
    expect(classifyQuotaFailure(createStatusError('forbidden', 403))).toBe('row');
    expect(classifyQuotaFailure(createStatusError('slow down', 429))).toBe('rate-limited');
    expect(classifyQuotaFailure(new Error('parse failed'))).toBe('row');
    expect(classifyQuotaFailure('weird')).toBe('row');
  });

  test('a request dropped for a replaced connection is neither a row error nor a stop', () => {
    expect(classifyQuotaFailure(new StaleConnectionError())).toBe('stale-connection');
  });
});
