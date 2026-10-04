import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  ANTIGRAVITY_FIVE_HOUR_SUMMARY_ID,
  ANTIGRAVITY_WEEKLY_SUMMARY_ID,
  XAI_MONTHLY_WINDOW_ID,
  displayPercent,
  projectCredentialQuota,
  type CredentialQuotaProjection,
} from '@/features/quota/windowProjection';
import {
  cellForColumn,
  overflowCells,
  pickSummaryWindows,
  resolveLedgerColumns,
} from '@/features/quota/windowSpecs';
import { XAI_WEEKLY_ROW_ID } from '@/features/quota/resetSchedule';

const t = ((key: string, params?: Record<string, unknown>) =>
  params && Object.keys(params).length > 0
    ? `${key}:${JSON.stringify(params)}`
    : key) as unknown as TFunction;

const NOW = Date.UTC(2026, 8, 11, 12, 0);
const HOUR = 60 * 60 * 1000;

const claudeWindow = (id: string, usedPercent: number | null, resetAtMs: number | null) => ({
  id,
  label: id,
  labelKey: `claude_quota.${id}`,
  usedPercent,
  resetLabel: resetAtMs === null ? '-' : 'baked-label',
  resetAtMs,
});

const claude = (windows: ReturnType<typeof claudeWindow>[], planType = 'plan_max') =>
  projectCredentialQuota('claude', { status: 'success', windows, planType }, t, NOW);

const rowValues = (projection: CredentialQuotaProjection, provider: 'claude' | 'codex' | 'kimi') =>
  resolveLedgerColumns(provider, [projection]).map((column) => {
    const cell = cellForColumn(projection, column);
    return cell ? [cell.id, displayPercent(cell.remaining)] : null;
  });

