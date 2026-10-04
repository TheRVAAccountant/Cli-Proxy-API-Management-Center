/**
 * Quota load controller: the queue, the per-credential task, and the batch rules,
 * free of React so tests drive them directly. `useQuotaBatchLoader` wraps one
 * controller per session.
 *
 * Guards, per credential:
 * - a dispatch captures the session and per-file cache generation, and every store
 *   write commits only while both are current;
 * - a dispatch takes a per-key token; a response under a superseded token never commits;
 * - a result for a credential no longer listed never recreates its cache entry.
 * "Loading" is written when a request goes out. A discarded result puts back the
 * row's previous state, but only while the store still holds the loading state
 * this dispatch wrote, so nothing is left stuck and no stale state lands in a new
 * session.
 *
 * Batch rules: a manual batch replaces queued automatic work and adopts in-flight
 * credentials; a management 403 or unreachable backend (reported by the request
 * limiter) stops the queue; an upstream 429 pauses that provider for the batch;
 * every other failure stays on its row.
 */

import type { TFunction } from 'i18next';
import type { ManagementFailure, RequestLimiter } from '@/services/api/requestLimiter';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from './logic';
import { createQuotaLoadQueue, type QuotaLoadTask, type QuotaLoadTrigger } from './loadQueue';
import {
  QUOTA_ADAPTERS,
  getQuotaSetter,
  isBillableProbeBlockedError,
  type QuotaAdapter,
  type QuotaCardState,
} from './providers';
import type { QuotaProviderType } from './providers/types';
import { enrichQuotaInBackground } from './quotaEnrichment';
import { classifyQuotaFailure } from './quotaErrors';

/** Why a credential has no quota yet even though a load reached it. */
export type QuotaNotLoadedReason = 'billable' | 'rate-limited' | 'stopped';

export interface QuotaLoadState {
  queued: ReadonlySet<string>;
  inFlight: ReadonlySet<string>;
  notLoaded: ReadonlyMap<string, QuotaNotLoadedReason>;
  stop: ManagementFailure | null;
}

export const EMPTY_QUOTA_LOAD_STATE: QuotaLoadState = {
  queued: new Set(),
  inFlight: new Set(),
  notLoaded: new Map(),
  stop: null,
};

export interface QuotaLoadControllerDeps {
  maxInFlight: number;
  limiter: Pick<RequestLimiter, 'hasCapacity' | 'subscribeRelease' | 'subscribeFailure'>;
  /** The session this controller serves; work stops once the store moves on. */
  sessionGeneration: number;
  currentSession: () => number;
  isConnected: () => boolean;
  isLive: (key: string) => boolean;
  isVisible: (key: string) => boolean;
  t: () => TFunction;
  onChange: (state: QuotaLoadState) => void;
  adapterFor?: (type: QuotaProviderType) => QuotaAdapter;
  enrich?: typeof enrichQuotaInBackground;
}

export interface QuotaLoadController {
  load(targets: readonly QuotaFileEntry[], trigger: QuotaLoadTrigger): void;
  /** Moves a queued credential to the front for a person's own request (billable allowed). */
  promote(key: string): boolean;
  isPending(key: string): boolean;
  /** Whether this credential's load started during this controller's lifetime. */
  wasAttempted(key: string): boolean;
  reprioritize(): void;
  pump(): void;
  state(): QuotaLoadState;
  dispose(): void;
}

interface QueueItem {
  entry: QuotaFileEntry;
}

