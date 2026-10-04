/**
 * Page-owned quota load queue: one task per credential.
 *
 * Tasks wait here, not inside the transport, so "queued" is a real state the
 * page can show, cancel, and reorder. A task starts only when the request
 * limiter has a free slot and nothing already waiting, so follow-up requests
 * from in-flight credentials go first. Each dispatch takes a fresh per-key
 * token; a response whose token is no longer current must not commit.
 *
 * Pure: no React, no stores. The hook supplies `run`, which performs the fetch
 * and all guarded store writes.
 */

export type QuotaLoadTrigger = 'auto' | 'manual';

export interface QuotaLoadTask<T> {
  /** Quota cache key; one task per credential. */
  key: string;
  provider: string;
  trigger: QuotaLoadTrigger;
  /** Billable probes are allowed only for a person's single-credential request. */
  allowBillable: boolean;
  item: T;
}

export interface QuotaLoadQueueConfig<T> {
  /** Safety bound on credentials in flight; each issues at least one request. */
  maxInFlight: number;
  /** False while the session is stale, disconnected, or stopped. */
  canDispatch: () => boolean;
  /** True when the request limiter can start another request without queueing it. */
  hasCapacity: () => boolean;
  run: (task: QuotaLoadTask<T>, token: number) => Promise<void>;
  /** Visible credentials dispatch before hidden ones within the same trigger. */
  isVisible?: (key: string) => boolean;
  onChange?: () => void;
}

export interface QuotaLoadQueue<T> {
  /** Adds tasks, skipping keys already in flight; a manual task upgrades a queued auto one. */
  enqueue(tasks: readonly QuotaLoadTask<T>[]): void;
  /** Drops queued tasks (all, or those matching) and returns them. In-flight work continues. */
  cancelQueued(predicate?: (task: QuotaLoadTask<T>) => boolean): QuotaLoadTask<T>[];
  /** Moves a queued task to the front; false when the key is not queued. */
  promote(key: string, patch?: Partial<Pick<QuotaLoadTask<T>, 'allowBillable'>>): boolean;
  /** Re-sorts queued tasks after the visible set changed. */
  reprioritize(): void;
  /** Starts as many tasks as capacity allows. */
  pump(): void;
  isQueued(key: string): boolean;
  isInFlight(key: string): boolean;
  isCurrentToken(key: string, token: number): boolean;
  queuedKeys(): string[];
  inFlightKeys(): string[];
  /** Queued plus in flight. */
  readonly size: number;
  /** Stops dispatching and drops queued tasks; in-flight results still settle. */
  dispose(): void;
}

interface Entry<T> {
  task: QuotaLoadTask<T>;
  seq: number;
  /** Set when a person asked for this credential; later promotions go first. */
  promotedAt: number | null;
}

export function createQuotaLoadQueue<T>(config: QuotaLoadQueueConfig<T>): QuotaLoadQueue<T> {
  let queued: Entry<T>[] = [];
  const inFlight = new Set<string>();
  const tokens = new Map<string, number>();
  let nextSeq = 0;
  let promotions = 0;
  let disposed = false;
  let pumping = false;

  const notify = () => config.onChange?.();

  const rank = (entry: Entry<T>) => [
    entry.promotedAt === null ? 1 : 0,
    entry.promotedAt === null ? 0 : -entry.promotedAt,
    entry.task.trigger === 'manual' ? 0 : 1,
    config.isVisible && !config.isVisible(entry.task.key) ? 1 : 0,
    entry.seq,
  ];
  const sort = () => {
    queued.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i += 1) {
        if (ra[i] !== rb[i]) return ra[i] - rb[i];
      }
      return 0;
    });
  };

  const queue: QuotaLoadQueue<T> = {
    enqueue(tasks) {
      if (disposed || tasks.length === 0) return;
      let changed = false;
      tasks.forEach((task) => {
        if (inFlight.has(task.key)) return;
        const existing = queued.find((entry) => entry.task.key === task.key);
        if (existing) {
          if (task.trigger === 'manual' && existing.task.trigger === 'auto') {
            existing.task = { ...existing.task, trigger: 'manual' };
            changed = true;
          }
          if (task.allowBillable && !existing.task.allowBillable) {
            existing.task = { ...existing.task, allowBillable: true };
            changed = true;
          }
          return;
        }
        queued.push({ task, seq: nextSeq++, promotedAt: null });
        changed = true;
      });
      if (!changed) return;
      sort();
      notify();
      queue.pump();
    },

    cancelQueued(predicate) {
      const dropped = predicate ? queued.filter((entry) => predicate(entry.task)) : queued;
      if (dropped.length === 0) return [];
      queued = predicate ? queued.filter((entry) => !predicate(entry.task)) : [];
      notify();
      return dropped.map((entry) => entry.task);
    },

    promote(key, patch) {
      const entry = queued.find((candidate) => candidate.task.key === key);
      if (!entry) return false;
      entry.task = { ...entry.task, ...patch, trigger: 'manual' };
      entry.promotedAt = ++promotions;
      sort();
      notify();
      queue.pump();
      return true;
    },

    reprioritize() {
      if (queued.length < 2) return;
      sort();
      notify();
    },

    pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (
          !disposed &&
          queued.length > 0 &&
          inFlight.size < config.maxInFlight &&
          config.canDispatch() &&
          config.hasCapacity()
        ) {
          const { task } = queued.shift() as Entry<T>;
          const token = (tokens.get(task.key) ?? 0) + 1;
          tokens.set(task.key, token);
          inFlight.add(task.key);
          notify();
          void Promise.resolve()
            .then(() => config.run(task, token))
            .catch(() => undefined)
            .finally(() => {
              inFlight.delete(task.key);
              notify();
              queue.pump();
            });
        }
      } finally {
        pumping = false;
      }
    },

    isQueued: (key) => queued.some((entry) => entry.task.key === key),
    isInFlight: (key) => inFlight.has(key),
    isCurrentToken: (key, token) => tokens.get(key) === token,
    queuedKeys: () => queued.map((entry) => entry.task.key),
    inFlightKeys: () => Array.from(inFlight),
    get size() {
      return queued.length + inFlight.size;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      queued = [];
      notify();
    },
  };
  return queue;
}
