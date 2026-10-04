import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  SUMMARY_SEGMENT_LIMIT,
  buildProviderSummaries,
  buildProviderSummary,
  type SummaryCredential,
} from '@/features/quota/summary';
import { projectCredentialQuota } from '@/features/quota/windowProjection';
import type { QuotaProviderType } from '@/features/quota/providers/types';

const t = ((key: string) => key) as unknown as TFunction;
const NOW = Date.UTC(2026, 8, 11, 12, 0);
const HOUR = 60 * 60 * 1000;

const credential = (
  provider: QuotaProviderType,
  key: string,
  quota: unknown
): SummaryCredential => ({ key, projection: projectCredentialQuota(provider, quota, t, NOW) });

const claudeQuota = (
  remaining: { fable?: number; sevenDay?: number; fiveHour?: number },
  resetInHours = 24
) => ({
  status: 'success',
  windows: [
    {
      id: 'five-hour',
      label: '5h',
      usedPercent: 100 - (remaining.fiveHour ?? 100),
      resetLabel: '-',
      resetAtMs: null,
    },
    {
      id: 'seven-day',
      label: '7d',
      usedPercent: 100 - (remaining.sevenDay ?? 100),
      resetLabel: '-',
      resetAtMs: NOW + resetInHours * HOUR,
    },
    ...(remaining.fable === undefined
      ? []
      : [
          {
            id: 'seven-day-fable',
            label: 'Fable',
            usedPercent: 100 - remaining.fable,
            resetLabel: '-',
            resetAtMs: NOW + resetInHours * HOUR,
          },
        ]),
  ],
});

const screenshotClaude = () => [
  credential('claude', 'c1', claudeQuota({ fable: 58, sevenDay: 79 }, 25)),
  credential('claude', 'c2', claudeQuota({ fable: 100, sevenDay: 100 }, 106)),
  credential('claude', 'c3', claudeQuota({ fable: 100, sevenDay: 100 }, 122)),
  credential('claude', 'c4', claudeQuota({ fable: 51, sevenDay: 75 }, 11)),
  credential('claude', 'c5', claudeQuota({ fable: 100, sevenDay: 100 }, 130)),
];