export function createQuotaLoadController(deps: QuotaLoadControllerDeps): QuotaLoadController {
  const adapterFor = deps.adapterFor ?? ((type: QuotaProviderType) => QUOTA_ADAPTERS[type]);
  const enrich = deps.enrich ?? enrichQuotaInBackground;
  const attempted = new Set<string>();
  let paused = new Set<QuotaProviderType>();
  let notLoaded: ReadonlyMap<string, QuotaNotLoadedReason> = new Map();
  let stop: ManagementFailure | null = null;
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    deps.onChange(controller.state());
  };

  const setNotLoaded = (keys: readonly string[], reason: QuotaNotLoadedReason | null) => {
    if (keys.length === 0) return;
    const next = new Map(notLoaded);
    keys.forEach((key) => (reason === null ? next.delete(key) : next.set(key, reason)));
    notLoaded = next;
  };

  const queue = createQuotaLoadQueue<QueueItem>({
    maxInFlight: deps.maxInFlight,
    canDispatch: () =>
      !disposed &&
      stop === null &&
      deps.isConnected() &&
      deps.currentSession() === deps.sessionGeneration,
    hasCapacity: () => deps.limiter.hasCapacity(),
    isVisible: deps.isVisible,
    onChange: () => {
      if (queue.size === 0) paused = new Set();
      emit();
    },
    run: (task, token) => runTask(task, token),
  });

  const pauseProvider = (provider: QuotaProviderType) => {
    if (paused.has(provider)) return;
    paused.add(provider);
    const dropped = queue.cancelQueued((task) => task.provider === provider);
    setNotLoaded(
      dropped.map((task) => task.key),
      'rate-limited'
    );
    emit();
  };

  const runTask = async (task: QuotaLoadTask<QueueItem>, token: number) => {
    const { entry } = task.item;
    const adapter = adapterFor(entry.type);
    const file = entry.file;
    const cacheKey = task.key;
    const t = deps.t();
    const setQuota = getQuotaSetter(adapter);
    const generation = captureQuotaCacheGeneration(file.name);

    let prior: QuotaCardState | undefined;
    let loadingState: QuotaCardState | undefined;
    const wrote = commitIfQuotaCacheCurrent(
      generation,
      () => {
        setQuota((prev) => {
          prior = prev[cacheKey];
          loadingState = adapter.buildLoadingState();
          return { ...prev, [cacheKey]: loadingState };
        });
      },
      file.name
    );
    if (!wrote) return;
    attempted.add(cacheKey);

    // Writes only while the store still shows this dispatch's loading state.
    const settle = (next: () => QuotaCardState | undefined) =>
      commitIfQuotaCacheCurrent(
        generation,
        () => {
          setQuota((prev) => {
            if (loadingState === undefined || prev[cacheKey] !== loadingState) return prev;
            if (!deps.isLive(cacheKey)) return prev;
            const value = next();
            const out = { ...prev };
            if (value === undefined) delete out[cacheKey];
            else out[cacheKey] = value;
            return out;
          });
        },
        file.name
      );
    const restore = () => settle(() => prior);
    const isCurrent = () => queue.isCurrentToken(cacheKey, token) && deps.isLive(cacheKey);

    try {
      const data = await adapter.fetchQuota(file, t, { allowBillable: task.allowBillable });
      if (!isCurrent()) {
        restore();
        return;
      }
      let committed: QuotaCardState | undefined;
      settle(() => {
        committed = adapter.buildSuccessState(data);
        return committed;
      });
      if (notLoaded.has(cacheKey)) {
        setNotLoaded([cacheKey], null);
        emit();
      }
      if (committed) void enrich(adapter, file, data, committed, t);
    } catch (err: unknown) {
      if (isBillableProbeBlockedError(err)) {
        restore();
        setNotLoaded([cacheKey], 'billable');
        emit();
        return;
      }
      const failure = classifyQuotaFailure(err);
      // Management failures belong to the page (banner or logout), not to this row.
      if (
        failure === 'management-auth' ||
        failure === 'management-stop' ||
        failure === 'stale-connection' ||
        !isCurrent()
      ) {
        restore();
        return;
      }
      if (failure === 'rate-limited') pauseProvider(entry.type);
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      settle(() => adapter.buildErrorState(message, getStatusFromError(err)));
    }
  };

  const stopQueue = (failure: ManagementFailure) => {
    if (disposed || stop !== null) return;
    stop = failure;
    setNotLoaded(
      queue.cancelQueued().map((task) => task.key),
      'stopped'
    );
    emit();
  };

  const unsubscribeFailure = deps.limiter.subscribeFailure(stopQueue);
  const unsubscribeRelease = deps.limiter.subscribeRelease(() => queue.pump());

  const controller: QuotaLoadController = {
    load(targets, trigger) {
      if (disposed) return;
      const keys = targets.map((entry) => getQuotaCacheKey(entry.file));
      if (trigger === 'manual') {
        queue.cancelQueued((task) => task.trigger === 'auto');
        stop = null;
        paused = new Set();
        setNotLoaded(keys, null);
        emit();
      }
      queue.enqueue(
        targets
          .map((entry, index) => ({ entry, key: keys[index] }))
          .filter(({ entry }) => !paused.has(entry.type))
          .map(({ entry, key }) => ({
            key,
            provider: entry.type,
            trigger,
            allowBillable: false,
            item: { entry },
          }))
      );
    },
    promote: (key) => queue.promote(key, { allowBillable: true }),
    isPending: (key) => queue.isQueued(key) || queue.isInFlight(key),
    wasAttempted: (key) => attempted.has(key),
    reprioritize: () => queue.reprioritize(),
    pump: () => queue.pump(),
    state: () => ({
      queued: new Set(queue.queuedKeys()),
      inFlight: new Set(queue.inFlightKeys()),
      notLoaded,
      stop,
    }),
    dispose() {
      if (disposed) return;
      unsubscribeFailure();
      unsubscribeRelease();
      queue.dispose();
      disposed = true;
    },
  };
  return controller;
}
