import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'scratch/**',
      'test/browser/fixtures/**',
      'test/perf/engines/**',
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
    },
    rules: {
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-unused-vars': 'off',

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
      '@typescript-eslint/consistent-type-definitions': ['warn', 'type'],
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
      '@stylistic/indent': ['warn', 2, {
        SwitchCase: 1,
        flatTernaryExpressions: true,
        MemberExpression: 1,
        ignoredNodes: [],
      }],
      '@stylistic/comma-spacing': ['warn', { before: false, after: true }],
      '@stylistic/key-spacing': ['warn', { beforeColon: false, afterColon: true, mode: 'minimum' }],
      '@stylistic/object-curly-newline': ['warn', {
        ObjectExpression: { multiline: true, consistent: true },
        ObjectPattern: { multiline: true, consistent: true },
        ExportDeclaration: { multiline: true, minProperties: 6 },
        ImportDeclaration: { multiline: true, minProperties: 6 },
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
    files: ['test/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
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
    rules: {
      'no-console': 'off',
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
