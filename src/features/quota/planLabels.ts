/**
 * Plan labels shared by the card bodies and the ledger rows.
 *
 * Moved out of the per-provider bodies so the ledger's muted plan line ("Max")
 * reads exactly what the card's plan chip says. Pure: no React, no SCSS.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  AntigravityQuotaSubscription,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  MetaQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
} from '@/types';
import { PREMIUM_CODEX_PLAN_TYPES, normalizePlanType } from '@/utils/quota';
import type { QuotaProviderType } from './providers/types';

export const getClaudePlanLabel = (planType: string | null | undefined, t: TFunction) =>
  planType ? t(`claude_quota.${planType}`) : null;

export const getCodexPlanLabel = (planType: string | null | undefined, t: TFunction) => {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') {
    return t('codex_quota.plan_business_premium');
  }
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
    return t('codex_quota.plan_prolite');
  }
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
};

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

export const resolveXaiPlan = (
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
};

export const getXaiPlanLabel = (billing: XaiBillingSummary | null, t: TFunction) => {
  if (!billing) return null;
  if (billing.mode === 'paid-health') return billing.planLabel ?? t('xai_quota.plan_paid');
  if (billing.planLabel) return billing.planLabel;
  const plan = resolveXaiPlan(billing.monthlyLimitCents);
  return plan ? t(`xai_quota.${plan.labelKey}`) : null;
};

export const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

/** The plan line for one credential, or null when its provider reports none. */
export function resolveCredentialPlanLabel(
  provider: QuotaProviderType,
  quota: unknown,
  t: TFunction
): string | null {
  if (!quota || typeof quota !== 'object') return null;
  switch (provider) {
    case 'claude':
      return getClaudePlanLabel((quota as ClaudeQuotaState).planType, t);
    case 'codex':
      return getCodexPlanLabel((quota as CodexQuotaState).planType, t);
    case 'xai':
      return getXaiPlanLabel((quota as XaiQuotaState).billing ?? null, t);
    case 'antigravity':
      return getAntigravityPlanLabel((quota as AntigravityQuotaState).subscription, t);
    case 'devin':
      return (quota as DevinQuotaState).plan || null;
    case 'meta':
      return (quota as MetaQuotaState).data?.planName || null;
    case 'kimi':
      return null;
  }
}
