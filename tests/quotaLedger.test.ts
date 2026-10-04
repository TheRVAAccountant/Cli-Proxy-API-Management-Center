import { describe, expect, test } from 'bun:test';
import {
  groupLedgerEntries,
  orderEntriesByKeys,
  resolveLedgerRowState,
} from '@/features/quota/ledger';
import {
  filterEntriesBySearch,
  sortQuotaEntries,
  type QuotaFileEntry,
} from '@/features/quota/logic';

const entry = (name: string, type: QuotaFileEntry['type']): QuotaFileEntry => ({
  file: { name, type, email: `${name.split('.')[0]}@example.com` },
  type,
});

const names = (entries: QuotaFileEntry[]) => entries.map((candidate) => candidate.file.name);

describe('ledger grouping and order', () => {
  test('groups follow tab order and keep row order inside each group', () => {
    const groups = groupLedgerEntries([
      entry('k1.json', 'kimi'),
      entry('c2.json', 'claude'),
      entry('x1.json', 'codex'),
      entry('c1.json', 'claude'),
    ]);
    expect(groups.map((group) => [group.type, names(group.entries)])).toEqual([
      ['claude', ['c2.json', 'c1.json']],
      ['codex', ['x1.json']],
      ['kimi', ['k1.json']],
    ]);
  });

  test('soonest-first sorting orders rows within their group, unknown resets last', () => {
    const entries = [
      entry('a.json', 'claude'),
      entry('b.json', 'claude'),
      entry('c.json', 'claude'),
    ];
    const sorted = sortQuotaEntries(entries, 'soonest', ({ file }) =>
      file.name === 'c.json' ? 1 : file.name === 'b.json' ? 5 : null
    );
    expect(names(groupLedgerEntries(sorted)[0].entries)).toEqual(['c.json', 'b.json', 'a.json']);
  });

  test('a remembered order holds rows in place and appends new ones in incoming order', () => {
    const entries = [
      entry('a.json', 'claude'),
      entry('b.json', 'claude'),
      entry('new.json', 'claude'),
    ];
    expect(names(orderEntriesByKeys(entries, ['b.json', 'a.json']))).toEqual([
      'b.json',
      'a.json',
      'new.json',
    ]);
  });

  test('search filters ledger rows by file name or email', () => {
    const entries = [entry('alpha.json', 'claude'), entry('beta.json', 'codex')];
    expect(names(filterEntriesBySearch(entries, 'beta@'))).toEqual(['beta.json']);
  });
});

describe('ledger row state', () => {
  const base = { queued: false, notLoadedReason: null, billableOnly: false } as const;

  test('loaded rows keep their numbers while queued for a per-visit reload', () => {
    expect(resolveLedgerRowState({ ...base, status: 'success', queued: true })).toEqual({
      kind: 'loaded',
      queued: true,
    });
  });

  test('loading, queued, and error states are distinct', () => {
    expect(resolveLedgerRowState({ ...base, status: 'loading' })).toEqual({ kind: 'loading' });
    expect(resolveLedgerRowState({ ...base, status: 'idle', queued: true })).toEqual({
      kind: 'queued',
    });
    expect(resolveLedgerRowState({ ...base, status: 'error' })).toEqual({ kind: 'error' });
  });

  test('not-loaded rows carry their reason, and paid xAI explains the billable probe', () => {
    expect(resolveLedgerRowState({ ...base, status: 'idle' })).toEqual({
      kind: 'not-loaded',
      reason: null,
    });
    expect(resolveLedgerRowState({ ...base, status: 'idle', billableOnly: true })).toEqual({
      kind: 'not-loaded',
      reason: 'billable',
    });
    expect(
      resolveLedgerRowState({ ...base, status: 'idle', notLoadedReason: 'rate-limited' })
    ).toEqual({ kind: 'not-loaded', reason: 'rate-limited' });
  });
});
