import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  getAntigravityPlanLabel,
  getCodexPlanLabel,
  getXaiPlanLabel,
  resolveCredentialPlanLabel,
  resolveXaiPlan,
} from '@/features/quota/planLabels';
import type { XaiBillingSummary } from '@/types';

const t = ((key: string) => key) as unknown as TFunction;

const billing = (overrides: Partial<XaiBillingSummary>): XaiBillingSummary => ({
  mode: 'billing',
  periodType: 'weekly',
  usagePercent: null,
  productUsage: [],
  monthlyLimitCents: null,
  usedCents: null,
  includedUsedCents: null,
  onDemandCapCents: null,
  onDemandUsedCents: null,
  onDemandUsedPercent: null,
  usedPercent: null,
  ...overrides,
});

describe('quota plan labels', () => {
  test('Claude translates its stored plan key', () => {
    expect(resolveCredentialPlanLabel('claude', { planType: 'plan_max' }, t)).toBe(
      'claude_quota.plan_max'
    );
    expect(resolveCredentialPlanLabel('claude', { planType: null }, t)).toBeNull();
  });

  test('Codex maps normalized plan types and keeps unknown ones verbatim', () => {
    expect(getCodexPlanLabel('pro', t)).toBe('codex_quota.plan_pro');
    expect(getCodexPlanLabel('plus', t)).toBe('codex_quota.plan_plus');
    expect(getCodexPlanLabel('team', t)).toBe('codex_quota.plan_team');
    expect(getCodexPlanLabel('free', t)).toBe('codex_quota.plan_free');
    expect(getCodexPlanLabel('self_serve_business_prolite', t)).toBe(
      'codex_quota.plan_business_premium'
    );
    expect(getCodexPlanLabel('enterprise-x', t)).toBe('enterprise-x');
    expect(getCodexPlanLabel(null, t)).toBeNull();
  });

  test('xAI prefers the settings label, then the monthly-limit tier, then paid health', () => {
    expect(getXaiPlanLabel(billing({ planLabel: 'SuperGrok Heavy' }), t)).toBe('SuperGrok Heavy');
    expect(getXaiPlanLabel(billing({ monthlyLimitCents: 150_000 }), t)).toBe(
      'xai_quota.plan_supergrok_heavy'
    );
    expect(resolveXaiPlan(15_000)).toEqual({ labelKey: 'plan_supergrok', premium: false });
    expect(getXaiPlanLabel(billing({ mode: 'paid-health' }), t)).toBe('xai_quota.plan_paid');
    expect(getXaiPlanLabel(billing({}), t)).toBeNull();
    expect(getXaiPlanLabel(null, t)).toBeNull();
  });

  test('Antigravity resolves known plans and falls back to tier names', () => {
    expect(getAntigravityPlanLabel({ plan: 'ultra', tierName: null, tierId: null }, t)).toBe(
      'antigravity_subscription.plan_ultra'
    );
    expect(getAntigravityPlanLabel({ plan: null, tierName: 'Custom', tierId: 'c1' }, t)).toBe(
      'Custom'
    );
    expect(getAntigravityPlanLabel({ plan: 'unknown', tierName: null, tierId: null }, t)).toBe(
      'antigravity_subscription.plan_unknown'
    );
    expect(getAntigravityPlanLabel(null, t)).toBeNull();
  });

  test('Devin and Meta show their reported plan names; Kimi has none', () => {
    expect(resolveCredentialPlanLabel('devin', { plan: 'Pro' }, t)).toBe('Pro');
    expect(resolveCredentialPlanLabel('meta', { data: { planName: 'Muse', windows: [] } }, t)).toBe(
      'Muse'
    );
    expect(resolveCredentialPlanLabel('kimi', { rows: [] }, t)).toBeNull();
    expect(resolveCredentialPlanLabel('claude', undefined, t)).toBeNull();
  });
});
