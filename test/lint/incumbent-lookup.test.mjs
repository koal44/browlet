import { fileURLToPath, URL } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import tseslint from 'typescript-eslint';
import rule from '../../scripts/eslint/incumbent-lookup.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const filename = fileURLToPath(new URL('../../src/browlet/example.ts', import.meta.url));
const allowed = fileURLToPath(new URL('../../src/browlet/bindings.ts', import.meta.url));
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('incumbent-lookup', rule, {
  valid: [
    { filename, code: 'loop.prepareToRunCallback(env);' },
    { filename, code: 'class EventLoop { getIncumbentEnvironment() {} }' },
    { filename: allowed, options: [[allowed]], code: 'loop.getIncumbentEnvironment();' },
    { filename: allowed, options: [['src/browlet/bindings.ts']], code: 'loop.getIncumbentEnvironment();' },
    { filename, code: 'const { env } = inputs;' },
  ],
  invalid: [
    'loop.getIncumbentEnvironment();',
    'loop?.getIncumbentEnvironment();',
    "loop['getIncumbentEnvironment']();",
    'const read = loop.getIncumbentEnvironment;',
    'const read = loop.getIncumbentEnvironment.bind(loop);',
    'const { getIncumbentEnvironment: read } = loop;',
    "const { ['getIncumbentEnvironment']: read } = loop;",
    'const { getIncumbentEnvironment } = loop;',
  ].map((code) => ({ filename, options: [[allowed]], code, errors: [{ messageId: 'restricted' }] })),
});
