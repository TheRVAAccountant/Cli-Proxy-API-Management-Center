/**
 * Ledger view: credentials grouped by provider, one row per credential.
 *
 * Shows every filtered credential (no pagination). Rows mount neither Claude
 * reset grants nor Codex reset credits; the Cards view keeps both. Classes come
 * in as a prop (defaulting to the colocated module) so static-markup tests can
 * render it.
 */

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaProviderType } from '../providers/types';
import { resolveLedgerColumns } from '../windowSpecs';
import { QuotaLedgerRow, type QuotaLedgerRowModel } from './QuotaLedgerRow';
import styles from './QuotaLedger.module.scss';

export const LEDGER_CLASS_KEYS = [
  'ledger',
  'group',
  'groupHeading',
  'groupIcon',
  'groupCount',
  'rows',
  'row',
  'identity',
  'name',
  'plan',
  'cells',
  'cell',
  'cellHead',
  'cellLabel',
  'cellValue',
  'track',
  'fill',
  'levelHigh',
  'levelMedium',
  'levelLow',
  'reset',
  'absent',
  'loading',
  'skeleton',
  'srOnly',
  'status',
  'hint',
  'errorText',
  'actions',
  'badge',
  'overflowToggle',
  'overflow',
  'refresh',
  'spinning',
] as const;

export type LedgerClasses = Record<(typeof LEDGER_CLASS_KEYS)[number], string>;

export interface QuotaLedgerGroupModel {
  type: QuotaProviderType;
  rows: QuotaLedgerRowModel[];
}

export interface QuotaLedgerProps {
  groups: readonly QuotaLedgerGroupModel[];
  resolvedTheme: ResolvedTheme;
  onRefresh: (entry: QuotaFileEntry) => void;
  classes?: LedgerClasses;
  /** Injectable clock for tests and screenshots. */
  now?: number;
}

export function QuotaLedger({
  groups,
  resolvedTheme,
  onRefresh,
  classes = styles as unknown as LedgerClasses,
  now,
}: QuotaLedgerProps) {
  const { t } = useTranslation();
  const idBase = useId();

  return (
    <div className={classes.ledger}>
      {groups.map((group) => {
        const typeLabel = getTypeLabel(t, group.type);
        const iconSrc = getAuthFileIcon(group.type, resolvedTheme);
        const headingId = `${idBase}-${group.type}`;
        const columns = resolveLedgerColumns(
          group.type,
          group.rows.map((row) => row.projection)
        );
        return (
          <section key={group.type} className={classes.group} aria-labelledby={headingId}>
            <h2 id={headingId} className={classes.groupHeading}>
              {iconSrc && (
                <span
                  className={classes.groupIcon}
                  style={
                    isThemeSurfaceIconProvider(group.type)
                      ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                      : undefined
                  }
                >
                  <img src={iconSrc} alt="" />
                </span>
              )}
              {typeLabel}
              <span className={classes.groupCount}>{group.rows.length}</span>
            </h2>
            <ul className={classes.rows}>
              {group.rows.map((row) => (
                <QuotaLedgerRow
                  key={row.key}
                  row={row}
                  columns={columns}
                  classes={classes}
                  onRefresh={onRefresh}
                  now={now}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
