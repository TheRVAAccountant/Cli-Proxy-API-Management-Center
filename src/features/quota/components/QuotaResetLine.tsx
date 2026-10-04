/**
 * Reset line for the summary strip and ledger cells: relative first, then the
 * absolute instant ("in 1 day · 09/12, 23:00").
 *
 * Builds on `buildResetDisplay` like the card bodies, but does not extend
 * `QuotaResetLabel`: that component renders absolute-first markup bound to the
 * `QuotaClassMap` classes shared with the Auth Files page.
 */

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';

export interface QuotaResetLineProps {
  resetAtMs: number | null;
  /** Provider-formatted label or relative hint, used only when there is no instant. */
  resetLabel?: string | null;
  /** The reported reset already passed; the window's numbers are stale until refreshed. */
  resetPassed?: boolean;
  /** Shown when nothing is scheduled; omit to render nothing. */
  emptyLabel?: string;
  className?: string;
  /** Injectable clock for tests; defaults to the shared minute clock. */
  now?: number;
}

export function QuotaResetLine({
  resetAtMs,
  resetLabel = null,
  resetPassed = false,
  emptyLabel,
  className,
  now: nowProp,
}: QuotaResetLineProps) {
  const { t, i18n } = useTranslation();
  const tick = useNow(nowProp === undefined);
  const now = nowProp ?? tick;

  if (resetPassed) {
    return <span className={className}>{t('quota_management.reset_passed')}</span>;
  }

  const display = buildResetDisplay(
    resetAtMs === null ? resetLabel : null,
    resetAtMs,
    now,
    i18n.resolvedLanguage
  );
  if (!display) {
    return emptyLabel ? <span className={className}>{emptyLabel}</span> : null;
  }
  return (
    <span className={className}>
      {display.relative ? `${display.relative} · ${display.absolute}` : display.absolute}
    </span>
  );
}