describe('quota window projection', () => {
  test('Claude columns read Fable, 5-hour, 7-day as remaining percent in that order', () => {
    const projection = claude([
      claudeWindow('five-hour', 0, null),
      claudeWindow('seven-day', 21, NOW + 26 * HOUR),
      claudeWindow('seven-day-fable', 42, NOW + 26 * HOUR),
    ]);

    expect(rowValues(projection, 'claude')).toEqual([
      ['seven-day-fable', 58],
      ['five-hour', 100],
      ['seven-day', 79],
    ]);
    expect(projection.planLabel).toBe('claude_quota.plan_max');
  });

  test('a window without a reset instant projects a null reset', () => {
    const projection = claude([claudeWindow('five-hour', 0, null)]);
    expect(projection.cells[0]).toMatchObject({ resetAtMs: null, resetLabel: null });
  });

  test('scoped Claude windows overflow instead of taking columns', () => {
    const projection = claude([
      claudeWindow('five-hour', 10, null),
      claudeWindow('seven-day', 10, NOW + HOUR),
      claudeWindow('seven-day-opus', 20, NOW + HOUR),
      claudeWindow('seven-day-sonnet', 30, NOW + HOUR),
    ]);
    const columns = resolveLedgerColumns('claude', [projection]);

    expect(columns.map((column) => column.key)).toEqual(['five-hour', 'seven-day']);
    expect(overflowCells(projection, columns).map((cell) => cell.id)).toEqual([
      'seven-day-opus',
      'seven-day-sonnet',
    ]);
  });

  test('a null used percent is no data, never 100%', () => {
    expect(claude([claudeWindow('seven-day', null, NOW + HOUR)]).cells[0].remaining).toBeNull();
  });

  test('Codex fills its second column with whichever of weekly or monthly exists', () => {
    const codex = (ids: string[]) =>
      projectCredentialQuota(
        'codex',
        {
          status: 'success',
          planType: 'team',
          windows: ids.map((id) => ({
            id,
            label: id,
            usedPercent: 25,
            resetLabel: '-',
            resetAtMs: NOW + HOUR,
          })),
        },
        t,
        NOW
      );

    const team = codex(['five-hour', 'monthly', 'code-review-weekly']);
    const columns = resolveLedgerColumns('codex', [team]);
    expect(columns.map((column) => cellForColumn(team, column)?.id)).toEqual([
      'five-hour',
      'monthly',
    ]);
    expect(overflowCells(team, columns).map((cell) => cell.id)).toEqual(['code-review-weekly']);
    expect(rowValues(codex(['five-hour', 'weekly']), 'codex')).toEqual([
      ['five-hour', 75],
      ['weekly', 75],
    ]);
    expect(team.planLabel).toBe('codex_quota.plan_team');
  });

  test('a Codex limit reached without a percentage (stored as used 100) reads 0', () => {
    const projection = projectCredentialQuota(
      'codex',
      {
        status: 'success',
        windows: [{ id: 'weekly', label: 'w', usedPercent: 100, resetLabel: '-', resetAtMs: null }],
      },
      t,
      NOW
    );
    expect(projection.cells[0].remaining).toBe(0);
  });

  test('xAI weekly usage converts to remaining; paid health keeps an empty weekly cell', () => {
    const billing = {
      mode: 'billing',
      periodType: 'weekly',
      usagePercent: 30,
      usedPercent: 40,
      productUsage: [],
      periodEnd: '2026-09-17T17:29:00Z',
      billingPeriodEnd: '2026-10-01T00:00:00Z',
      monthlyLimitCents: 15_000,
      usedCents: 6_000,
      resetAtMs: NOW + 5 * 24 * HOUR,
    };
    const weekly = projectCredentialQuota('xai', { status: 'success', billing }, t, NOW);
    expect(weekly.cells.map((cell) => [cell.id, cell.remaining])).toEqual([
      [XAI_WEEKLY_ROW_ID, 70],
      [XAI_MONTHLY_WINDOW_ID, 60],
    ]);
    expect(weekly.planLabel).toBe('xai_quota.plan_supergrok');

    const paid = projectCredentialQuota(
      'xai',
      {
        status: 'success',
        billing: {
          mode: 'paid-health',
          periodType: 'unknown',
          usagePercent: null,
          productUsage: [],
        },
      },
      t,
      NOW
    );
    expect(paid.usageUnavailable).toBe(true);
    expect(paid.cells).toHaveLength(1);
    expect(paid.cells[0]).toMatchObject({ id: XAI_WEEKLY_ROW_ID, remaining: null });
    expect(paid.planLabel).toBe('xai_quota.plan_paid');
  });

  test('Kimi derives remaining from counts and follows its card body at zero limits', () => {
    const projection = projectCredentialQuota(
      'kimi',
      {
        status: 'success',
        rows: [
          {
            id: 'summary',
            labelKey: 'kimi_quota.weekly_limit',
            used: 20,
            limit: 100,
            resetAtMs: NOW + HOUR,
          },
          { id: 'limit-0', label: 'Window', used: 5, limit: 0, resetHint: '3h' },
          { id: 'monthly', labelKey: 'kimi_quota.monthly_limit', used: 0, limit: 0 },
        ],
      },
      t,
      NOW
    );

    expect(projection.cells.map((cell) => cell.remaining)).toEqual([80, 0, null]);
    expect(projection.cells[1].resetAtMs).toBeNull();
    expect(projection.cells[1].resetLabel).not.toBeNull();
    expect(projection.planLabel).toBeNull();
  });

  test('Kimi levels the rounded value its card passes to the meter', () => {
    const projection = projectCredentialQuota(
      'kimi',
      { status: 'success', rows: [{ id: 'summary', used: 3005, limit: 10000 }] },
      t,
      NOW
    );
    expect(projection.cells[0].levelValue).toBe(70);
  });

  test('Antigravity groups show their tightest bucket and feed summary-only aggregates', () => {
    const projection = projectCredentialQuota(
      'antigravity',
      {
        status: 'success',
        subscription: { plan: 'pro', tierName: null, tierId: null },
        groups: [
          {
            id: 'gemini',
            label: 'Gemini Models',
            buckets: [
              {
                id: 'g-week',
                label: 'Weekly Limit',
                window: 'weekly',
                remainingFraction: 0.9,
                resetAtMs: NOW + 48 * HOUR,
              },
              {
                id: 'g-5h',
                label: '5 hour limit',
                window: '5h',
                remainingFraction: 0.4,
                resetAtMs: NOW + 2 * HOUR,
              },
            ],
          },
        ],
      },
      t,
      NOW
    );

    const group = projection.cells.find((cell) => cell.id === 'gemini');
    expect(group).toMatchObject({ remaining: 40, label: 'antigravity_quota.group_gemini_models' });
    expect(
      projection.cells.find((cell) => cell.id === ANTIGRAVITY_WEEKLY_SUMMARY_ID)
    ).toMatchObject({
      remaining: 90,
      summaryOnly: true,
    });
    expect(
      projection.cells.find((cell) => cell.id === ANTIGRAVITY_FIVE_HOUR_SUMMARY_ID)?.remaining
    ).toBe(40);
    const columns = resolveLedgerColumns('antigravity', [projection]);
    expect(columns.map((column) => column.key)).toEqual(['gemini']);
    expect(overflowCells(projection, columns)).toEqual([]);
    expect(projection.planLabel).toBe('antigravity_subscription.plan_pro');
  });

  test('Devin passes remaining through and Meta converts Unix seconds to milliseconds', () => {
    const devin = projectCredentialQuota(
      'devin',
      {
        status: 'success',
        plan: 'Pro',
        windows: [{ id: 'weekly', remainingPercent: 64, resetAtMs: NOW + HOUR, periodHours: 168 }],
      },
      t,
      NOW
    );
    expect(devin.cells[0]).toMatchObject({ id: 'weekly', remaining: 64 });
    expect(devin.planLabel).toBe('Pro');

    const resetAt = Math.floor((NOW + 3 * HOUR) / 1000);
    const meta = projectCredentialQuota(
      'meta',
      {
        status: 'success',
        data: { planName: 'Muse', windows: [{ id: 'weekly', usedPercent: 25, resetAt }] },
      },
      t,
      NOW
    );
    expect(meta.cells[0]).toMatchObject({ remaining: 75, resetAtMs: resetAt * 1000 });
    expect(meta.planLabel).toBe('Muse');
  });

  test('values clamp to 0–100 and stay unrounded until displayed', () => {
    const projection = claude([
      claudeWindow('five-hour', 140, null),
      claudeWindow('seven-day', -5, null),
      claudeWindow('seven-day-fable', 41.6, null),
    ]);
    expect(projection.cells.map((cell) => cell.remaining)).toEqual([0, 100, 58.4]);
    expect(displayPercent(58.4)).toBe(58);
    expect(displayPercent(null)).toBeNull();
  });

  test('idle, loading and error states carry their status and no cells', () => {
    expect(projectCredentialQuota('claude', undefined, t, NOW)).toMatchObject({
      status: 'idle',
      cells: [],
    });
    expect(
      projectCredentialQuota('claude', { status: 'loading', windows: [] }, t, NOW).status
    ).toBe('loading');
    expect(
      projectCredentialQuota(
        'claude',
        { status: 'error', windows: [], error: 'boom', errorStatus: 502 },
        t,
        NOW
      )
    ).toMatchObject({ status: 'error', error: 'boom', errorStatus: 502, cells: [] });
  });

  test('a window whose reported reset passed projects as no data until refreshed', () => {
    const cell = claude([claudeWindow('seven-day', 100, NOW - HOUR)]).cells[0];
    expect(cell).toMatchObject({ remaining: null, levelValue: null, resetPassed: true });
  });

  test('fixed columns show every slot until something loads, then only reported slots', () => {
    const idle = projectCredentialQuota('claude', undefined, t, NOW);
    expect(resolveLedgerColumns('claude', [idle]).map((column) => column.key)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
    const proPlan = claude([
      claudeWindow('five-hour', 0, null),
      claudeWindow('seven-day', 10, NOW + HOUR),
    ]);
    expect(resolveLedgerColumns('claude', [idle, proPlan]).map((column) => column.key)).toEqual([
      'five-hour',
      'seven-day',
    ]);
  });

  test('summary picks Fable then 7-day, falling back to 7-day then 5-hour without Fable', () => {
    const max = claude([
      claudeWindow('five-hour', 0, null),
      claudeWindow('seven-day', 21, NOW + HOUR),
      claudeWindow('seven-day-fable', 42, NOW + HOUR),
      claudeWindow('seven-day-opus', 5, NOW + HOUR),
    ]);
    expect(pickSummaryWindows('claude', [max])).toEqual({
      primary: 'seven-day-fable',
      secondary: 'seven-day',
      revealable: ['five-hour', 'seven-day-opus'],
    });

    const pro = claude([
      claudeWindow('five-hour', 0, null),
      claudeWindow('seven-day', 21, NOW + HOUR),
    ]);
    expect(pickSummaryWindows('claude', [pro])).toEqual({
      primary: 'seven-day',
      secondary: 'five-hour',
      revealable: [],
    });
  });
});
