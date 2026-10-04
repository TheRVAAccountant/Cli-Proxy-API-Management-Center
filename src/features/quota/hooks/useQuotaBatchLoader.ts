/**
 * Quota loading for the quota page: one load controller per session over the
 * shared management request limiter. The rules (guards, manual supersede, stop,
 * rate-limit pause) live in `loadController.ts`; this hook only connects them to
 * React state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useQuotaStore } from '@/stores';
import { managementRequestLimiter } from '@/services/api/requestLimiter';
import { QUOTA_MAX_CREDENTIALS_IN_FLIGHT } from '../constants';
import {
  EMPTY_QUOTA_LOAD_STATE,
  createQuotaLoadController,
  type QuotaLoadController,
  type QuotaLoadState,
} from '../loadController';
import type { QuotaLoadTrigger } from '../loadQueue';
import type { QuotaFileEntry } from '../logic';

export type { QuotaLoadTrigger } from '../loadQueue';
export type { QuotaNotLoadedReason } from '../loadController';

export interface QuotaBatchLoaderOptions {
  /** Cache keys of the credentials currently listed. */
  liveKeys: ReadonlySet<string>;
  /** Credentials on screen; they load first. */
  visibleKeys: ReadonlySet<string>;
}

export function useQuotaBatchLoader({ liveKeys, visibleKeys }: QuotaBatchLoaderOptions) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [state, setState] = useState<QuotaLoadState>(EMPTY_QUOTA_LOAD_STATE);

  // Live values read by the controller, which outlives any one render.
  const liveKeysRef = useRef(liveKeys);
  const visibleKeysRef = useRef(visibleKeys);
  const tRef = useRef(t);
  const connectedRef = useRef(connectionStatus === 'connected');
  const controllerRef = useRef<QuotaLoadController | null>(null);

  useEffect(() => {
    liveKeysRef.current = liveKeys;
  }, [liveKeys]);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    connectedRef.current = connectionStatus === 'connected';
    controllerRef.current?.pump();
  }, [connectionStatus]);
  useEffect(() => {
    visibleKeysRef.current = visibleKeys;
    controllerRef.current?.reprioritize();
  }, [visibleKeys]);

  // One controller per session; a connection switch or logout replaces it.
  useEffect(() => {
    const controller = createQuotaLoadController({
      maxInFlight: QUOTA_MAX_CREDENTIALS_IN_FLIGHT,
      limiter: managementRequestLimiter,
      sessionGeneration,
      currentSession: () => useQuotaStore.getState().cacheGeneration,
      isConnected: () => connectedRef.current,
      isLive: (key) => liveKeysRef.current.has(key),
      isVisible: (key) => visibleKeysRef.current.has(key),
      t: () => tRef.current,
      onChange: setState,
    });
    controllerRef.current = controller;
    setState(controller.state());
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [sessionGeneration]);

  const loadQuota = useCallback(
    (targets: readonly QuotaFileEntry[], trigger: QuotaLoadTrigger) =>
      controllerRef.current?.load(targets, trigger),
    []
  );
  const promote = useCallback((key: string) => controllerRef.current?.promote(key) ?? false, []);
  /** Stable check for effects and handlers: reads the live controller, not the last render. */
  const isPendingNow = useCallback(
    (key: string) => controllerRef.current?.isPending(key) ?? false,
    []
  );
  const wasAttempted = useCallback(
    (key: string) => controllerRef.current?.wasAttempted(key) ?? false,
    []
  );
  const isPending = useCallback(
    (key: string) => state.queued.has(key) || state.inFlight.has(key),
    [state]
  );

  const batchLoading = state.queued.size > 0 || state.inFlight.size > 0;

  return useMemo(
    () => ({
      batchLoading,
      loadQuota,
      promote,
      isPending,
      isPendingNow,
      wasAttempted,
      queuedKeys: state.queued,
      notLoaded: state.notLoaded,
      stop: state.stop,
    }),
    [batchLoading, isPending, isPendingNow, loadQuota, promote, state, wasAttempted]
  );
}
