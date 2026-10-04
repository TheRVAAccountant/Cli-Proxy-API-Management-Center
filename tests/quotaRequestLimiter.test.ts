import { describe, expect, test } from 'bun:test';
import {
  StaleConnectionError,
  createRequestLimiter,
  readManagementFailure,
  type ManagementFailure,
} from '@/services/api/requestLimiter';

const apiError = (fields: { status?: number; code?: string }) =>
  Object.assign(new Error('failed'), { name: 'ApiError', ...fields });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('management request limiter', () => {
  test('never runs more than the cap at once and reports capacity', async () => {
    const limiter = createRequestLimiter(2);
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    let running = 0;
    let peak = 0;
    const done = gates.map((gate) =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      })
    );

    await flush();
    expect(limiter.active).toBe(2);
    expect(limiter.waiting).toBe(3);
    expect(limiter.hasCapacity()).toBe(false);

    gates.forEach((gate) => gate.resolve());
    await Promise.all(done);
    expect(peak).toBe(2);
    expect(limiter.active).toBe(0);
    expect(limiter.hasCapacity()).toBe(true);
  });

  test('notifies release listeners as slots free', async () => {
    const limiter = createRequestLimiter(1);
    let releases = 0;
    const unsubscribe = limiter.subscribeRelease(() => {
      releases += 1;
    });
    await limiter.run(async () => undefined);
    await limiter.run(async () => undefined);
    unsubscribe();
    await limiter.run(async () => undefined);
    expect(releases).toBe(2);
  });

  test('reports management 403s and unreachable backends, not per-credential errors', async () => {
    const limiter = createRequestLimiter(4);
    const failures: ManagementFailure[] = [];
    limiter.subscribeFailure((failure) => failures.push(failure));

    for (const error of [
      apiError({ status: 403 }),
      apiError({ code: 'ERR_NETWORK' }),
      apiError({ status: 400 }),
      apiError({ status: 502 }),
      apiError({ code: 'ECONNABORTED' }),
      Object.assign(new Error('upstream'), { status: 403 }),
    ]) {
      await limiter.run(() => Promise.reject(error)).catch(() => undefined);
    }

    expect(failures).toEqual(['blocked', 'offline']);
    expect(readManagementFailure(apiError({ status: 401 }))).toBeNull();
  });

  test('rejects a waiting request whose connection was replaced before it could start', async () => {
    let revision = 1;
    const limiter = createRequestLimiter(1, () => revision);
    const gate = deferred<void>();
    const first = limiter.run(() => gate.promise);
    let sent = false;
    const second = limiter.run(async () => {
      sent = true;
    });

    await flush();
    revision = 2;
    gate.resolve();
    await first;
    await expect(second).rejects.toBeInstanceOf(StaleConnectionError);
    expect(sent).toBe(false);
  });
});
