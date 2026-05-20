import { defineConfig } from "eslint/config";
import js from '@eslint/js';
import globals from 'globals';

const relaxedRules = {
  'no-console': 'off',
  'no-unused-vars': 'off',
  'no-cond-assign': 'off',
  'no-control-regex': 'off',
  'no-useless-escape': 'off',
  'no-redeclare': 'off',
  'no-empty': 'off',

  'default-case': 'error',
  'no-duplicate-case': 'error',
  'radix': 'error',
  'no-with': 'error',
};

export default defineConfig([
  {
    ignores: ['dist/**', 'test/perf/engines/**', 'test/browser/fixtures/**'],
  },

  js.configs.recommended,

  {
    files: ['src/**/*.js', 'test/**/*.js', 'examples/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.amd,
        NW: 'readonly',
      },
    },
    rules: relaxedRules,
  },

  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: relaxedRules,
  },

  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.amd,
        NW: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off',
      'no-cond-assign': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-redeclare': 'off',
      'no-empty': 'off',
      'no-undef': 'off',
      radix: 'off',
    },
  },

  {
    files: ['test/artifact/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: relaxedRules,
  },
]);
