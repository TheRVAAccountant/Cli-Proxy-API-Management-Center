/**
 * Display projection: one credential's stored quota state → the window cells
 * the ledger rows and the summary strip render.
 *
 * Presentation only. Stores, fetchers, and card bodies keep their own shapes;
 * like `quotaTimelineModel`, this reads each provider structurally instead of
 * normalizing them, because the seven state shapes disagree about where a
 * window lives and what its percentage means.
 *
 * Every value is remaining percent, clamped to 0–100 and left unrounded:
 * displays and totals round with `displayPercent`, while the level helper reads
 * `levelValue`, which matches what the card body passes to `QuotaMeter`.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaBucket,
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import { formatKimiResetHint, parseIsoToMs } from '@/utils/quota';
import { clampQuotaPercent } from './level';
import { resolveCredentialPlanLabel } from './planLabels';
import { translateAntigravityGroupLabel } from './providers/antigravity/labels';
import type { QuotaProviderType } from './providers/types';
import { XAI_WEEKLY_ROW_ID } from './resetSchedule';

export const XAI_MONTHLY_WINDOW_ID = 'xai:monthly';
/** Summary-only aggregates: Antigravity's strip reads each credential's tightest bucket. */
export const ANTIGRAVITY_WEEKLY_SUMMARY_ID = 'antigravity:weekly';
export const ANTIGRAVITY_FIVE_HOUR_SUMMARY_ID = 'antigravity:five-hour';

export type QuotaLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QuotaWindowCell {
  /** Provider window id; specs key on this, never on the translated label. */
  id: string;
  label: string;
  /** Remaining percent 0–100, unrounded; null when the window reports no usable value. */
  remaining: number | null;
  /** Value the level helper reads (Kimi's card rounds before leveling; others do not). */
  levelValue: number | null;
  resetAtMs: number | null;
  /** Provider-formatted absolute reset label or relative hint, when the payload carried one. */
  resetLabel: string | null;
  /** The reported reset already passed, so the stored percentage is stale until a refresh. */
  resetPassed: boolean;
  /** Feeds the summary strip only; never a ledger column or overflow entry. */
  summaryOnly: boolean;
}

export interface CredentialQuotaProjection {
  status: QuotaLoadStatus;
  planLabel: string | null;
  cells: QuotaWindowCell[];
  /** xAI paid-health: the credential works, but xAI exposes no usage totals for it. */
  usageUnavailable: boolean;
  error: string | null;
  errorStatus: number | null;
}

export const displayPercent = (value: number | null): number | null =>
  value === null ? null : Math.round(value);

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const usableLabel = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed && trimmed !== '-' ? trimmed : null;
};

interface CellInput {
  id: string;
  label: string;
  remaining: number | null;
  levelValue?: number | null;
  resetAtMs?: number | null;
  resetLabel?: string | null;
  summaryOnly?: boolean;
}

const buildCell = (input: CellInput, now: number): QuotaWindowCell => {
  const resetAtMs = finiteOrNull(input.resetAtMs);
  // Mirrors the timeline's projectLane: once the reported reset passes, the stored
  // percentage describes a window that no longer exists.
  const resetPassed = resetAtMs !== null && resetAtMs <= now;
  const remaining =
    resetPassed || input.remaining === null || !Number.isFinite(input.remaining)
      ? null
      : clampQuotaPercent(input.remaining);
  const levelValue =
    remaining === null
      ? null
      : input.levelValue === undefined || input.levelValue === null
        ? remaining
        : clampQuotaPercent(input.levelValue);
  return {
    id: input.id,
    label: input.label,
    remaining,
    levelValue,
    resetAtMs,
    resetLabel: usableLabel(input.resetLabel),
    resetPassed,
    summaryOnly: input.summaryOnly ?? false,
  };
};

const fromUsed = (used: number | null | undefined): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : 100 - clampQuotaPercent(value);
};

const readStatus = (quota: unknown): QuotaLoadStatus => {
  const status = (quota as { status?: unknown } | undefined)?.status;
  return status === 'loading' || status === 'success' || status === 'error' ? status : 'idle';
};

