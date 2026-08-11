import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

import noHardcodedConfig from './eslint-rules/no-hardcoded-config.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    // src/generated/** is Prisma-generated output (regenerated via
    // `prisma generate`, gitignored) — not hand-written code, not linted.
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'src/generated/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Zero-hardcoding guardrail — scoped to agent code only. Adapters,
    // config, and bootstrap legitimately reference provider names/numeric
    // constants, so applying this rule there would be a false positive,
    // not an enforcement win (see WO-006 constraints).
    files: ['src/agents/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      wally: {
        rules: {
          'no-hardcoded-config': noHardcodedConfig,
        },
      },
    },
    rules: {
      'wally/no-hardcoded-config': 'error',
    },
  },
];
