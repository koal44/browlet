import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import webIDLOperationLayout from './scripts/eslint/web-idl-operation-layout.mjs';
import subsystemImports from './scripts/eslint/subsystem-imports.mjs';

const runtimeGlobals = [
  { name: 'Promise', message: 'Use the supplied Promises dependency for implementation continuations.' },
  { name: 'queueMicrotask', message: 'Use the supplied Promise or task scheduling dependency.' },
];

const nativeErrorNames = [
  'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'SuppressedError',
];
const nativeErrorMessage = 'Use InternalError for implementation failures or an explicit exception import for author-visible errors.';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'packages/*/dist/**',
      'scratch/**',
      'node-compat/experimental/**',
      'node-compat/.cache/**',
      'node-compat/addon/build/**',
      'node-compat/results/**',
      'test/selectlet/scenarios/fixtures/**',
      'test/selectlet/perf/engines/**',
      'test/wpt/tests/**',
      'eslint.config.mjs',
    ],
  },

  eslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
      },
    },
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      '@stylistic': stylistic,
      browlet: {
        rules: {
          'web-idl-operation-layout': webIDLOperationLayout,
          'subsystem-imports': subsystemImports,
        },
      },
    },
    rules: {
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-unused-vars': 'off',
      'browlet/web-idl-operation-layout': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unnecessary-condition': ['warn', { allowConstantLoopConditions: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksConditionals: true,
          checksSpreads: true,
          checksVoidReturn: {
            arguments: false,
          },
        },
      ],
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // Allow interfaces for extending object contracts alongside type aliases.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],

      eqeqeq: 'warn',
      semi: ['warn', 'always'],
      quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'comma-dangle': ['warn', {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'only-multiline',
      }],
      'object-curly-spacing': ['warn', 'always'],
      'array-bracket-spacing': ['warn', 'never'],
      'block-spacing': ['warn', 'always'],
      'keyword-spacing': ['warn', { before: true, after: true }],
      'space-before-blocks': ['warn', 'always'],
      'no-unneeded-ternary': 'warn',
      'prefer-template': 'off',
      curly: ['warn', 'multi-line', 'consistent'],
      'func-call-spacing': ['warn', 'never'],

      '@stylistic/type-annotation-spacing': ['warn', {
        before: false,
        after: true,
        overrides: {
          arrow: 'ignore',
        },
      }],
      '@stylistic/arrow-spacing': ['warn', {
        before: true,
        after: true,
      }],
      '@stylistic/space-infix-ops': ['warn', { int32Hint: false }],
      '@stylistic/no-trailing-spaces': 'warn',
      '@stylistic/no-extra-semi': 'warn',
      '@stylistic/semi-style': ['warn', 'last'],
      '@stylistic/no-extra-parens': ['warn', 'all', {
        conditionalAssign: false,
        ternaryOperandBinaryExpressions: false,
        nestedBinaryExpressions: false,
        returnAssign: false,
        nestedConditionalExpressions: false,
        ignoredNodes: [
          'SpreadElement',
          'ArrowFunctionExpression[body.type="LogicalExpression"]',
          'ArrowFunctionExpression[body.type="TemplateLiteral"]',
        ],
      }],
      '@stylistic/operator-linebreak': ['warn', 'after', {
        overrides: {
          // Type unions/intersections and runtime bitwise expressions use
          // opposite line-break styles, which this rule cannot distinguish.
          '|': 'ignore',
          '&': 'ignore',
          '?': 'ignore',
          ':': 'ignore',
          '+': 'ignore',
          '-': 'ignore',
          '*': 'ignore',
          '/': 'ignore',
          '%': 'ignore',
          '**': 'ignore',
          '==': 'ignore',
          '!=': 'ignore',
          '===': 'ignore',
          '!==': 'ignore',
          '<': 'ignore',
          '<=': 'ignore',
          '>': 'ignore',
          '>=': 'ignore',
        },
      }],
      '@stylistic/indent-binary-ops': ['warn', 2],
      '@stylistic/indent': ['warn', 2, {
        SwitchCase: 1,
        flatTernaryExpressions: true,
        MemberExpression: 1,
        ignoredNodes: [
          'ConditionalExpression',
          'BinaryExpression',
          'LogicalExpression',
          'TSConditionalType',
          'TSIntersectionType',
          'TSUnionType',
        ],
      }],
      '@stylistic/comma-spacing': ['warn', { before: false, after: true }],
      '@stylistic/key-spacing': ['warn', { beforeColon: false, afterColon: true, mode: 'minimum' }],
      '@stylistic/object-curly-newline': ['warn', {
        ObjectExpression: { multiline: true, consistent: true },
        ObjectPattern: { multiline: true, consistent: true },
      }],
      '@stylistic/eol-last': ['warn', 'always'],
      '@stylistic/linebreak-style': ['warn', 'unix'],
      '@stylistic/space-before-function-paren': ['warn', {
        anonymous: 'never',
        named: 'never',
        asyncArrow: 'always',
      }],
      '@stylistic/quote-props': ['warn', 'as-needed'],
      '@stylistic/arrow-parens': ['warn', 'always'],
      '@stylistic/member-delimiter-style': ['warn', {
        multiline: {
          delimiter: 'semi',
          requireLast: true,
        },
        singleline: {
          delimiter: 'semi',
          requireLast: true,
        },
      }],
    },
  },

  {
    files: ['src/**/*.{ts,js,mjs,cjs}'],
    ignores: ['src/web-idl/**', 'src/stylelet/**', 'src/selectlet/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)web-idl/(?!index$)',
          message: 'Import from web-idl/index, the full Web IDL entry point.',
        }],
      }],
    },
  },

  {
    files: ['src/{stylelet,selectlet}/**/*.{ts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)web-idl/(?!(?:core/)?index$)',
          message: 'Use web-idl/core/index for declarations or web-idl/index for the full binding API.',
        }],
      }],
    },
  },

  {
    files: ['src/**/*.ts'],
    rules: {
      'browlet/subsystem-imports': ['error', {
        unrestrictedSubsystems: ['infra'],
        entryPoints: { 'web-idl': ['index', 'core/index'] },
      }],
    },
  },

  {
    files: ['src/**/*.{ts,js,mjs,cjs}'],
    ignores: ['src/**/scripts/**'],
    rules: {
      'no-restricted-globals': ['error', ...runtimeGlobals],
      'no-restricted-syntax': ['error',
        {
          selector: ':function[async=true], AwaitExpression',
          message: 'Native async/await schedules Node continuations; chain the supplied PromiseValue instead.',
        },
        {
          selector: 'MemberExpression[object.name="globalThis"][property.name=/^(Promise|queueMicrotask)$/]',
          message: 'Use the supplied Promise or task scheduling dependency.',
        },
      ],
    },
  },

  {
    files: ['src/**/*.{ts,js,mjs,cjs}'],
    ignores: ['src/selectlet/**', 'src/**/scripts/**'],
    rules: {
      'no-restricted-globals': ['error',
        ...runtimeGlobals,
        ...nativeErrorNames.map((name) => ({ name, message: nativeErrorMessage })),
      ],
      'no-restricted-properties': ['error',
        ...nativeErrorNames.map((property) => ({ object: 'globalThis', property, message: nativeErrorMessage })),
      ],
    },
  },

  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/scripts/**'],
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, checkThenables: true }],
    },
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['test/web-idl/contracts/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    // These compile-only examples deliberately contain invalid calls and unused assignments.
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  {
    files: ['scripts/**/*.{js,mjs}', 'src/**/scripts/**/*.{js,mjs}', 'node-compat/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['test/artifact/**/*.cjs', 'node-compat/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['test/artifact/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

);
