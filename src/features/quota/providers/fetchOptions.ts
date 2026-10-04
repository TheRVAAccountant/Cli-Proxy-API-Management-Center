/**
 * Per-call quota fetch options.
 *
 * Billable probes (today: xAI's paid-health chat completion) run only when a
 * person asked for one credential. Bulk loads never send them. The parameter is
 * required on the fetch contract so the compiler flags every caller; at runtime
 * an omitted or partial value stays non-billable, because tests are not
 * type-checked.
 */
export interface QuotaFetchOptions {
  /** True only for a per-credential action such as a row or card "Refresh quota". */
  allowBillable: boolean;
}

/** Bulk loads: automatic page loads and header refresh. */
export const BULK_FETCH_OPTIONS: QuotaFetchOptions = Object.freeze({ allowBillable: false });

/** A person refreshing one credential. */
export const SINGLE_CREDENTIAL_FETCH_OPTIONS: QuotaFetchOptions = Object.freeze({
  allowBillable: true,
});

export const allowsBillableProbe = (options?: Partial<QuotaFetchOptions>): boolean =>
  options?.allowBillable === true;

const BILLABLE_PROBE_BLOCKED_CODE = 'billable_probe_blocked';

/**
 * A fetch stopped before sending a billable request. Loaders treat it as
 * "not loaded" rather than as a failure; `cause` keeps the free-path error.
 */
export class BillableProbeBlockedError extends Error {
  readonly code = BILLABLE_PROBE_BLOCKED_CODE;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'BillableProbeBlockedError';
    this.cause = cause;
  }
}

export const isBillableProbeBlockedError = (error: unknown): error is BillableProbeBlockedError =>
  error instanceof BillableProbeBlockedError ||
  (typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === BILLABLE_PROBE_BLOCKED_CODE);
