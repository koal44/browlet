import { fileURLToPath, URL } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import tseslint from 'typescript-eslint';
import rule from '../../scripts/eslint/no-ancestor-barrel-imports.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const filename = fileURLToPath(new URL('../../src/web-idl/converters/example.ts', import.meta.url));
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('no-ancestor-barrel-imports', rule, {
  valid: [
    { filename, code: "import { assemble } from '../assembly/index';" },
    { filename, code: "import type { IDLType } from '../assembly/index.js';" },
    { filename, code: "export { value } from './values/index';" },
    { filename, code: "import { Realm } from '../environment';" },
    { filename, code: "import { Converter } from './converter';" },
    {
      filename: fileURLToPath(new URL('../../src/web-idl/binding/realm/example.ts', import.meta.url)),
      code: "import type { RealmBinding } from '../realm';",
    },
    { filename, code: "import { packageValue } from 'some-package/index';" },
    { filename, code: "const module = import('../assembly/index');" },
    { filename, code: "type Type = import('../assembly/index').IDLType;" },
    { filename, code: "const module = require('../assembly/index');" },
    { filename, code: 'export const value = 1;' },
  ],
  invalid: [
    { filename, code: "import { value } from './index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from '../index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from '../../index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import '../index.js';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import type { Value } from '../index.ts';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { type Value } from '../index.mjs';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "export { value } from '../index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "export type { Value } from '../index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "export * from '../index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "const module = import('../index');", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "type Value = import('../index').Value;", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import value = require('../index');", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "const value = require('../index.cjs');", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from '.';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from '..';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from '../../';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from './nested/../index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from '../converters/index';", errors: [{ messageId: 'ancestorBarrel' }] },
    { filename, code: "import { value } from '../../web-idl/index';", errors: [{ messageId: 'ancestorBarrel' }] },
  ],
});
