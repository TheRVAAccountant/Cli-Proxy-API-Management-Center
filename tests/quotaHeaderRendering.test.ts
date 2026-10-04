import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { QuotaHeader, type QuotaHeaderProps } from '@/features/quota/components/QuotaHeader';
import en from '@/i18n/locales/en.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const render = (overrides: Partial<QuotaHeaderProps> = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(QuotaHeader, {
        totalCount: 10,
        loadedCount: 10,
        attentionCount: 0,
        refreshing: false,
        disableControls: false,
        onRefreshAll: () => {},
        showEmails: false,
        onToggleEmails: () => {},
        ...overrides,
      })
    )
  );

describe('quota header', () => {
  test('renders the title, the credential and loaded counts, and both actions', () => {
    const html = render();
    expect(html).toContain('Quota Management');
    expect(html).toContain('10 credentials');
    expect(html).toContain('10 loaded');
    expect(html).toContain('Show emails');
    expect(html).toContain('>Refresh</button>');
    expect(html).toContain('aria-label="Refresh all credentials"');
  });

  test('Show emails keeps a fixed label and exposes its state with aria-pressed', () => {
    expect(render()).toContain('aria-pressed="false"');
    const pressed = render({ showEmails: true });
    expect(pressed).toContain('aria-pressed="true"');
    expect(pressed).toContain('Show emails');
  });

  test('Refresh stays enabled while loads run and reports busy instead', () => {
    const html = render({ refreshing: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Refresh all credentials"/);
    expect(render({ disableControls: true })).toMatch(/<button[^>]*disabled=""/);
  });
});
