/**
 * Which windows each provider shows where: ledger columns, summary strip
 * primary and secondary totals, and what overflows.
 *
 * Keyed by provider window id. Labels are translated at fetch time and periods
 * vary by plan, so neither can identify a window reliably.
 */

import type { QuotaProviderType } from './providers/types';
import { XAI_WEEKLY_ROW_ID } from './resetSchedule';
import {
  ANTIGRAVITY_FIVE_HOUR_SUMMARY_ID,
  ANTIGRAVITY_WEEKLY_SUMMARY_ID,
  XAI_MONTHLY_WINDOW_ID,
  type CredentialQuotaProjection,
  type QuotaWindowCell,
} from './windowProjection';

/** One window id, the first present of several ids, or any id with a prefix. */
export type WindowMatcher = string | readonly string[] | { readonly prefix: string };

export interface ProviderWindowSpec {
  /** Ledger column slots in display order; 'groups' takes the reported groups instead. */
  columns: readonly WindowMatcher[] | 'groups';
  /** Candidates in priority order; the first one any loaded credential reports wins. */
  primary: readonly WindowMatcher[];
  secondary: readonly WindowMatcher[];
}

export const MAX_LEDGER_COLUMNS = 3;

export const QUOTA_WINDOW_SPECS: Record<QuotaProviderType, ProviderWindowSpec> = {
  claude: {
    columns: ['seven-day-fable', 'five-hour', 'seven-day'],
    primary: ['seven-day-fable', 'seven-day'],
    secondary: ['seven-day', 'five-hour'],
  },
  codex: {
    columns: ['five-hour', ['weekly', 'monthly']],
    primary: ['weekly', 'monthly'],
    secondary: ['five-hour'],
  },
  xai: {
    columns: [[XAI_WEEKLY_ROW_ID, XAI_MONTHLY_WINDOW_ID]],
    primary: [XAI_WEEKLY_ROW_ID, XAI_MONTHLY_WINDOW_ID],
    secondary: [],
  },
  kimi: {
    columns: ['summary', { prefix: 'limit-' }, 'monthly'],
    primary: ['summary', 'monthly'],
    secondary: ['monthly', { prefix: 'limit-' }],
  },
  antigravity: {
    columns: 'groups',
    primary: [ANTIGRAVITY_WEEKLY_SUMMARY_ID],
    secondary: [ANTIGRAVITY_FIVE_HOUR_SUMMARY_ID],
  },
  devin: {
    columns: ['daily', 'weekly'],
    primary: ['weekly', 'daily'],
    secondary: ['daily', 'weekly'],
  },
  meta: {
    columns: ['window', 'weekly'],
    primary: ['weekly', 'window'],
    secondary: ['window', 'weekly'],
  },
};

const isIdList = (matcher: WindowMatcher): matcher is readonly string[] => Array.isArray(matcher);

export const matchesWindow = (matcher: WindowMatcher, id: string): boolean => {
  if (typeof matcher === 'string') return matcher === id;
  if (isIdList(matcher)) return matcher.includes(id);
  return id.startsWith((matcher as { prefix: string }).prefix);
};

/** The cell a matcher selects; an id list prefers its earlier ids. */
export function findCell(
  cells: readonly QuotaWindowCell[],
  matcher: WindowMatcher
): QuotaWindowCell | undefined {
  if (isIdList(matcher)) {
    for (const id of matcher) {
      const cell = cells.find((candidate) => candidate.id === id);
      if (cell) return cell;
    }
    return undefined;
  }
  return cells.find((cell) => matchesWindow(matcher, cell.id));
}

const ledgerCells = (projection: CredentialQuotaProjection) =>
  projection.cells.filter((cell) => !cell.summaryOnly);

const matcherKey = (matcher: WindowMatcher): string => {
  if (typeof matcher === 'string') return matcher;
  if (isIdList(matcher)) return matcher.join('|');
  return `${(matcher as { prefix: string }).prefix}*`;
};

export interface LedgerColumn {
  key: string;
  matcher: WindowMatcher;
}

/**
 * Columns shared by one provider group, so cells line up across its rows.
 * Fixed specs keep the slots at least one loaded credential reports (every slot
 * while nothing has loaded yet); 'groups' takes reported groups in first-seen order.
 */
export function resolveLedgerColumns(
  provider: QuotaProviderType,
  projections: readonly CredentialQuotaProjection[]
): LedgerColumn[] {
  const spec = QUOTA_WINDOW_SPECS[provider];
  const loaded = projections.filter((projection) => projection.status === 'success');

  if (spec.columns === 'groups') {
    const ids: string[] = [];
    loaded.forEach((projection) =>
      ledgerCells(projection).forEach((cell) => {
        if (!ids.includes(cell.id)) ids.push(cell.id);
      })
    );
    return ids.slice(0, MAX_LEDGER_COLUMNS).map((id) => ({ key: id, matcher: id }));
  }

  const slots = spec.columns.map((matcher) => ({ key: matcherKey(matcher), matcher }));
  const reported =
    loaded.length === 0
      ? slots
      : slots.filter((slot) =>
          loaded.some((projection) => findCell(ledgerCells(projection), slot.matcher))
        );
  return reported.slice(0, MAX_LEDGER_COLUMNS);
}

export const cellForColumn = (
  projection: CredentialQuotaProjection,
  column: LedgerColumn
): QuotaWindowCell | null => findCell(ledgerCells(projection), column.matcher) ?? null;

/** Windows a row reports that no column shows. */
export function overflowCells(
  projection: CredentialQuotaProjection,
  columns: readonly LedgerColumn[]
): QuotaWindowCell[] {
  const shown = new Set(
    columns
      .map((column) => cellForColumn(projection, column)?.id)
      .filter((id): id is string => Boolean(id))
  );
  return ledgerCells(projection).filter((cell) => !shown.has(cell.id));
}

export interface SummaryWindowPick {
  primary: WindowMatcher | null;
  secondary: WindowMatcher | null;
  /** Every other ledger window some loaded credential reports, behind Show/Hide. */
  revealable: string[];
}

export function pickSummaryWindows(
  provider: QuotaProviderType,
  projections: readonly CredentialQuotaProjection[]
): SummaryWindowPick {
  const spec = QUOTA_WINDOW_SPECS[provider];
  const loaded = projections.filter((projection) => projection.status === 'success');
  const reported = (matcher: WindowMatcher) =>
    loaded.some((projection) => findCell(projection.cells, matcher));
  const pickedIds = (matcher: WindowMatcher | null) =>
    matcher === null
      ? []
      : loaded
          .map((projection) => findCell(projection.cells, matcher)?.id)
          .filter((id): id is string => Boolean(id));

  const primary = spec.primary.find(reported) ?? null;
  const primaryIds = new Set(pickedIds(primary));
  const secondary =
    spec.secondary.find(
      (matcher) => reported(matcher) && !pickedIds(matcher).every((id) => primaryIds.has(id))
    ) ?? null;
  const taken = new Set([...primaryIds, ...pickedIds(secondary)]);

  const revealable: string[] = [];
  loaded.forEach((projection) =>
    ledgerCells(projection).forEach((cell) => {
      if (!taken.has(cell.id) && !revealable.includes(cell.id)) revealable.push(cell.id);
    })
  );
  return { primary, secondary, revealable };
}
