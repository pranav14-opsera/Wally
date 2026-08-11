import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';

import rule from '../../../eslint-rules/no-hardcoded-config.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('wally/no-hardcoded-config', () => {
  it('accepts valid patterns and flags invalid patterns', () => {
    ruleTester.run('no-hardcoded-config', rule, {
      valid: [
        // 1. reading from config object
        'const x = config.timeout;',
        // 2. registry lookup call
        'const tool = registry.get(name);',
        // 3. array index 0
        'const first = arr[0];',
        // 4. HTTP status 200
        'res.status(200);',
        // 5. type annotation containing a banned string (type-level, not runtime)
        "type Provider = 'aws' | 'gcp';",
        // 6. enum with numeric initializer
        'enum Status { Active = 1 }',
        // 7. import from an adapter interface path (not a banned SDK)
        "import type { ICloudStorageService } from '../../adapters/cloud/index.js';",
        // 8. template literal with no banned string
        'const key = `${entityName}:${id}`;',
        // 9. destructured config value
        'const { timeout } = config;',
        // 10. constant resolved from the registry
        "const value = registry.resolve('key');",
        // 11. allowedNumbers option extends the default allow-list
        {
          code: 'const port = 8080;',
          options: [{ allowedNumbers: [8080] }],
        },
        // 12. allowedStrings option exempts an otherwise-banned string
        {
          code: "const engine = 'dynamodb';",
          options: [{ allowedStrings: ['dynamodb'] }],
        },
      ],
      invalid: [
        // 1. bare number 3600 in a setTimeout
        {
          code: 'setTimeout(fn, 3600);',
          errors: [{ messageId: 'hardcodedNumber' }],
        },
        // 2. string 'aws' in an if condition
        {
          code: "if (provider === 'aws') {}",
          errors: [{ messageId: 'hardcodedString' }],
        },
        // 3. import from '@aws-sdk/client-s3'
        {
          code: "import { S3Client } from '@aws-sdk/client-s3';",
          errors: [{ messageId: 'hardcodedImport' }],
        },
        // 4. string 'postgres' in a switch case
        {
          code: "switch (x) { case 'postgres': break; }",
          errors: [{ messageId: 'hardcodedString' }],
        },
        // 5. bare number 100 as a VU cap
        {
          code: 'const vuCap = 100;',
          errors: [{ messageId: 'hardcodedNumber' }],
        },
        // 6. template literal containing 'mongo'
        {
          code: 'const key = `mongo:${id}`;',
          errors: [{ messageId: 'hardcodedTemplateLiteral' }],
        },
        // 7. import from 'mongoose'
        {
          code: "import mongoose from 'mongoose';",
          errors: [{ messageId: 'hardcodedImport' }],
        },
        // 8. string 'redis' as a cache key prefix
        {
          code: "const prefix = 'redis';",
          errors: [{ messageId: 'hardcodedString' }],
        },
        // 9. bare number 5000 as a timeout
        {
          code: 'const timeout = 5000;',
          errors: [{ messageId: 'hardcodedNumber' }],
        },
        // 10. string 's3' as a bucket reference
        {
          code: "const bucket = 's3';",
          errors: [{ messageId: 'hardcodedString' }],
        },
        // 11. double-quoted string is detected identically to single-quoted
        {
          code: 'const prefix = "redis";',
          errors: [{ messageId: 'hardcodedString' }],
        },
        // 12. import from '@prisma/client'
        {
          code: "import { PrismaClient } from '@prisma/client';",
          errors: [{ messageId: 'hardcodedImport' }],
        },
      ],
    });
  });
});
