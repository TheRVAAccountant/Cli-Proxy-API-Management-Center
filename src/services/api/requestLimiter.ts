/**
 * Concurrency cap for management requests that fan out once per credential:
 * proxied provider calls (`/requests/api-call`) and raw credential downloads.
 *
 * The quota page loads every credential automatically, and each load issues two
 * to four of these requests. Capping them at the transport keeps the browser
 * below its six connections per origin (so list refreshes and config calls are
 * not starved) and keeps one failure wave under the backend's five-attempt
 * management ban, without each provider fetcher having to thread a limiter.
 *
 * The limiter also reports management-level failures while they are still raw
 * `ApiError`s, before provider fetchers rewrap them: a 403 (the backend's IP
 * ban) or a request that never reached the backend. The quota load queue stops
 * on that signal instead of filling every row with the same error.
 */

import { apiClient } from './client';

export type ManagementFailure = 'blocked' | 'offline';

/** A queued request whose connection was replaced before it could be sent. */
export class StaleConnectionError extends Error {
  constructor() {
    super('Connection changed before the request was sent');
    this.name = 'StaleConnectionError';
  }
}

export const isStaleConnectionError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'StaleConnectionError';

/** A management-level failure: the backend refused this client or could not be reached. */
export function readManagementFailure(error: unknown): ManagementFailure | null {
  if (!(error instanceof Error) || error.name !== 'ApiError') return null;
  const { status, code } = error as Error & { status?: number; code?: string };
  if (status === 403) return 'blocked';
  if (status === undefined && code === 'ERR_NETWORK') return 'offline';
  return null;
}

export interface RequestLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** True when a new request would start immediately with nothing already waiting. */
  hasCapacity(): boolean;
  readonly active: number;
  readonly waiting: number;
  /** Called whenever a slot frees, so a scheduler can start more work. */
  subscribeRelease(listener: () => void): () => void;
  subscribeFailure(listener: (failure: ManagementFailure) => void): () => void;
}

export function createRequestLimiter(
  maxConcurrent: number,
  getRevision: () => number = () => 0
): RequestLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  const releaseListeners = new Set<() => void>();
  const failureListeners = new Set<(failure: ManagementFailure) => void>();

  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
    releaseListeners.forEach((listener) => listener());
  };

  /** Runs a task that already holds a slot; the slot is released when it settles. */
  const start = <T>(task: () => Promise<T>, revision: number): Promise<T> => {
    let pending: Promise<T>;
    try {
      // Never send a request queued for a connection that has since been replaced.
      if (getRevision() !== revision) throw new StaleConnectionError();
      pending = task();
    } catch (error) {
      pending = Promise.reject(error);
    }
    return pending.then(
      (value) => {
        release();
        return value;
      },
      (error: unknown) => {
        const failure = readManagementFailure(error);
        if (failure) failureListeners.forEach((listener) => listener(failure));
        release();
        throw error;
      }
    );
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const revision = getRevision();
      // A free slot starts the request synchronously, adding no latency.
      if (active < maxConcurrent && waiting.length === 0) {
        active += 1;
        return start(task, revision);
      }
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          active += 1;
          start(task, revision).then(resolve, reject);
        });
      });
    },
    hasCapacity: () => active < maxConcurrent && waiting.length === 0,
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
    subscribeRelease(listener) {
      releaseListeners.add(listener);
      return () => releaseListeners.delete(listener);
    },
    subscribeFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
  };
}

export const MANAGEMENT_REQUEST_CONCURRENCY = 4;

export const managementRequestLimiter = createRequestLimiter(MANAGEMENT_REQUEST_CONCURRENCY, () =>
  apiClient.getConnectionRevision()
);
