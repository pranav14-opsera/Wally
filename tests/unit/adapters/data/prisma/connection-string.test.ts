import { describe, expect, it } from 'vitest';

import { buildDatabaseUrl, buildPgPoolConfig } from '../../../../../src/adapters/data/prisma/connection-string.js';

const PARAMS = {
  host: 'localhost',
  port: 5432,
  user: 'wally',
  password: 'change-me',
  database: 'wally',
};

describe('buildDatabaseUrl', () => {
  it('builds a postgresql:// URL with the architecture-mandated pool params', () => {
    expect(buildDatabaseUrl(PARAMS)).toBe(
      'postgresql://wally:change-me@localhost:5432/wally?connection_limit=10&pool_timeout=30',
    );
  });

  it('accepts a string port', () => {
    expect(buildDatabaseUrl({ ...PARAMS, port: '5432' })).toContain('@localhost:5432/');
  });

  it('URL-encodes user, password, and database so special characters cannot corrupt the URL', () => {
    const url = buildDatabaseUrl({
      ...PARAMS,
      user: 'wally user',
      password: 'p@ss/w:ord?#',
      database: 'wally db',
    });

    expect(url).toBe(
      'postgresql://wally%20user:p%40ss%2Fw%3Aord%3F%23@localhost:5432/wally%20db' +
        '?connection_limit=10&pool_timeout=30',
    );
  });
});

describe('buildPgPoolConfig', () => {
  it('maps discrete params onto a pg.PoolConfig with the architecture-mandated pool size and idle timeout', () => {
    expect(buildPgPoolConfig(PARAMS)).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'wally',
      password: 'change-me',
      database: 'wally',
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  });

  it('coerces a string port to a number', () => {
    const config = buildPgPoolConfig({ ...PARAMS, port: '5432' });
    expect(config.port).toBe(5432);
    expect(typeof config.port).toBe('number');
  });

  it('does not URL-encode values — pg.Pool takes raw field values, not a URL', () => {
    const config = buildPgPoolConfig({ ...PARAMS, password: 'p@ss/w:ord' });
    expect(config.password).toBe('p@ss/w:ord');
  });
});
