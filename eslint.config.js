'use strict';

const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      // Ignoring the bound error in a catch clause is a common, intentional
      // pattern (e.g. `catch (err) { /* fall back */ }`).
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      // Matching ANSI escape codes (e.g. \x1b) intentionally requires control
      // characters in the regex.
      'no-control-regex': 'off',
    },
  },
  {
    ignores: ['node_modules/**'],
  },
];
