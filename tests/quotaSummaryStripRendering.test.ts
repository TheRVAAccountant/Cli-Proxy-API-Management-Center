import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  QuotaSummaryStrip,
  SUMMARY_STRIP_CLASS_KEYS,
  type SummaryStripClasses,
} from '@/features/quota/components/QuotaSummaryStrip';
import { maskEmail } from '@/features/quota/credentialLabel';
import { buildProviderSummaries, type SummaryCredential } from '@/features/quota/summary';
import { projectCredentialQuota } from '@/features/quota/windowProjection';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import en from '@/i18n/locales/en.json';
import { buildResetDisplay } from '@/utils/quota';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const t = i18n.t.bind(i18n);

const classes = Object.fromEntries(
  SUMMARY_STRIP_CLASS_KEYS.map((key) => [key, key])
) as SummaryStripClasses;
const NOW = Date.UTC(2026, 8, 11, 12, 0);
const HOUR = 60 * 60 * 1000;

const claudeQuota = (fable: number, sevenDay: number, resetInHours: number) => ({
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      labelKey: 'claude_quota.five_hour',
      label: '5h',
      usedPercent: 0,
      resetLabel: '-',
      resetAtMs: null,
    },
    {
      id: 'seven-day',
      labelKey: 'claude_quota.seven_day',
      label: '7d',
      usedPercent: 100 - sevenDay,
      resetLabel: '-',
      resetAtMs: NOW + resetInHours * HOUR,
    },
    {
      id: 'seven-day-fable',
      labelKey: 'claude_quota.seven_day_fable',
      label: 'Fable',
      usedPercent: 100 - fable,
      resetLabel: '-',
      resetAtMs: NOW + resetInHours * HOUR,
    },
  ],
});

const emails = ['tom@1abc.dev', 'tina@pq.gg', 'tia@tz.gg', 'ted@tz.gg', 'tess@tx.gg'];

const summariesFor = (credentials: Partial<Record<QuotaProviderType, [string, unknown][]>>) =>
  buildProviderSummaries(
    ['claude', 'antigravity', 'codex', 'xai', 'kimi'],
    new Map(
      Object.entries(credentials).map(([provider, list]) => [
        provider as QuotaProviderType,
        (list ?? []).map(([key, quota]): SummaryCredential => ({
          key,
          projection: projectCredentialQuota(provider as QuotaProviderType, quota, t, NOW),
        })),
      ])
    ),
    NOW
  );

const render = (summaries: ReturnType<typeof summariesFor>) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(QuotaSummaryStrip, {
        summaries,
        resolvedTheme: 'dark',
        labelFor: (key: string) => `claude-${maskEmail(key)}.json`,
        classes,
        now: NOW,
      })
    )
  );

const screenshotClaude = (): [string, unknown][] => [
  [emails[0], claudeQuota(58, 79, 25)],
  [emails[1], claudeQuota(100, 100, 106)],
  [emails[2], claudeQuota(100, 100, 122)],
  [emails[3], claudeQuota(51, 75, 11)],
  [emails[4], claudeQuota(100, 100, 130)],
];

describe('quota summary strip', () => {
  test('Covers AE1. renders the Claude total, five level segments, and the soonest reset', () => {
    const html = render(summariesFor({ claude: screenshotClaude() }));

    expect(html).toContain('7-day Fable 5');
    expect(html).toContain('<span class="totalValue">409%</span> of 500%');
    expect(html.match(/class="segment level\w+"/g)).toEqual([
      'class="segment levelMedium"',
      'class="segment levelHigh"',
      'class="segment levelHigh"',
      'class="segment levelMedium"',
      'class="segment levelHigh"',
    ]);
    const reset = buildResetDisplay(null, NOW + 11 * HOUR, NOW, 'en');
    expect(html).toContain(`${reset?.relative} · ${reset?.absolute}`);
    expect(html).toContain('5 credentials');
    expect(html).toContain('<span class="secondaryValue">454%</span>');
  });

  test('Covers AE2. an xAI credential without a percentage renders "--"', () => {
    const html = render(
      summariesFor({
        xai: [
          [
            'grok@x.ai',
            {
              status: 'success',
              billing: {
                mode: 'paid-health',
                periodType: 'unknown',
                usagePercent: null,
                productUsage: [],
              },
            },
          ],
        ],
      })
    );
    expect(html).toContain('<span class="totalValue">--</span> of 100%');
    expect(html).toContain('class="segment levelNoData"');
    expect(html).toContain('No reset pending');
  });

  test('Covers AE3. a partial load says how many credentials report', () => {
    const html = render(
      summariesFor({
        claude: [
          ['a@a.dev', claudeQuota(80, 90, 5)],
          ['b@b.dev', claudeQuota(60, 90, 5)],
          ['c@c.dev', undefined],
          ['d@d.dev', { status: 'loading', windows: [] }],
          ['e@e.dev', { status: 'error', windows: [], error: 'boom' }],
        ],
      })
    );
    expect(html).toContain('2/5 reporting');
    expect(html).toContain('<span class="totalValue">140%</span> of 500%');
    expect(html.match(/levelNoData/g)).toHaveLength(3);
  });

  test('the bar describes credentials by masked label only', () => {
    const html = render(summariesFor({ claude: screenshotClaude() }));
    const label = html.match(/role="img" aria-label="([^"]+)"/)?.[1] ?? '';
    expect(label).toContain('7-day Fable 5: claude-t•••@1•••.dev.json 58%');
    for (const email of emails) expect(html).not.toContain(email);
  });

  test('the secondary toggle starts collapsed and names its provider', () => {
    const html = render(summariesFor({ claude: screenshotClaude() }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show more Claude limits"');
    expect(html).toContain('>Show</button>');
    expect(html).not.toContain('class="revealed"');
  });

  test('cells follow tab order and omit providers without credentials', () => {
    const html = render(
      summariesFor({
        kimi: [
          [
            'k@k.dev',
            {
              status: 'success',
              rows: [{ id: 'summary', label: 'Weekly limit', used: 0, limit: 100 }],
            },
          ],
        ],
        claude: screenshotClaude(),
      })
    );
    expect(html.indexOf('Claude')).toBeLessThan(html.indexOf('Kimi'));
    expect(html).not.toContain('Antigravity');
    expect(html.match(/<article/g)).toHaveLength(2);
  });

  test('renders nothing when the tab has no credentials', () => {
    expect(render([])).toBe('');
  });
});
