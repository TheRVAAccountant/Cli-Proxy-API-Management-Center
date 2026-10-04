/**
 * Provider summary strip: one cell per provider in the current tab, with the
 * remaining-capacity total ("409% of 500%"), one bar segment per credential, the
 * soonest reset, and the secondary window behind it.
 *
 * Totals cover the whole tab, ignoring search and pagination. Classes come in as
 * a prop (defaulting to the colocated module) so static-markup tests can render
 * it without a CSS pipeline.
 */

import { useState, type CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { ProviderSummary, SummarySegmentLevel, SummaryWindowTotal } from '../summary';
import { QuotaResetLine } from './QuotaResetLine';
import styles from './QuotaSummaryStrip.module.scss';

export const SUMMARY_STRIP_CLASS_KEYS = [
  'strip',
  'stripGrid',
  'cell',
  'cellHead',
  'provider',
  'providerIcon',
  'providerIconFallback',
  'count',
  'windowLabel',
  'total',
  'totalValue',
  'empty',
  'bar',
  'segment',
  'segmentFill',
  'levelHigh',
  'levelMedium',
  'levelLow',
  'levelNoData',
  'band',
  'reset',
  'secondary',
  'secondaryLabel',
  'secondaryValue',
  'toggle',
  'revealed',
  'revealedRow',
] as const;

export type SummaryStripClasses = Record<(typeof SUMMARY_STRIP_CLASS_KEYS)[number], string>;

const LEVEL_CLASS: Record<SummarySegmentLevel, keyof SummaryStripClasses> = {
  high: 'levelHigh',
  medium: 'levelMedium',
  low: 'levelLow',
  'no-data': 'levelNoData',
};

export interface QuotaSummaryStripProps {
  summaries: readonly ProviderSummary[];
  resolvedTheme: ResolvedTheme;
  /** Masked credential label for a segment's cache key (the bar's accessible summary). */
  labelFor: (key: string) => string;
  classes?: SummaryStripClasses;
  /** Injectable clock for tests and screenshots. */
  now?: number;
}

const percent = (value: number | null) => (value === null ? '--' : `${value}%`);

export function QuotaSummaryStrip({
  summaries,
  resolvedTheme,
  labelFor,
  classes = styles as unknown as SummaryStripClasses,
  now,
}: QuotaSummaryStripProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  if (summaries.length === 0) return null;

  const toggle = (provider: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });

  const totalLine = (window: SummaryWindowTotal) => (
    <Trans
      i18nKey="quota_management.summary_total"
      values={{ value: percent(window.total), total: `${window.denominator}%` }}
      components={{ strong: <span className={classes.totalValue} /> }}
    />
  );

  const barLabel = (window: SummaryWindowTotal) => {
    const values = window.segments
      ? window.segments.map((segment) =>
          t('quota_management.summary_segment', {
            name: labelFor(segment.key),
            value:
              segment.remaining === null
                ? t('quota_management.summary_no_data')
                : `${segment.remaining}%`,
          })
        )
      : (window.bands ?? []).map((band) =>
          t('quota_management.summary_band', {
            level: t(`quota_management.summary_level_${band.level.replace('-', '_')}`),
            count: band.count,
          })
        );
    return t('quota_management.summary_bar_label', {
      window: window.label ?? '',
      values: values.join(', '),
    });
  };

  return (
    <section className={classes.strip} aria-label={t('quota_management.summary_label')}>
      <div className={classes.stripGrid}>
        {summaries.map((summary) => {
          const { provider, primary, secondary, revealed } = summary;
          const typeLabel = getTypeLabel(t, provider);
          const iconSrc = getAuthFileIcon(provider, resolvedTheme);
          const isOpen = expanded.has(provider);
          return (
            <article key={provider} className={classes.cell}>
              <header className={classes.cellHead}>
                <span className={classes.provider}>
                  <span
                    className={classes.providerIcon}
                    style={
                      isThemeSurfaceIconProvider(provider)
                        ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                        : undefined
                    }
                  >
                    {iconSrc ? (
                      <img src={iconSrc} alt="" />
                    ) : (
                      <span className={classes.providerIconFallback}>
                        {typeLabel.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  {typeLabel}
                </span>
                <span className={classes.count}>
                  {summary.loadedCount < summary.credentialCount
                    ? t('quota_management.summary_reporting', {
                        loaded: summary.loadedCount,
                        count: summary.credentialCount,
                      })
                    : t('quota_management.summary_credentials', { count: summary.credentialCount })}
                </span>
              </header>

              {primary ? (
                <>
                  <div className={classes.windowLabel}>{primary.label}</div>
                  <div className={classes.total}>{totalLine(primary)}</div>
                  <div className={classes.bar} role="img" aria-label={barLabel(primary)}>
                    {primary.segments
                      ? primary.segments.map((segment) => (
                          <span
                            key={segment.key}
                            className={`${classes.segment} ${classes[LEVEL_CLASS[segment.level]]}`}
                          >
                            {segment.remaining !== null && (
                              <span
                                className={classes.segmentFill}
                                style={{ width: `${segment.remaining}%` } as CSSProperties}
                              />
                            )}
                          </span>
                        ))
                      : (primary.bands ?? []).map((band) => (
                          <span
                            key={band.level}
                            className={`${classes.band} ${classes[LEVEL_CLASS[band.level]]}`}
                            style={{ flexGrow: band.count } as CSSProperties}
                          />
                        ))}
                  </div>
                  <QuotaResetLine
                    className={classes.reset}
                    resetAtMs={primary.earliestResetAtMs}
                    emptyLabel={t('quota_management.no_reset_pending')}
                    now={now}
                  />
                </>
              ) : (
                <div className={classes.empty}>
                  <span className={classes.totalValue}>--</span>
                </div>
              )}

              {(secondary || revealed.length > 0) && (
                <div className={classes.secondary}>
                  {secondary && (
                    <>
                      <span className={classes.secondaryLabel}>{secondary.label}</span>
                      <span className={classes.secondaryValue}>{percent(secondary.total)}</span>
                    </>
                  )}
                  {revealed.length > 0 && (
                    <button
                      type="button"
                      className={classes.toggle}
                      aria-expanded={isOpen}
                      aria-label={t(
                        isOpen
                          ? 'quota_management.summary_hide_label'
                          : 'quota_management.summary_show_label',
                        { provider: typeLabel }
                      )}
                      onClick={() => toggle(provider)}
                    >
                      {t(
                        isOpen ? 'quota_management.summary_hide' : 'quota_management.summary_show'
                      )}
                    </button>
                  )}
                </div>
              )}
              {isOpen && (
                <ul className={classes.revealed}>
                  {revealed.map((window, index) => (
                    <li key={`${window.label}-${index}`} className={classes.revealedRow}>
                      <span className={classes.secondaryLabel}>{window.label}</span>
                      <span className={classes.secondaryValue}>{totalLine(window)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
