import { describe, expect, test } from 'bun:test';
import {
  isExcludedFromBulkLoad,
  isQuotaListSettled,
  selectAutoLoadTargets,
  selectRefreshTargets,
} from '@/features/quota/autoLoad';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaLoadStatus } from '@/features/quota/windowProjection';

const entry = (name: string, type: QuotaFileEntry['type'], extra = {}): QuotaFileEntry => ({
  file: { name, type, ...extra },
  type,
});

const entries = [
  entry('idle.json', 'claude'),
  entry('loaded.json', 'claude'),
  entry('errored.json', 'codex'),
  entry('loading.json', 'codex'),
  entry('queued.json', 'kimi'),
  entry('attempted.json', 'kimi'),
  entry('disabled.json', 'claude', { disabled: true }),
  entry('paid.json', 'xai', { using_api: true, prefix: 'paid' }),
  entry('free.json', 'xai'),
];

const statuses: Record<string, QuotaLoadStatus> = {
  'loaded.json': 'success',
  'errored.json': 'error',
  'loading.json': 'loading',
};
const statusFor = (candidate: QuotaFileEntry) => statuses[candidate.file.name] ?? 'idle';
const names = (selected: QuotaFileEntry[]) => selected.map((candidate) => candidate.file.name);

describe('quota auto-load eligibility', () => {
  test('waits for a settled list in the current session', () => {
    const settled = {
      connected: true,
      loading: false,
      hasError: false,
      filesGeneration: 3,
      sessionGeneration: 3,
    };
    expect(isQuotaListSettled(settled)).toBe(true);
    expect(isQuotaListSettled({ ...settled, loading: true })).toBe(false);
    expect(isQuotaListSettled({ ...settled, hasError: true })).toBe(false);
    expect(isQuotaListSettled({ ...settled, filesGeneration: 2 })).toBe(false);
    expect(isQuotaListSettled({ ...settled, filesGeneration: null })).toBe(false);
    expect(isQuotaListSettled({ ...settled, connected: false })).toBe(false);
  });

  test('Covers AE6. bulk loads skip disabled and recognized paid xAI credentials', () => {
    expect(
      isExcludedFromBulkLoad(entry('paid.json', 'xai', { using_api: true, prefix: 'paid' }))
    ).toBe(true);
    expect(isExcludedFromBulkLoad(entry('free.json', 'xai'))).toBe(false);
    expect(isExcludedFromBulkLoad(entry('off.json', 'claude', { disabled: true }))).toBe(true);
  });

  test('automatic loads try each credential once per visit, loaded or not', () => {
    const selected = selectAutoLoadTargets(entries, {
      statusFor,
      isPending: (key) => key === 'queued.json',
      wasAttempted: (key) => key === 'attempted.json',
    });
    expect(names(selected)).toEqual(['idle.json', 'loaded.json', 'errored.json', 'free.json']);
  });

  test('an errored credential is not retried automatically within the same visit', () => {
    const attempted = new Set(['errored.json']);
    const selected = selectAutoLoadTargets([entry('errored.json', 'codex')], {
      statusFor: () => 'error',
      isPending: () => false,
      wasAttempted: (key) => attempted.has(key),
    });
    expect(selected).toEqual([]);
  });

  test('a Devin credential is selected once per visit even when the effect re-runs', () => {
    const devin = [entry('devin.json', 'devin', { authIndex: '1' })];
    const attempted = new Set<string>();
    const context = {
      statusFor: () => 'idle' as const,
      isPending: () => false,
      wasAttempted: (key: string) => attempted.has(key),
    };
    const first = selectAutoLoadTargets(devin, context);
    expect(first).toHaveLength(1);
    attempted.add('devin.json\u00001');
    expect(selectAutoLoadTargets(devin, context)).toEqual([]);
  });

  test('header Refresh includes loaded and errored credentials but never paid xAI or in-progress ones', () => {
    expect(names(selectRefreshTargets(entries, { statusFor }))).toEqual([
      'idle.json',
      'loaded.json',
      'errored.json',
      'queued.json',
      'attempted.json',
      'free.json',
    ]);
  });
});