function projectUsedWindows(
  windows: ClaudeQuotaState['windows'] | CodexQuotaState['windows'],
  t: TFunction,
  now: number
): QuotaWindowCell[] {
  return windows.map((window) => {
    const labelParams = 'labelParams' in window ? window.labelParams : undefined;
    return buildCell(
      {
        id: window.id,
        label: window.labelKey
          ? t(window.labelKey, (labelParams ?? {}) as Record<string, string | number>)
          : window.label,
        remaining: fromUsed(window.usedPercent),
        resetAtMs: window.resetAtMs,
        resetLabel: window.resetLabel,
      },
      now
    );
  });
}

function projectXai(quota: XaiQuotaState, t: TFunction, now: number) {
  const billing = quota.billing;
  if (!billing) return { cells: [], usageUnavailable: false };
  if (billing.mode === 'paid-health') {
    // Present but empty, so the credential still counts in the provider's pool (AE2).
    return {
      cells: [
        buildCell(
          { id: XAI_WEEKLY_ROW_ID, label: t('xai_quota.weekly_limit'), remaining: null },
          now
        ),
      ],
      usageUnavailable: true,
    };
  }

  const cells: QuotaWindowCell[] = [];
  const hasWeekly =
    billing.periodType === 'weekly' &&
    (billing.usagePercent !== null ||
      Boolean(billing.periodEnd) ||
      billing.productUsage.length > 0);
  if (hasWeekly) {
    cells.push(
      buildCell(
        {
          id: XAI_WEEKLY_ROW_ID,
          label: t('xai_quota.weekly_limit'),
          remaining: fromUsed(billing.usagePercent),
          resetAtMs: billing.resetAtMs,
        },
        now
      )
    );
  }
  const hasMonthly =
    (billing.monthlyLimitCents !== null ||
      billing.usedCents !== null ||
      Boolean(billing.billingPeriodEnd)) &&
    !(hasWeekly && billing.monthlyLimitCents === 0 && billing.usedCents === 0);
  if (hasMonthly) {
    cells.push(
      buildCell(
        {
          id: XAI_MONTHLY_WINDOW_ID,
          label: t('xai_quota.monthly_credits'),
          remaining: fromUsed(billing.usedPercent),
          resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
        },
        now
      )
    );
  }
  return { cells, usageUnavailable: false };
}

const isWeeklyBucket = (bucket: AntigravityQuotaBucket) =>
  bucket.window === 'weekly' || (bucket.periodHours ?? 0) >= 24 * 7;
const isFiveHourBucket = (bucket: AntigravityQuotaBucket) =>
  bucket.window === '5h' || bucket.periodHours === 5;

const bucketResetMs = (bucket: AntigravityQuotaBucket) =>
  finiteOrNull(bucket.resetAtMs) ?? parseIsoToMs(bucket.resetTime);

const tightestBucket = (buckets: AntigravityQuotaBucket[]) =>
  buckets.reduce<AntigravityQuotaBucket | null>(
    (tightest, bucket) =>
      tightest === null || bucket.remainingFraction < tightest.remainingFraction
        ? bucket
        : tightest,
    null
  );

function projectAntigravity(quota: AntigravityQuotaState, t: TFunction, now: number) {
  const groups = quota.groups ?? [];
  const cells: QuotaWindowCell[] = [];
  groups.forEach((group) => {
    const bucket = tightestBucket(group.buckets ?? []);
    if (!bucket) return;
    cells.push(
      buildCell(
        {
          id: group.id,
          label: translateAntigravityGroupLabel(group.label, t),
          remaining: bucket.remainingFraction * 100,
          resetAtMs: bucketResetMs(bucket),
        },
        now
      )
    );
  });

  const buckets = groups.flatMap((group) => group.buckets ?? []);
  const weekly = buckets.filter(isWeeklyBucket);
  const weeklyPick = tightestBucket(weekly.length > 0 ? weekly : buckets);
  if (weeklyPick) {
    cells.push(
      buildCell(
        {
          id: ANTIGRAVITY_WEEKLY_SUMMARY_ID,
          label: t('antigravity_quota.weekly_limit'),
          remaining: weeklyPick.remainingFraction * 100,
          resetAtMs: bucketResetMs(weeklyPick),
          summaryOnly: true,
        },
        now
      )
    );
  }
  const fiveHourPick = tightestBucket(buckets.filter(isFiveHourBucket));
  if (fiveHourPick) {
    cells.push(
      buildCell(
        {
          id: ANTIGRAVITY_FIVE_HOUR_SUMMARY_ID,
          label: t('antigravity_quota.five_hour_limit'),
          remaining: fiveHourPick.remainingFraction * 100,
          resetAtMs: bucketResetMs(fiveHourPick),
          summaryOnly: true,
        },
        now
      )
    );
  }
  return cells;
}