describe('summary strip math', () => {
  test('Covers AE1. Claude totals sum remaining Fable percent over five credentials', () => {
    const summary = buildProviderSummary('claude', screenshotClaude(), NOW);

    expect(summary.primary).toMatchObject({
      label: 'Fable',
      total: 409,
      denominator: 500,
      reporting: 5,
    });
    expect(summary.primary?.segments?.map((segment) => segment.level)).toEqual([
      'medium',
      'high',
      'high',
      'medium',
      'high',
    ]);
    expect(summary.primary?.earliestResetAtMs).toBe(NOW + 11 * HOUR);
    expect(summary.secondary).toMatchObject({ label: '7d', total: 454, denominator: 500 });
    expect(summary).toMatchObject({ credentialCount: 5, loadedCount: 5 });
  });

  test('reproduces the screenshot cells for Codex, xAI and Kimi', () => {
    const codexQuota = (weeklyRemaining: number) => ({
      status: 'success',
      windows: [
        { id: 'five-hour', label: '5h', usedPercent: 0, resetLabel: '-', resetAtMs: NOW + HOUR },
        {
          id: 'weekly',
          label: 'Weekly limit',
          usedPercent: 100 - weeklyRemaining,
          resetLabel: '-',
          resetAtMs: NOW + 54 * HOUR,
        },
      ],
    });
    const codex = buildProviderSummary(
      'codex',
      [
        credential('codex', 'x1', codexQuota(17)),
        credential('codex', 'x2', codexQuota(0)),
        credential('codex', 'x3', codexQuota(0)),
      ],
      NOW
    );
    expect(codex.primary).toMatchObject({ label: 'Weekly limit', total: 17, denominator: 300 });
    expect(codex.primary?.segments?.map((segment) => segment.level)).toEqual(['low', 'low', 'low']);

    const kimi = buildProviderSummary(
      'kimi',
      [
        credential('kimi', 'k1', {
          status: 'success',
          rows: [{ id: 'summary', label: 'Weekly limit', used: 0, limit: 100 }],
        }),
      ],
      NOW
    );
    expect(kimi.primary).toMatchObject({ total: 100, denominator: 100 });
  });

  test('Covers AE2. an xAI credential that loaded without a percentage reads "--" of 100%', () => {
    const resetAtMs = NOW + 5 * 24 * HOUR;
    const xai = buildProviderSummary(
      'xai',
      [
        credential('xai', 'g1', {
          status: 'success',
          billing: {
            mode: 'billing',
            periodType: 'weekly',
            usagePercent: null,
            usedPercent: null,
            productUsage: [],
            periodEnd: '2026-09-17T17:29:00Z',
            monthlyLimitCents: null,
            usedCents: null,
            resetAtMs,
          },
        }),
      ],
      NOW
    );
    expect(xai.primary).toMatchObject({
      total: null,
      denominator: 100,
      reporting: 0,
      earliestResetAtMs: resetAtMs,
    });
    expect(xai.primary?.segments).toEqual([{ key: 'g1', level: 'no-data', remaining: null }]);

    const paid = buildProviderSummary(
      'xai',
      [
        credential('xai', 'g2', {
          status: 'success',
          billing: {
            mode: 'paid-health',
            periodType: 'unknown',
            usagePercent: null,
            productUsage: [],
          },
        }),
      ],
      NOW
    );
    expect(paid.primary).toMatchObject({ total: null, denominator: 100 });
  });

  test('Covers AE3. a partial load counts reporting credentials and never treats errors as 0%', () => {
    const summary = buildProviderSummary(
      'claude',
      [
        credential('claude', 'a', claudeQuota({ fable: 80 })),
        credential('claude', 'b', claudeQuota({ fable: 60 })),
        credential('claude', 'c', undefined),
        credential('claude', 'd', { status: 'loading', windows: [] }),
        credential('claude', 'e', { status: 'error', windows: [], error: 'boom' }),
      ],
      NOW
    );

    expect(summary.primary).toMatchObject({ total: 140, denominator: 500, reporting: 2 });
    expect(summary.loadedCount).toBe(2);
    expect(summary.primary?.segments?.map((segment) => segment.level)).toEqual([
      'high',
      'medium',
      'no-data',
      'no-data',
      'no-data',
    ]);
  });

  test('Covers AE4. a loaded credential without the window leaves its denominator', () => {
    const credentials = screenshotClaude();
    credentials[4] = credential('claude', 'c5', claudeQuota({ sevenDay: 100 }));
    const summary = buildProviderSummary('claude', credentials, NOW);

    expect(summary.primary).toMatchObject({ total: 309, denominator: 400 });
    expect(summary.primary?.segments).toHaveLength(4);
  });

  test('earliest reset ignores passed instants, and is null when every reset passed', () => {
    const summary = buildProviderSummary(
      'claude',
      [
        credential('claude', 'past', claudeQuota({ fable: 0 }, -2)),
        credential('claude', 'future', claudeQuota({ fable: 50 }, 3)),
      ],
      NOW
    );
    expect(summary.primary?.earliestResetAtMs).toBe(NOW + 3 * HOUR);

    const allPast = buildProviderSummary(
      'claude',
      [credential('claude', 'past', claudeQuota({ fable: 0 }, -2))],
      NOW
    );
    expect(allPast.primary?.earliestResetAtMs).toBeNull();
    expect(allPast.primary?.total).toBeNull();
  });

  test('totals add the rounded row values, not raw fractions', () => {
    const summary = buildProviderSummary(
      'claude',
      [
        credential('claude', 'a', claudeQuota({ fable: 58.4 })),
        credential('claude', 'b', claudeQuota({ fable: 51.4 })),
      ],
      NOW
    );
    expect(summary.primary?.total).toBe(109);
  });

  test('without Fable the primary falls back to 7-day and the secondary to 5-hour', () => {
    const summary = buildProviderSummary(
      'claude',
      [credential('claude', 'a', claudeQuota({ sevenDay: 40, fiveHour: 90 }))],
      NOW
    );
    expect(summary.primary).toMatchObject({ label: '7d', total: 40 });
    expect(summary.secondary).toMatchObject({ label: '5h', total: 90 });
  });

  test('reveals the remaining reported windows behind Show', () => {
    const summary = buildProviderSummary('claude', screenshotClaude(), NOW);
    expect(summary.revealed.map((window) => [window.label, window.total])).toEqual([['5h', 500]]);
  });

  test(`switches to level bands above ${SUMMARY_SEGMENT_LIMIT} credentials`, () => {
    const credentials = Array.from({ length: SUMMARY_SEGMENT_LIMIT + 1 }, (_, index) =>
      credential(
        'claude',
        `c${index}`,
        index === 0 ? undefined : claudeQuota({ fable: index % 2 ? 90 : 10 })
      )
    );
    const summary = buildProviderSummary('claude', credentials, NOW);
    expect(summary.primary?.segments).toBeNull();
    expect(summary.primary?.bands).toEqual([
      { level: 'high', count: 20 },
      { level: 'low', count: 20 },
      { level: 'no-data', count: 1 },
    ]);
  });

  test('providers without credentials are omitted and order follows the given tab order', () => {
    const summaries = buildProviderSummaries(
      ['claude', 'antigravity', 'codex'],
      new Map([
        ['codex', [credential('codex', 'x', undefined)]],
        ['claude', [credential('claude', 'c', undefined)]],
      ]),
      NOW
    );
    expect(summaries.map((summary) => summary.provider)).toEqual(['claude', 'codex']);
    expect(summaries[0]).toMatchObject({ credentialCount: 1, loadedCount: 0, primary: null });
    expect(buildProviderSummaries(['claude'], new Map(), NOW)).toEqual([]);
  });
});
