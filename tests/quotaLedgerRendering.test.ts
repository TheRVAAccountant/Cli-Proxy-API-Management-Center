import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  LEDGER_CLASS_KEYS,
  QuotaLedger,
  type LedgerClasses,
  type QuotaLedgerGroupModel,
} from '@/features/quota/components/QuotaLedger';
import type { QuotaLedgerRowModel } from '@/features/quota/components/QuotaLedgerRow';
import { credentialDisplayLabel } from '@/features/quota/credentialLabel';
import { groupLedgerEntries, resolveLedgerRowState } from '@/features/quota/ledger';
import type { QuotaNotLoadedReason } from '@/features/quota/loadController';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { projectCredentialQuota } from '@/features/quota/windowProjection';
import en from '@/i18n/locales/en.json';
import { buildResetDisplay } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const t = i18n.t.bind(i18n);

const classes = Object.fromEntries(LEDGER_CLASS_KEYS.map((key) => [key, key])) as LedgerClasses;
const NOW = Date.UTC(2026, 8, 11, 12, 0);
const HOUR = 60 * 60 * 1000;

const window = (id: string, labelKey: string, used: number, resetAtMs: number | null) => ({
  id,
  labelKey,
  label: id,
  usedPercent: used,
  resetLabel: '-',
  resetAtMs,
});

interface Fixture {
  entry: QuotaFileEntry;
  quota: unknown;
  queued?: boolean;
  notLoaded?: QuotaNotLoadedReason;
  billableOnly?: boolean;
  error?: string;
}

const claude = (email: string, quota: unknown): Fixture => ({
  entry: { file: { name: `claude-${email}.json`, type: 'claude', email }, type: 'claude' },
  quota,
});

const claudeQuota = (fableUsed: number, extra: ReturnType<typeof window>[] = []) => ({
  status: 'success',
  planType: 'plan_max',
  windows: [
    window('five-hour', 'claude_quota.five_hour', 0, null),
    window('seven-day', 'claude_quota.seven_day', 21, NOW + 25 * HOUR),
    window('seven-day-fable', 'claude_quota.seven_day_fable', fableUsed, NOW + 25 * HOUR),
    ...extra,
  ],
});

const codexQuota = {
  status: 'success',
  windows: [window('five-hour', 'codex_quota.primary_window', 10, NOW + HOUR)],
};

const fixtures: Fixture[] = [
  claude('tom@1abc.dev', claudeQuota(42)),
  claude('tina@pq.gg', {
    status: 'success',
    planType: 'plan_pro',
    windows: [
      window('five-hour', 'claude_quota.five_hour', 0, null),
      window('seven-day', 'claude_quota.seven_day', 10, NOW + HOUR),
    ],
  }),
  claude(
    'tia@tz.gg',
    claudeQuota(0, [
      window('seven-day-opus', 'claude_quota.seven_day_opus', 50, NOW + HOUR),
      window('seven-day-sonnet', 'claude_quota.seven_day_sonnet', 60, NOW + HOUR),
    ])
  ),
  {
    ...claude('ted@tz.gg', { status: 'error', windows: [] }),
    error: 'token for ted@tz.gg expired',
  },
  { ...claude('tess@tx.gg', undefined), queued: true },
  ...['x1', 'x2', 'x3'].map((name): Fixture => ({
    entry: { file: { name: `codex-${name}.json`, type: 'codex' }, type: 'codex' },
    quota: codexQuota,
  })),
  {
    entry: {
      file: {
        name: 'xai-grok@x.ai.json',
        type: 'xai',
        email: 'grok@x.ai',
        using_api: true,
        prefix: 'paid',
      },
      type: 'xai',
    },
    quota: undefined,
    billableOnly: true,
  },
  {
    entry: { file: { name: 'kimi-1.json', type: 'kimi' }, type: 'kimi' },
    quota: {
      status: 'success',
      rows: [{ id: 'summary', labelKey: 'kimi_quota.weekly_limit', used: 0, limit: 100 }],
    },
  },
];

