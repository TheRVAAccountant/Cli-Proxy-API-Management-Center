import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  BULK_FETCH_OPTIONS,
  BillableProbeBlockedError,
  SINGLE_CREDENTIAL_FETCH_OPTIONS,
  allowsBillableProbe,
  isBillableProbeBlockedError,
  type QuotaFetchOptions,
} from '@/features/quota/providers/fetchOptions';
import { XAI_CONFIG } from '@/features/quota/providers/xai/data';
import { apiCallApi, type ApiCallRequest, type ApiCallResult } from '@/services/api';
import {
  XAI_API_CHAT_URL,
  XAI_API_ME_URL,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
} from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const originalApiCallRequest = apiCallApi.request;

const result = (statusCode: number, body: unknown = null): ApiCallResult => ({
  statusCode,
  header: {},
  bodyText: body === null ? '' : JSON.stringify(body),
  body,
});

const paidFile = {
  name: 'paid.json',
  type: 'xai',
  auth_index: 'xai:paid',
  using_api: true,
  prefix: 'paid',
};
const listedFile = { name: 'listed.json', type: 'xai', auth_index: 'xai:listed' };

describe('xAI billable-probe guard', () => {
  let requests: ApiCallRequest[];

  beforeEach(() => {
    requests = [];
  });

  afterEach(() => {
    apiCallApi.request = originalApiCallRequest;
  });

  const respondWith = (billingStatus: number) => {
    apiCallApi.request = async (payload) => {
      requests.push(payload);
      if (payload.url === XAI_BILLING_WEEKLY_URL || payload.url === XAI_BILLING_MONTHLY_URL) {
        return result(billingStatus, { error: 'denied' });
      }
      if (payload.url === XAI_API_ME_URL) return result(200, { user_id: 'user-1' });
      return result(200, { choices: [] });
    };
  };

  test('blocks a recognized paid credential in bulk without sending any request', async () => {
    respondWith(403);
    const error = await XAI_CONFIG.fetchQuota(paidFile, t, BULK_FETCH_OPTIONS).catch(
      (err: unknown) => err
    );

    expect(isBillableProbeBlockedError(error)).toBe(true);
    expect((error as Error).message).toBe('xai_quota.billable_probe_blocked');
    expect(requests).toEqual([]);
  });

  test('sends the paid probe when a person refreshes that credential', async () => {
    respondWith(403);
    const summary = await XAI_CONFIG.fetchQuota(paidFile, t, SINGLE_CREDENTIAL_FETCH_OPTIONS);

    expect(requests.map((request) => request.url)).toEqual([XAI_API_ME_URL, XAI_API_CHAT_URL]);
    expect(summary).toMatchObject({ mode: 'paid-health' });
  });

  test('stops a listed credential after its free billing probes fail, keeping the cause', async () => {
    respondWith(403);
    const error = await XAI_CONFIG.fetchQuota(listedFile, t, BULK_FETCH_OPTIONS).catch(
      (err: unknown) => err
    );

    expect(error).toBeInstanceOf(BillableProbeBlockedError);
    expect((error as BillableProbeBlockedError).cause).toMatchObject({ status: 403 });
    expect(requests.map((request) => request.url).sort()).toEqual(
      [XAI_BILLING_WEEKLY_URL, XAI_BILLING_MONTHLY_URL].sort()
    );
    expect(requests.some((request) => request.url === XAI_API_CHAT_URL)).toBe(false);
  });

  test('reports a rejected credential as an error instead of a billable block', async () => {
    respondWith(401);
    const error = await XAI_CONFIG.fetchQuota(listedFile, t, BULK_FETCH_OPTIONS).catch(
      (err: unknown) => err
    );

    expect(isBillableProbeBlockedError(error)).toBe(false);
    expect(error).toMatchObject({ status: 401 });
    expect(requests.some((request) => request.url === XAI_API_CHAT_URL)).toBe(false);
  });

  test('falls back to the paid probe after failed billing when billable probes are allowed', async () => {
    respondWith(403);
    const summary = await XAI_CONFIG.fetchQuota(listedFile, t, SINGLE_CREDENTIAL_FETCH_OPTIONS);

    expect(requests.map((request) => request.url)).toEqual([
      XAI_BILLING_WEEKLY_URL,
      XAI_BILLING_MONTHLY_URL,
      XAI_API_ME_URL,
      XAI_API_CHAT_URL,
    ]);
    expect(summary).toMatchObject({ mode: 'paid-health', userId: 'user-1' });
  });

  test('treats omitted or partial options as non-billable at runtime', async () => {
    respondWith(403);
    const untyped = XAI_CONFIG.fetchQuota as (
      file: Record<string, unknown>,
      tFn: TFunction,
      options?: Partial<QuotaFetchOptions>
    ) => Promise<unknown>;

    await expect(untyped(paidFile, t)).rejects.toBeInstanceOf(BillableProbeBlockedError);
    await expect(untyped(paidFile, t, {})).rejects.toBeInstanceOf(BillableProbeBlockedError);
    expect(requests).toEqual([]);
    expect(allowsBillableProbe(undefined)).toBe(false);
    expect(allowsBillableProbe({ allowBillable: true })).toBe(true);
  });

  test('recognizes blocked errors by code across module copies', () => {
    expect(isBillableProbeBlockedError({ code: 'billable_probe_blocked' })).toBe(true);
    expect(isBillableProbeBlockedError(new Error('other'))).toBe(false);
    expect(isBillableProbeBlockedError(null)).toBe(false);
  });
});
