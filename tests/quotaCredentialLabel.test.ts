import { describe, expect, test } from 'bun:test';
import {
  buildCredentialLabels,
  credentialDisplayLabel,
  maskCredentialText,
  maskEmail,
  maskEmailsInText,
} from '@/features/quota/credentialLabel';
import { getQuotaCacheKey } from '@/utils/quota/identity';

describe('credential label masking', () => {
  test('masks the backend email inside the name and reveals it when emails are shown', () => {
    const file = { name: 'claude-tom@1abc.dev.json', type: 'claude', email: 'tom@1abc.dev' };
    expect(credentialDisplayLabel(file, false)).toBe('claude-t•••@1•••.dev.json');
    expect(credentialDisplayLabel(file, true)).toBe('claude-tom@1abc.dev.json');
  });

  test('keeps the first characters and the top-level domain only', () => {
    expect(maskEmail('first.last@mail.example.co.uk')).toBe('f•••@m•••.uk');
    expect(maskEmail('a@b')).toBe('a•••@b•••');
    expect(maskEmail('no-at-sign')).toBe('•••');
  });

  test('matches the email case-insensitively', () => {
    const file = { name: 'claude-Tom@1ABC.dev.json', type: 'claude', email: 'tom@1abc.dev' };
    expect(credentialDisplayLabel(file, false)).toBe('claude-t•••@1•••.dev.json');
  });

  test('masks names whose providers rewrote the email punctuation', () => {
    expect(
      credentialDisplayLabel(
        { name: 'claude-tom_1abc.dev.json', type: 'claude', email: 'tom@1abc.dev' },
        false
      )
    ).toBe('claude-t•••@1•••.dev.json');
    expect(
      credentialDisplayLabel(
        {
          name: 'meta-first.last_work_example.com-1a2b3c4d.json',
          type: 'meta',
          email: 'first.last+work@example.com',
        },
        false
      )
    ).toBe('meta-f•••@e•••.com-1a2b3c4d.json');
    expect(
      credentialDisplayLabel(
        {
          name: 'xai-first.last-work@example.com.json',
          type: 'xai',
          email: 'first.last+work@example.com',
        },
        false
      )
    ).toBe('xai-f•••@e•••.com.json');
  });

  test('masks only the email in a Codex name, keeping prefix, hash and plan visible', () => {
    const file = {
      name: 'codex-abc12345-first-last@example.com-team.json',
      type: 'codex',
      email: 'first-last@example.com',
    };
    expect(credentialDisplayLabel(file, false)).toBe('codex-abc12345-f•••@e•••.com-team.json');
  });

  test('falls back to masking email-shaped text when the backend sent no email', () => {
    const label = credentialDisplayLabel(
      { name: 'claude-sam@team.io.json', type: 'claude' },
      false
    );
    expect(label).not.toContain('sam@team');
    expect(label).toContain('•••');
  });

  test('leaves names without an email unchanged', () => {
    expect(credentialDisplayLabel({ name: 'kimi-4f2a.json', type: 'kimi' }, false)).toBe(
      'kimi-4f2a.json'
    );
  });

  test('never reads account, which can be an API key', () => {
    const file = { name: 'api-key.json', type: 'codex', account: 'sk-secret-value' };
    expect(credentialDisplayLabel(file, false)).not.toContain('sk-secret');
    expect(credentialDisplayLabel(file, true)).not.toContain('sk-secret');
  });

  test('masks both parts of a Devin name and email label', () => {
    const file = {
      name: 'devin-sam@team.io.json',
      type: 'devin',
      email: 'sam@team.io',
      authIndex: '7',
    };
    const label = credentialDisplayLabel(file, false);
    expect(label).toBe('devin-s•••@t•••.io.json · s•••@t•••.io');
    expect(label).not.toContain('sam@team');
  });

  test('masks emails quoted in upstream error text', () => {
    const file = { name: 'claude-x.json', type: 'claude', email: 'tom@1abc.dev' };
    expect(maskCredentialText('token for tom@1abc.dev expired', file, false)).toBe(
      'token for t•••@1•••.dev expired'
    );
    expect(maskCredentialText('token for tom@1abc.dev expired', file, true)).toContain(
      'tom@1abc.dev'
    );
    expect(maskEmailsInText('contact ops@corp.example.com now')).toBe('contact o•••@c•••.com now');
  });

  test('labels that collide after masking gain the shortest unique auth-index suffix', () => {
    const first = {
      name: 'claude-tom@acme.dev.json',
      type: 'claude',
      email: 'tom@acme.dev',
      auth_index: 'a1b2c3d4e5f60001',
    };
    const second = {
      name: 'claude-tina@apex.dev.json',
      type: 'claude',
      email: 'tina@apex.dev',
      auth_index: 'a1b2c3d4e5f60002',
    };
    const solo = { name: 'kimi-1.json', type: 'kimi' };
    const labels = buildCredentialLabels([first, second, solo], false);

    expect(labels.get(getQuotaCacheKey(first))).toBe('claude-t•••@a•••.dev.json #a1b2c3d4e5f60001');
    expect(labels.get(getQuotaCacheKey(second))).toBe(
      'claude-t•••@a•••.dev.json #a1b2c3d4e5f60002'
    );
    expect(labels.get(getQuotaCacheKey(solo))).toBe('kimi-1.json');

    const shown = buildCredentialLabels([first, second], true);
    expect(shown.get(getQuotaCacheKey(first))).toBe('claude-tom@acme.dev.json');
  });

  test('collision suffixes stay short when auth indexes differ early', () => {
    const labels = buildCredentialLabels(
      [
        {
          name: 'claude-tom@acme.dev.json',
          type: 'claude',
          email: 'tom@acme.dev',
          auth_index: 'f00d1234',
        },
        {
          name: 'claude-tia@acme.dev.json',
          type: 'claude',
          email: 'tia@acme.dev',
          auth_index: 'beef5678',
        },
      ],
      false
    );
    expect([...labels.values()]).toEqual([
      'claude-t•••@a•••.dev.json #f00d',
      'claude-t•••@a•••.dev.json #beef',
    ]);
  });
});
