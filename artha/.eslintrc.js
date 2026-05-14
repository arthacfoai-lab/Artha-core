'use strict';

module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
  rules: {
    // ── Errors ──────────────────────────────────────────────────
    'no-console': 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-duplicate-case': 'error',

    // ── Best practices ───────────────────────────────────────────
    'no-var': 'error',
    'prefer-const': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': 'error',
    'no-throw-literal': 'error',
    'no-return-await': 'error',
    'no-await-in-loop': 'warn',
    'no-promise-executor-return': 'error',

    // ── Style ─────────────────────────────────────────────────────
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'comma-dangle': ['error', 'always-multiline'],
    'object-curly-spacing': ['error', 'always'],
    'array-bracket-spacing': ['error', 'never'],
    'space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
    'keyword-spacing': ['error', { before: true, after: true }],
    'space-infix-ops': 'error',
    'eol-last': ['error', 'always'],
    'no-trailing-spaces': 'error',
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],

    // ── Fintech safety ────────────────────────────────────────────
    // These prevent float arithmetic on money values
    'no-loss-of-precision': 'error',
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
  ],
};