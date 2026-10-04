import type { QuotaProviderType } from './providers/types';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** Provider tabs shown even at zero credentials; Devin and Meta appear only when used. */
export const QUOTA_CORE_TAB_TYPES: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
];

/** Ledger (grouped rows) is the default; Cards keeps the upstream grid. */
export const QUOTA_VIEW_MODES = ['ledger', 'cards'] as const;

export type QuotaViewMode = (typeof QUOTA_VIEW_MODES)[number];

export const DEFAULT_QUOTA_VIEW_MODE: QuotaViewMode = 'ledger';

/** 页级分页固定 20/页（卡片视图）。 */
export const QUOTA_PAGE_SIZE = 20;

/**
 * Credentials whose quota loads at once. Each issues two to four management
 * requests, which the shared request limiter caps at four in total.
 */
export const QUOTA_MAX_CREDENTIALS_IN_FLIGHT = 4;

/** 卡片排序：默认 = provider 分组序；soonest = 最快恢复优先。 */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
