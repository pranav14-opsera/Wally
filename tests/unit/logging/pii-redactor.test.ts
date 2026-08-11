import { describe, expect, it } from 'vitest';

import { buildRedactConfig, DEFAULT_PII_PATHS } from '../../../src/logging/pii-redactor.js';

describe('DEFAULT_PII_PATHS', () => {
  it('includes the mandatory PII fields from the WO-004 spec', () => {
    const mandatory = [
      'email',
      'password',
      'token',
      'authorization',
      'cookie',
      'creditCard',
      'ssn',
      'ip',
    ];

    for (const field of mandatory) {
      expect(DEFAULT_PII_PATHS).toContain(field);
    }
  });

  it('includes case variants for header-name paths', () => {
    expect(DEFAULT_PII_PATHS).toContain('headers.authorization');
    expect(DEFAULT_PII_PATHS).toContain('headers.Authorization');
    expect(DEFAULT_PII_PATHS).toContain('headers.cookie');
    expect(DEFAULT_PII_PATHS).toContain('headers.Cookie');
  });
});

describe('buildRedactConfig', () => {
  it('builds a Pino redact config with the given paths and [REDACTED] censor', () => {
    const config = buildRedactConfig(['password', 'token']);

    expect(config).toEqual({
      paths: ['password', 'token'],
      censor: '[REDACTED]',
    });
  });

  it('does not mutate the input paths array', () => {
    const input = ['password'];
    buildRedactConfig(input);

    expect(input).toEqual(['password']);
  });
});
