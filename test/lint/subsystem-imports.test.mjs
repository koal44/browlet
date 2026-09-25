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
  entryPoints: { 'web-idl': ['index', 'core/index'] },
}];
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('subsystem-imports', rule, {
  valid: [
    { filename, options, code: "import { FetchGroup } from '../fetch/index';" },
    { filename, options, code: "import type { ReferrerPolicy } from '../fetch/index.js';" },
    { filename, options, code: "export { defineInterface } from '../web-idl/core/index';" },
    { filename, options, code: "import { parseURL } from '../url/index';" },
    { filename, options, code: "import { Promises } from '../infra/promises';" },
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
    { filename, code: "import { parseURL } from '../url/url';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "import { parseURL } from '../url/url';", errors: [{ messageId: 'entryPoint' }] },
    { filename, options, code: "import { FetchRequest } from '../fetch/request';", errors: [{ messageId: 'entryPoint' }] },
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
