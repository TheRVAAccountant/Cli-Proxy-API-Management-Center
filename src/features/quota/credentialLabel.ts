/**
 * Credential labels for the quota page, with emails masked unless the viewer
 * pressed "Show emails".
 *
 * Masking is display privacy for screen sharing, not a security boundary: the
 * raw names stay in memory and search still matches them. Two rules from
 * `src/features/authFiles/identity.ts` hold here:
 * - `account` is never read (for API-key credentials it is the key itself);
 * - no identity is ever derived from a filename. This module only hides text.
 *   It masks the backend-provided email first and then anything else shaped
 *   like an email, so over-masking is the failure mode, never a leak.
 */

import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';

const MASK = '•••';

/** `tom@1abc.dev` → `t•••@1•••.dev`: first character of the local part and domain, plus the TLD. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return MASK;
  const local = email.slice(0, at);
  const labels = email
    .slice(at + 1)
    .split('.')
    .filter(Boolean);
  const head = labels[0] ? `${labels[0][0]}${MASK}` : MASK;
  const tld = labels.length > 1 ? `.${labels[labels.length - 1]}` : '';
  return `${local[0]}${MASK}@${head}${tld}`;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The backend email as it may appear inside a filename. Providers sanitize names
 * differently (Meta turns `@` and `+` into `_`, xAI turns `+` into `-`), so any
 * punctuation in the email matches any single punctuation character.
 */
const emailInNamePattern = (email: string) =>
  new RegExp(
    Array.from(email)
      .map((char) => (/[a-z0-9]/i.test(char) ? escapeRegExp(char) : '[^a-z0-9]'))
      .join(''),
    'gi'
  );

const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Hide every email in display text: the backend email first, then anything email-shaped. */
export function maskEmailsInText(text: string, email?: string | null): string {
  const known = typeof email === 'string' ? email.trim() : '';
  const withKnown = known.includes('@')
    ? text.replace(emailInNamePattern(known), maskEmail(known))
    : text;
  return withKnown.replace(EMAIL_SHAPED, (match) => maskEmail(match));
}

/** Text shown for one credential, masked unless emails are shown. */
export function credentialDisplayLabel(file: AuthFileItem, showEmails: boolean): string {
  const label = getQuotaDisplayName(file);
  return showEmails ? label : maskEmailsInText(label, file.email);
}

/** Masks free text (toasts, upstream error messages) that may quote a credential's email. */
export function maskCredentialText(text: string, file: AuthFileItem, showEmails: boolean): string {
  return showEmails ? text : maskEmailsInText(text, file.email);
}

const MIN_SUFFIX_LENGTH = 4;

/**
 * Labels keyed by quota cache key. Masking keeps one character of each part, so
 * accounts on one domain can collapse to the same label; those get the shortest
 * unique auth-index prefix (at least four characters) as a suffix.
 */
export function buildCredentialLabels(
  files: readonly AuthFileItem[],
  showEmails: boolean
): Map<string, string> {
  const labels = new Map<string, string>();
  const groups = new Map<string, AuthFileItem[]>();
  files.forEach((file) => {
    const label = credentialDisplayLabel(file, showEmails);
    labels.set(getQuotaCacheKey(file), label);
    const group = groups.get(label) ?? [];
    group.push(file);
    groups.set(label, group);
  });

  groups.forEach((group, label) => {
    if (group.length < 2) return;
    const ids = group.map(
      (file, index) => normalizeAuthIndex(file['auth_index'] ?? file.authIndex) ?? `${index + 1}`
    );
    const longest = Math.max(...ids.map((id) => id.length));
    let length = Math.min(MIN_SUFFIX_LENGTH, longest);
    while (length < longest && new Set(ids.map((id) => id.slice(0, length))).size < ids.length) {
      length += 1;
    }
    group.forEach((file, index) => {
      labels.set(getQuotaCacheKey(file), `${label} #${ids[index].slice(0, length)}`);
    });
  });
  return labels;
}
