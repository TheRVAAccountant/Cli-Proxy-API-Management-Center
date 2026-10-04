import { describe, expect, test } from 'bun:test';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

const LOCALES = { 'zh-CN': zhCN, 'zh-TW': zhTW, ru } as const;
const SECTIONS = ['quota_management', 'xai_quota'] as const;

const tokens = (value: string) => (value.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).sort();

describe('quota translations', () => {
  for (const section of SECTIONS) {
    test(`${section} has the same non-empty keys and interpolation tokens in all four languages`, () => {
      const base = en[section] as Record<string, string>;
      const keys = Object.keys(base).sort();
      expect(keys.length).toBeGreaterThan(0);
      for (const [name, locale] of Object.entries(LOCALES)) {
        const strings = locale[section] as Record<string, string>;
        expect({ name, keys: Object.keys(strings).sort() }).toEqual({ name, keys });
        for (const key of keys) {
          expect(typeof strings[key] === 'string' && strings[key].trim().length > 0).toBe(true);
          expect({ name, key, tokens: tokens(strings[key]) }).toEqual({
            name,
            key,
            tokens: tokens(base[key]),
          });
        }
      }
    });
  }
});
