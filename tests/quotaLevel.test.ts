import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuotaMeter } from '@/features/quota/components/QuotaMeter';
import { quotaLevel } from '@/features/quota/level';
import { QUOTA_CLASS_KEYS, type QuotaClassMap } from '@/features/quota/types';

const classes = Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])) as QuotaClassMap;
const meter = (percent: number | null) =>
  renderToStaticMarkup(createElement(QuotaMeter, { percent, classes }));

describe('quota level helper', () => {
  test('matches the meter boundaries exactly', () => {
    expect(quotaLevel(100)).toBe('high');
    expect(quotaLevel(70)).toBe('high');
    expect(quotaLevel(69.99)).toBe('medium');
    expect(quotaLevel(69)).toBe('medium');
    expect(quotaLevel(30)).toBe('medium');
    expect(quotaLevel(29.99)).toBe('low');
    expect(quotaLevel(29)).toBe('low');
    expect(quotaLevel(0)).toBe('low');
  });

  test('clamps out-of-range input', () => {
    expect(quotaLevel(140)).toBe('high');
    expect(quotaLevel(-5)).toBe('low');
  });

  test('the meter keeps its level classes and renders missing data as an empty medium fill', () => {
    expect(meter(70)).toContain('quotaBarFill quotaBarFillHigh');
    expect(meter(69.99)).toContain('quotaBarFill quotaBarFillMedium');
    expect(meter(29.99)).toContain('quotaBarFill quotaBarFillLow');
    const unknown = meter(null);
    expect(unknown).toContain('quotaBarFill quotaBarFillMedium');
    expect(unknown).toContain('width:0%');
  });
});
