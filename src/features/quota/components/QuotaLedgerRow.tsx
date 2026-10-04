/**
 * One ledger row: the credential label and plan, up to three window cells, an
 * overflow control for the rest, and the row's own "Refresh quota" action.
 */

import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { quotaLevel } from '../level';
import type { LedgerRowState } from '../ledger';
import type { QuotaFileEntry } from '../logic';
import {
  displayPercent,
  type CredentialQuotaProjection,
  type QuotaWindowCell,
} from '../windowProjection';
import { cellForColumn, overflowCells, type LedgerColumn } from '../windowSpecs';
import { QuotaResetLine } from './QuotaResetLine';
import type { LedgerClasses } from './QuotaLedger';

export interface QuotaLedgerRowModel {
  key: string;
  entry: QuotaFileEntry;
  /** Credential label, masked unless emails are shown. */
  label: string;
  projection: CredentialQuotaProjection;
  state: LedgerRowState;
  /** Masked, human-readable error for error rows. */
  errorMessage: string | null;
  canRefresh: boolean;
  /** The credential's quota request is in flight. */
  inFlight: boolean;
}

export interface QuotaLedgerRowProps {
  row: QuotaLedgerRowModel;
  columns: readonly LedgerColumn[];
  classes: LedgerClasses;
  onRefresh: (entry: QuotaFileEntry) => void;
  now?: number;
}

const LEVEL_CLASS = { high: 'levelHigh', medium: 'levelMedium', low: 'levelLow' } as const;

export function QuotaLedgerRow({ row, columns, classes, onRefresh, now }: QuotaLedgerRowProps) {
  const { t } = useTranslation();
  const [showOverflow, setShowOverflow] = useState(false);
  const { projection, state, label } = row;
  const overflow = state.kind === 'loaded' ? overflowCells(projection, columns) : [];

  const renderCell = (cell: QuotaWindowCell) => {
    const value = displayPercent(cell.remaining);
    const level = cell.levelValue === null ? null : quotaLevel(cell.levelValue);
    return (
      <div key={cell.id} className={classes.cell}>
        <div className={classes.cellHead}>
          <span className={classes.cellLabel}>{cell.label}</span>
          <span
            className={classes.cellValue}
            title={
              value === null && projection.usageUnavailable
                ? t('xai_quota.usage_unavailable')
                : undefined
            }
          >
            {value === null ? '--' : `${value}%`}
          </span>
        </div>
        <div className={classes.track}>
          {value !== null && level && (
            <span
              className={`${classes.fill} ${classes[LEVEL_CLASS[level]]}`}
              style={{ width: `${cell.remaining}%` } as CSSProperties}
            />
          )}
        </div>
        <QuotaResetLine
          className={classes.reset}
          resetAtMs={cell.resetAtMs}
          resetLabel={cell.resetLabel}
          resetPassed={cell.resetPassed}
          emptyLabel={t('quota_management.no_reset_pending')}
          now={now}
        />
      </div>
    );
  };

  const notLoadedHint =
    state.kind !== 'not-loaded' || state.reason === null
      ? null
      : state.reason === 'billable'
        ? t('xai_quota.billable_probe_blocked')
        : state.reason === 'rate-limited'
          ? t('quota_management.ledger_rate_limited')
          : t('quota_management.ledger_stopped');

  return (
    <li className={classes.row}>
      <div className={classes.identity}>
        <span className={classes.name} title={label}>
          {label}
        </span>
        {projection.planLabel && <span className={classes.plan}>{projection.planLabel}</span>}
      </div>

      <div className={classes.cells}>
        {state.kind === 'loaded' ? (
          columns.map((column) => {
            const cell = cellForColumn(projection, column);
            return cell ? (
              renderCell(cell)
            ) : (
              <div key={column.key} className={classes.cell}>
                <span
                  className={classes.absent}
                  title={t('quota_management.ledger_window_absent')}
                  aria-label={t('quota_management.ledger_window_absent')}
                >
                  —
                </span>
              </div>
            );
          })
        ) : state.kind === 'loading' ? (
          <div className={classes.loading} aria-busy="true">
            <span className={classes.srOnly}>{t('quota_management.ledger_loading')}</span>
            {columns.map((column) => (
              <span key={column.key} className={classes.skeleton} aria-hidden="true" />
            ))}
          </div>
        ) : state.kind === 'queued' ? (
          <span className={classes.status}>{t('quota_management.ledger_queued')}</span>
        ) : state.kind === 'error' ? (
          <span className={classes.errorText}>{row.errorMessage}</span>
        ) : (
          <span className={classes.status}>
            {t('quota_management.ledger_not_loaded')}
            {notLoadedHint && <span className={classes.hint}>{notLoadedHint}</span>}
          </span>
        )}
      </div>

      <div className={classes.actions}>
        {state.kind === 'loaded' && state.queued && (
          <span className={classes.badge}>{t('quota_management.ledger_queued')}</span>
        )}
        {overflow.length > 0 && (
          <button
            type="button"
            className={classes.overflowToggle}
            aria-expanded={showOverflow}
            aria-label={t('quota_management.ledger_overflow_label', {
              count: overflow.length,
              name: label,
            })}
            onClick={() => setShowOverflow((shown) => !shown)}
          >
            {t('quota_management.ledger_overflow', { count: overflow.length })}
          </button>
        )}
        <button
          type="button"
          className={classes.refresh}
          onClick={() => onRefresh(row.entry)}
          disabled={!row.canRefresh || row.inFlight}
          aria-label={t('quota_management.ledger_refresh_label', { name: label })}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw
            size={13}
            aria-hidden="true"
            className={row.inFlight || state.kind === 'loading' ? classes.spinning : undefined}
          />
          {t('auth_files.quota_refresh_single')}
        </button>
      </div>

      {showOverflow && overflow.length > 0 && (
        <div className={classes.overflow}>{overflow.map((cell) => renderCell(cell))}</div>
      )}
    </li>
  );
}
