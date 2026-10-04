import { beforeEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { createQuotaLoadController, type QuotaLoadState } from '@/features/quota/loadController';
import type { QuotaFileEntry } from '@/features/quota/logic';
import {
  BillableProbeBlockedError,
  type QuotaAdapter,
  type QuotaFetchOptions,
} from '@/features/quota/providers';
import { createRequestLimiter, type RequestLimiter } from '@/services/api/requestLimiter';
import { useQuotaStore } from '@/stores';
import { createStatusError } from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const flush = async (times = 5) => {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

type Provider = 'claude' | 'codex';

interface Call {
  key: string;
  options: QuotaFetchOptions;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const apiError = (fields: { status?: number; code?: string }) =>
  Object.assign(new Error('management failure'), { name: 'ApiError', ...fields });

const entry = (name: string, type: Provider = 'claude'): QuotaFileEntry => ({
  file: { name, type },
  type,
});

const quotaOf = (provider: Provider, key: string) =>
  (provider === 'claude'
    ? useQuotaStore.getState().claudeQuota
    : useQuotaStore.getState().codexQuota)[key] as
    { status: string; error?: string; errorStatus?: number; data?: unknown } | undefined;

function setup(options: { maxInFlight?: number; entries: QuotaFileEntry[] }) {
  const limiter: RequestLimiter = createRequestLimiter(4);
  const calls: Call[] = [];
  const fetchQuota = (file: { name: string }, _t: TFunction, fetchOptions: QuotaFetchOptions) =>
    new Promise((resolve, reject) => {
      calls.push({ key: file.name, options: fetchOptions, resolve, reject });
    });
  const adapter = (type: Provider) =>
    ({
      type,
      i18nPrefix: `${type}_quota`,
      filterFn: () => true,
      fetchQuota,
      storeSelector: (state: Record<string, unknown>) => state[`${type}Quota`],
      storeSetter: type === 'claude' ? 'setClaudeQuota' : 'setCodexQuota',
      buildLoadingState: () => ({ status: 'loading', windows: [] }),
      buildSuccessState: (data: unknown) => ({ status: 'success', windows: [], data }),
      buildErrorState: (message: string, status?: number) => ({
        status: 'error',
        windows: [],
        error: message,
        errorStatus: status,
      }),
      Body: () => null,
    }) as unknown as QuotaAdapter;
  const adapters = { claude: adapter('claude'), codex: adapter('codex') };
  const liveKeys = new Set(options.entries.map((candidate) => candidate.file.name));
  const states: QuotaLoadState[] = [];
  const controller = createQuotaLoadController({
    maxInFlight: options.maxInFlight ?? 4,
    limiter,
    sessionGeneration: useQuotaStore.getState().cacheGeneration,
    currentSession: () => useQuotaStore.getState().cacheGeneration,
    isConnected: () => true,
    isLive: (key) => liveKeys.has(key),
    isVisible: () => true,
    t: () => t,
    onChange: (state) => states.push(state),
    adapterFor: (type) => adapters[type as Provider],
    enrich: async () => undefined,
  });
  const callFor = (key: string) => calls.find((call) => call.key === key) as Call;
  return { controller, limiter, calls, callFor, liveKeys, state: () => controller.state() };
}

describe('quota load controller', () => {
  beforeEach(() => {
    useQuotaStore.getState().clearQuotaCache();
  });

  test('writes loading when a request goes out and commits the result', async () => {
    const { controller, calls, callFor } = setup({ entries: [entry('a.json')] });
    controller.load([entry('a.json')], 'auto');
    expect(quotaOf('claude', 'a.json')).toBeUndefined();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toEqual({ allowBillable: false });
    expect(quotaOf('claude', 'a.json')?.status).toBe('loading');

    callFor('a.json').resolve({ ok: 1 });
    await flush();
    expect(quotaOf('claude', 'a.json')).toMatchObject({ status: 'success', data: { ok: 1 } });
    expect(controller.wasAttempted('a.json')).toBe(true);
  });

  test('Covers AE8. a session change stops queued dispatches and discards in-flight results', async () => {
    const entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => entry(`${name}.json`));
    const { controller, calls } = setup({ entries });
    controller.load(entries, 'auto');
    await flush();
    expect(calls).toHaveLength(4);

    useQuotaStore.getState().clearQuotaCache();
    calls.forEach((call) => call.resolve({ stale: true }));
    await flush();
    controller.pump();
    await flush();

    expect(calls).toHaveLength(4);
    expect(useQuotaStore.getState().claudeQuota).toEqual({});
  });

  test('Covers AE9. a manual batch adopts in-flight credentials without duplicate requests', async () => {
    const entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => entry(`${name}.json`));
    const { controller, calls } = setup({ entries });
    controller.load(entries, 'auto');
    await flush();
    expect(calls).toHaveLength(4);

    controller.load(entries, 'manual');
    await flush();
    expect(calls).toHaveLength(4);
    expect([...controller.state().queued]).toEqual(['e.json', 'f.json']);

    calls.slice(0, 4).forEach((call) => call.resolve({}));
    await flush();
    expect(calls.map((call) => call.key).sort()).toEqual(entries.map((e) => e.file.name).sort());
    calls.slice(4).forEach((call) => call.resolve({}));
    await flush();
    expect(controller.state().queued.size + controller.state().inFlight.size).toBe(0);
  });

  test('Covers AE10. an upstream 429 pauses only that provider for the batch', async () => {
    const entries = [
      entry('c1.json'),
      entry('c2.json'),
      entry('c3.json'),
      entry('x1.json', 'codex'),
    ];
    const { controller, calls, callFor } = setup({ maxInFlight: 1, entries });
    controller.load(entries, 'auto');
    await flush();
    callFor('c1.json').reject(createStatusError('slow down', 429));
    await flush();

    expect(quotaOf('claude', 'c1.json')).toMatchObject({ status: 'error', errorStatus: 429 });
    expect(controller.state().notLoaded.get('c2.json')).toBe('rate-limited');
    expect(controller.state().notLoaded.get('c3.json')).toBe('rate-limited');
    expect(calls.map((call) => call.key)).toEqual(['c1.json', 'x1.json']);

    callFor('x1.json').resolve({});
    await flush();
    expect(quotaOf('codex', 'x1.json')?.status).toBe('success');
  });

  test('Covers AE11. a management 403 stops the queue with one banner and no row errors', async () => {
    const entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => entry(`${name}.json`));
    const { controller, limiter, calls, callFor } = setup({ maxInFlight: 1, entries });
    controller.load(entries, 'auto');
    await flush();

    const failure = limiter.run(() => Promise.reject(apiError({ status: 403 })));
    callFor('a.json').reject(await failure.catch((error: unknown) => error));
    await flush();

    expect(controller.state().stop).toBe('blocked');
    expect(quotaOf('claude', 'a.json')).toBeUndefined();
    expect(controller.state().notLoaded.get('b.json')).toBe('stopped');
    expect(calls).toHaveLength(1);

    controller.load(entries, 'manual');
    await flush();
    expect(controller.state().stop).toBeNull();
    expect(calls).toHaveLength(2);
  });

  test('an unreachable backend stops the queue as offline', async () => {
    const { controller, limiter, callFor } = setup({ entries: [entry('a.json'), entry('b.json')] });
    controller.load([entry('a.json'), entry('b.json')], 'auto');
    await flush();
    const failure = await limiter
      .run(() => Promise.reject(apiError({ code: 'ERR_NETWORK' })))
      .catch((error: unknown) => error);
    callFor('a.json').reject(failure);
    await flush();
    expect(controller.state().stop).toBe('offline');
  });

  test('a management 401 restores the row and leaves logout to the client', async () => {
    const { controller, callFor } = setup({ entries: [entry('a.json')] });
    controller.load([entry('a.json')], 'auto');
    await flush();
    callFor('a.json').reject(apiError({ status: 401 }));
    await flush();
    expect(quotaOf('claude', 'a.json')).toBeUndefined();
    expect(controller.state().stop).toBeNull();
  });

  test('Covers AE12. an upstream 401 or a per-credential proxy error stays on its row', async () => {
    const entries = [entry('a.json'), entry('b.json'), entry('c.json')];
    const { controller, callFor } = setup({ entries });
    controller.load(entries, 'auto');
    await flush();
    callFor('a.json').reject(createStatusError('token expired', 401));
    callFor('b.json').reject(apiError({ status: 400 }));
    callFor('c.json').resolve({});
    await flush();

    expect(quotaOf('claude', 'a.json')).toMatchObject({ status: 'error', errorStatus: 401 });
    expect(quotaOf('claude', 'b.json')).toMatchObject({ status: 'error', errorStatus: 400 });
    expect(quotaOf('claude', 'c.json')?.status).toBe('success');
    expect(controller.state().stop).toBeNull();
  });

  test('Covers AE6. a blocked billable probe restores the prior state and reads not loaded', async () => {
    useQuotaStore.getState().setClaudeQuota({
      'a.json': { status: 'success', windows: [], planType: 'old' } as never,
    });
    const { controller, callFor } = setup({ entries: [entry('a.json'), entry('b.json')] });
    controller.load([entry('a.json'), entry('b.json')], 'auto');
    await flush();
    callFor('a.json').reject(new BillableProbeBlockedError('blocked'));
    callFor('b.json').reject(new BillableProbeBlockedError('blocked'));
    await flush();

    expect(quotaOf('claude', 'a.json')).toMatchObject({ status: 'success' });
    expect(quotaOf('claude', 'b.json')).toBeUndefined();
    expect(controller.state().notLoaded.get('a.json')).toBe('billable');
  });

  test('a late result for a credential removed from the list never recreates it', async () => {
    const { controller, callFor, liveKeys } = setup({ entries: [entry('a.json')] });
    controller.load([entry('a.json')], 'auto');
    await flush();
    liveKeys.delete('a.json');
    useQuotaStore.getState().setClaudeQuota((prev) => {
      const next = { ...prev };
      delete next['a.json'];
      return next;
    });
    callFor('a.json').resolve({});
    await flush();
    expect(quotaOf('claude', 'a.json')).toBeUndefined();
  });

  test('in-flight results still commit after dispose, leaving nothing stuck loading', async () => {
    const entries = [entry('a.json'), entry('b.json')];
    const { controller, calls, callFor } = setup({ maxInFlight: 1, entries });
    controller.load(entries, 'auto');
    await flush();
    controller.dispose();
    callFor('a.json').resolve({ late: true });
    await flush();

    expect(quotaOf('claude', 'a.json')).toMatchObject({ status: 'success' });
    expect(quotaOf('claude', 'b.json')).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test('a promoted credential dispatches next with billable probes allowed', async () => {
    const entries = [entry('a.json'), entry('b.json'), entry('c.json')];
    const { controller, calls, callFor } = setup({ maxInFlight: 1, entries });
    controller.load(entries, 'auto');
    await flush();
    expect(controller.promote('c.json')).toBe(true);
    expect(controller.isPending('c.json')).toBe(true);

    callFor('a.json').resolve({});
    await flush();
    expect(calls[1]).toMatchObject({ key: 'c.json', options: { allowBillable: true } });
    expect(controller.wasAttempted('b.json')).toBe(false);
  });
});
