import { describe, expect, test } from 'bun:test';
import { createQuotaLoadQueue, type QuotaLoadTask } from '@/features/quota/loadQueue';
import { createRequestLimiter } from '@/services/api/requestLimiter';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const task = (
  key: string,
  trigger: 'auto' | 'manual' = 'auto',
  provider = 'claude'
): QuotaLoadTask<null> => ({ key, provider, trigger, allowBillable: false, item: null });

describe('quota load queue', () => {
  test('ten credentials issuing two requests each never exceed four concurrent requests', async () => {
    const limiter = createRequestLimiter(4);
    let running = 0;
    let peak = 0;
    const completed: string[] = [];
    const request = () =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await flush();
        running -= 1;
      });
    const queue = createQuotaLoadQueue<null>({
      maxInFlight: 4,
      canDispatch: () => true,
      hasCapacity: () => limiter.hasCapacity(),
      run: async ({ key }) => {
        await Promise.all([request(), request()]);
        completed.push(key);
      },
    });
    limiter.subscribeRelease(() => queue.pump());

    queue.enqueue(Array.from({ length: 10 }, (_, index) => task(`c${index}`)));
    for (let i = 0; i < 50 && completed.length < 10; i += 1) await flush();

    expect(completed).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(4);
    expect(queue.size).toBe(0);
  });

  test('dispatches manual before auto, visible before hidden, and promoted first', async () => {
    const started: string[] = [];
    let open = false;
    const visible = new Set(['seen']);
    const queue = createQuotaLoadQueue<null>({
      maxInFlight: 1,
      canDispatch: () => open,
      hasCapacity: () => true,
      isVisible: (key) => visible.has(key),
      run: async ({ key }) => {
        started.push(key);
      },
    });

    queue.enqueue([task('hidden'), task('seen'), task('urgent', 'manual'), task('late')]);
    expect(queue.queuedKeys()).toEqual(['urgent', 'seen', 'hidden', 'late']);
    expect(queue.promote('late', { allowBillable: true })).toBe(true);
    expect(queue.promote('missing')).toBe(false);
    expect(queue.queuedKeys()[0]).toBe('late');

    open = true;
    queue.pump();
    for (let i = 0; i < 10; i += 1) await flush();
    expect(started).toEqual(['late', 'urgent', 'seen', 'hidden']);
  });

  test('a manual task upgrades a queued auto task instead of duplicating it', () => {
    const queue = createQuotaLoadQueue<null>({
      maxInFlight: 1,
      canDispatch: () => false,
      hasCapacity: () => true,
      run: async () => undefined,
    });
    queue.enqueue([task('a'), task('b')]);
    queue.enqueue([task('b', 'manual')]);
    expect(queue.queuedKeys()).toEqual(['b', 'a']);
    expect(queue.size).toBe(2);
  });

  test('cancelling drops queued tasks while in-flight ones finish', async () => {
    const gate = deferred();
    const finished: string[] = [];
    const queue = createQuotaLoadQueue<null>({
      maxInFlight: 1,
      canDispatch: () => true,
      hasCapacity: () => true,
      run: async ({ key }) => {
        await gate.promise;
        finished.push(key);
      },
    });
    queue.enqueue([task('a'), task('b'), task('c')]);
    await flush();
    expect(queue.inFlightKeys()).toEqual(['a']);

    const dropped = queue.cancelQueued((queued) => queued.key === 'b');
    expect(dropped.map((queued) => queued.key)).toEqual(['b']);
    expect(queue.queuedKeys()).toEqual(['c']);
    expect(queue.cancelQueued().map((queued) => queued.key)).toEqual(['c']);

    gate.resolve();
    for (let i = 0; i < 5; i += 1) await flush();
    expect(finished).toEqual(['a']);
  });

  test('each dispatch takes a fresh per-key token and skips keys already in flight', async () => {
    const tokens: number[] = [];
    let gate = deferred();
    const queue = createQuotaLoadQueue<null>({
      maxInFlight: 2,
      canDispatch: () => true,
      hasCapacity: () => true,
      run: async (_task, token) => {
        tokens.push(token);
        await gate.promise;
      },
    });

    queue.enqueue([task('a')]);
    await flush();
    queue.enqueue([task('a', 'manual')]);
    expect(queue.queuedKeys()).toEqual([]);
    expect(queue.isCurrentToken('a', 1)).toBe(true);

    gate.resolve();
    for (let i = 0; i < 5; i += 1) await flush();
    gate = deferred();
    queue.enqueue([task('a')]);
    await flush();
    expect(tokens).toEqual([1, 2]);
    expect(queue.isCurrentToken('a', 1)).toBe(false);
    expect(queue.isCurrentToken('a', 2)).toBe(true);
    gate.resolve();
  });

  test('waits for capacity and dispatch permission, and stops after dispose', async () => {
    const started: string[] = [];
    let capacity = false;
    let allowed = true;
    const queue = createQuotaLoadQueue<null>({
      maxInFlight: 4,
      canDispatch: () => allowed,
      hasCapacity: () => capacity,
      run: async ({ key }) => {
        started.push(key);
      },
    });

    queue.enqueue([task('a'), task('b')]);
    await flush();
    expect(started).toEqual([]);

    capacity = true;
    allowed = false;
    queue.pump();
    await flush();
    expect(started).toEqual([]);

    queue.dispose();
    allowed = true;
    queue.pump();
    await flush();
    expect(started).toEqual([]);
    expect(queue.size).toBe(0);
  });
});