/** Kimi's card body: a zero limit with use is exhausted; with no use it is no data. */
const kimiRemaining = (used: number, limit: number): number | null =>
  limit > 0 ? clampQuotaPercent(Math.round(((limit - used) / limit) * 100)) : used > 0 ? 0 : null;

function projectCells(
  provider: QuotaProviderType,
  quota: unknown,
  t: TFunction,
  now: number
): { cells: QuotaWindowCell[]; usageUnavailable: boolean } {
  switch (provider) {
    case 'claude':
      return {
        cells: projectUsedWindows((quota as ClaudeQuotaState).windows ?? [], t, now),
        usageUnavailable: false,
      };
    case 'codex':
      return {
        cells: projectUsedWindows((quota as CodexQuotaState).windows ?? [], t, now),
        usageUnavailable: false,
      };
    case 'xai':
      return projectXai(quota as XaiQuotaState, t, now);
    case 'antigravity':
      return {
        cells: projectAntigravity(quota as AntigravityQuotaState, t, now),
        usageUnavailable: false,
      };
    case 'kimi':
      return {
        cells: ((quota as KimiQuotaState).rows ?? []).map((row) => {
          const remaining = kimiRemaining(row.used, row.limit);
          return buildCell(
            {
              id: row.id,
              label: row.labelKey
                ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
                : (row.label ?? ''),
              remaining,
              levelValue: remaining,
              resetAtMs: row.resetAtMs ?? null,
              resetLabel: row.resetAtMs == null ? formatKimiResetHint(t, row.resetHint) : null,
            },
            now
          );
        }),
        usageUnavailable: false,
      };
    case 'devin':
      return {
        cells: ((quota as DevinQuotaState).windows ?? []).map((window) =>
          buildCell(
            {
              id: window.id,
              label: t(`devin_quota.${window.id}`),
              remaining: finiteOrNull(window.remainingPercent),
              resetAtMs: window.resetAtMs,
            },
            now
          )
        ),
        usageUnavailable: false,
      };
    case 'meta':
      return {
        cells: ((quota as MetaQuotaState).data?.windows ?? []).map((window) =>
          buildCell(
            {
              id: window.id,
              label:
                window.id === 'window' && window.durationMinutes
                  ? t('meta_quota.window_duration', { minutes: window.durationMinutes })
                  : t(`meta_quota.${window.id}`),
              remaining: fromUsed(window.usedPercent),
              // Meta reports Unix seconds.
              resetAtMs: window.resetAt === undefined ? null : window.resetAt * 1000,
            },
            now
          )
        ),
        usageUnavailable: false,
      };
  }
}

export function projectCredentialQuota(
  provider: QuotaProviderType,
  quota: unknown,
  t: TFunction,
  now: number
): CredentialQuotaProjection {
  const status = readStatus(quota);
  const record = (quota ?? {}) as { error?: unknown; errorStatus?: unknown };
  const base: CredentialQuotaProjection = {
    status,
    planLabel: null,
    cells: [],
    usageUnavailable: false,
    error: typeof record.error === 'string' && record.error ? record.error : null,
    errorStatus: finiteOrNull(record.errorStatus),
  };
  if (status !== 'success') return base;

  const { cells, usageUnavailable } = projectCells(provider, quota, t, now);
  return {
    ...base,
    planLabel: resolveCredentialPlanLabel(provider, quota, t),
    cells,
    usageUnavailable,
  };
}
