import { fileURLToPath, URL } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import tseslint from 'typescript-eslint';
import rule from '../../scripts/eslint/subsystem-imports.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const filename = fileURLToPath(new URL('../../src/browlet/example.ts', import.meta.url));
const options = [{
  unrestrictedSubsystems: ['infra'],
  entryPoints: {
    'web-idl': ['index', 'core/index'], encoding: ['index', 'core/index'],
    stylelet: ['index', 'environment', 'context'],
    'stylelet/syntax': ['index'], 'stylelet/values': ['index'],
    'stylelet/values/numeric-literal': ['index'],
    'stylelet/cssom': ['index', 'declarations/index', 'media/index', 'typed/index', 'rules/index'],
  },
}];
const styleletFile = (path) => fileURLToPath(new URL(`../../src/stylelet/${path}.ts`, import.meta.url));
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('subsystem-imports', rule, {
  valid: [
    { filename: styleletFile('engine/computed-style'), options, code: "import { CSSStyleDeclarationImpl } from '../cssom/declarations/index';" },
    { filename: styleletFile('index'), options, code: "export { MediaListImpl } from './cssom/media/index';" },
    { filename: styleletFile('index'), options, code: "export { StylePropertyMapImpl } from './cssom/typed/index';" },
    { filename: styleletFile('values/color'), options, code: "import { tokenize } from '../syntax/index';" },
    { filename: styleletFile('values/color'), options, code: "import { parseNumber } from './number';" },
    { filename: styleletFile('values/length'), options, code: "import { lengthLiteral } from './numeric-literal/index';" },
    { filename: styleletFile('values/color'), options, code: "import type { StyleletEnvironment } from '../environment';" },
    { filename, options, code: "import { tokenize } from '../stylelet/syntax/index';" },
    { filename, options, code: "import { FetchGroup } from '../fetch/index';" },
    { filename, options, code: "import type { ReferrerPolicy } from '../fetch/index.js';" },
    { filename, options, code: "export { defineInterface } from '../web-idl/core/index';" },
    { filename, options, code: "import { getEncoding } from '../encoding/core/index';" },
    { filename, options, code: "import { parseURL } from '../url/index';" },
    { filename, options, code: "import { InternalPromise } from '../infra/promises';" },
    { filename, options, code: "import type { InternalPromise } from '../infra/promises';" },
    { filename, options, code: "export { TypeError } from '../infra/exceptions';" },
    { filename, options, code: "import { fetch } from 'another-package/fetch/private';" },
    { filename, options, code: "import { configure } from '../../scripts/configure';" },
    {
      filename: fileURLToPath(new URL('../../src/fetch/example.ts', import.meta.url)),
      options, code: "import { isOffline } from './environment';",
    },
    {
      filename: fileURLToPath(new URL('../fetch/example.ts', import.meta.url)),
      options, code: "import { FetchRequest } from '../../src/fetch/request';",
    },
  ],
  invalid: [
    {
      filename: styleletFile('engine/computed-style'), options,
      code: "import { CSSStyleDeclarationImpl } from '../cssom/declarations/declaration';",
      errors: [{ messageId: 'entryPoint' }],
    },

    {
      filename: styleletFile('values/color'), options, code: "import { tokenize } from '../syntax/tokens';",
      errors: [{ messageId: 'entryPoint' }],
    },
    {
      filename: styleletFile('values/color'), options, code: "import type { TokenCursor } from '../syntax/token-cursor';",
      errors: [{ messageId: 'entryPoint' }],
    },
    {
      filename: styleletFile('values/length'), options, code: "import { lengthLiteral } from './numeric-literal/length';",
      errors: [{ messageId: 'entryPoint' }],
    },
    {
      filename: styleletFile('cssom/declarations/declaration'), options, code: "type Color = import('../../values/color').AbsoluteColor;",
      errors: [{ messageId: 'entryPoint' }],
    },
    {
      filename: styleletFile('index'), options, code: "export { tokenize } from './syntax/tokens';",
      errors: [{ messageId: 'entryPoint' }],
    },
    {
      filename, options, code: "import { tokenize } from '../stylelet/syntax/tokens';",
      errors: [{ messageId: 'entryPoint' }],
    },
    { filename, code: "import { parseURL } from '../url/url';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "import { parseURL } from '../url/url';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "import { FetchRequest } from '../fetch/request';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "import { decodeNative } from '../encoding/core/decoding';", errors: [{ messageId: 'entryPoint' }] },
    {
      filename, options, code: "import type { FetchPolicyContainer } from '../fetch/environment';",
      errors: [{ messageId: 'entryPoint' }],
    },
    { filename, options, code: "export { FetchRequest } from '../fetch/request';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "export * from '../fetch/request';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "const module = import('../fetch/request');", errors: [{ messageId: 'entryPoint' }] },
    {
      filename, options, code: "type Request = import('../fetch/request').FetchRequest;",
      errors: [{ messageId: 'entryPoint' }],
    },
    { filename, options, code: "import { FetchRequest } from '../fetch/private/index';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "import { FetchRequest } from '../fetch/../fetch/request';", errors: [{ messageId: 'entryPoint' }] },
    {
      filename: fileURLToPath(new URL('../../src/browlet/browsing/policy/example.ts', import.meta.url)),
      options, code: "import type { FetchPolicyContainer } from '../../../fetch/environment';",
      errors: [{ messageId: 'entryPoint' }],
    },
  ],
});