const buildGroups = (): QuotaLedgerGroupModel[] =>
  groupLedgerEntries(fixtures.map((fixture) => fixture.entry)).map((group) => ({
    type: group.type,
    rows: group.entries.map((entry): QuotaLedgerRowModel => {
      const fixture = fixtures.find((candidate) => candidate.entry === entry) as Fixture;
      const projection = projectCredentialQuota(entry.type, fixture.quota, t, NOW);
      const state = resolveLedgerRowState({
        status: projection.status,
        queued: fixture.queued ?? false,
        notLoadedReason: fixture.notLoaded ?? null,
        billableOnly: fixture.billableOnly ?? false,
      });
      return {
        key: getQuotaCacheKey(entry.file),
        entry,
        label: credentialDisplayLabel(entry.file, false),
        projection,
        state,
        errorMessage: fixture.error ? fixture.error.replace('ted@tz.gg', 't•••@t•••.gg') : null,
        canRefresh: true,
        inFlight: false,
      };
    }),
  }));

const render = () =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(QuotaLedger, {
        groups: buildGroups(),
        resolvedTheme: 'dark',
        onRefresh: () => {},
        classes,
        now: NOW,
      })
    )
  );

describe('quota ledger rendering', () => {
  const html = render();

  test('renders provider groups in tab order with their counts', () => {
    const headings = [
      ...html.matchAll(
        /<h2[^>]*>(?:<span[^>]*><img[^>]*\/><\/span>)?([^<]+)<span class="groupCount">(\d+)<\/span>/g
      ),
    ].map((match) => [match[1], match[2]]);
    expect(headings).toEqual([
      ['Claude', '5'],
      ['Codex', '3'],
      ['xAI', '1'],
      ['Kimi', '1'],
    ]);
  });

  test('Claude rows show Fable, 5-hour, then 7-day with remaining percent and reset lines', () => {
    const firstRow = html.slice(html.indexOf('<li class="row">'), html.indexOf('</li>'));
    const labels = [...firstRow.matchAll(/<span class="cellLabel">([^<]+)<\/span>/g)].map(
      (match) => match[1]
    );
    expect(labels).toEqual(['7-day Fable 5', '5-hour limit', '7-day limit']);
    expect(firstRow).toContain('<span class="cellValue">58%</span>');
    const reset = buildResetDisplay(null, NOW + 25 * HOUR, NOW, 'en');
    expect(firstRow).toContain(`${reset?.relative} · ${reset?.absolute}`);
    expect(firstRow).toContain('No reset pending');
    expect(firstRow).toContain('<span class="plan">Max</span>');
  });

  test('a window missing from a plan renders a dash; extra windows collapse to a button', () => {
    expect(html).toContain('aria-label="Not reported for this plan"');
    expect(html).toContain('>+2</button>');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="+2 more limits for claude-t•••@t•••.gg.json"');
  });

  test('rows use masked labels and never render a raw email', () => {
    expect(html).toContain('claude-t•••@1•••.dev.json');
    for (const email of ['tom@1abc.dev', 'ted@tz.gg', 'grok@x.ai', 'tess@tx.gg']) {
      expect(html).not.toContain(email);
    }
    expect(html).toContain('aria-label="Refresh quota for claude-t•••@1•••.dev.json"');
  });

  test('error, queued, and paid xAI rows render their own states', () => {
    expect(html).toContain('<span class="errorText">token for t•••@t•••.gg expired</span>');
    expect(html).toContain('<span class="status">Queued</span>');
    expect(html).toContain('Not loaded');
    expect(html).toContain(en.xai_quota.billable_probe_blocked);
  });

  test('ledger rows mount neither reset grants nor reset credits', () => {
    expect(html).not.toContain(en.claude_reset.use);
    expect(html).not.toContain(en.codex_quota.reset_button);
  });
});
