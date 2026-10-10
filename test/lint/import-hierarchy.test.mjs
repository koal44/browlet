import { fileURLToPath, URL } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import tseslint from 'typescript-eslint';
import direction from '../../scripts/eslint/dependency-direction.mjs';
import order from '../../scripts/eslint/import-order.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const sourceFile = (path) => fileURLToPath(new URL(`../../src/${path}.ts`, import.meta.url));
const filename = sourceFile('browlet/browsing/navigation/example');

tester.run('dependency-direction', direction, {
  valid: [
    { filename, code: "import { WindowImpl } from '../window/index';" },
    { filename, code: "import { Navigable } from './navigable';" },
    { filename, code: "import { parseURL } from '../../../url/index';" },
    { filename, code: "import { helper } from 'external-package';" },
    { filename, code: "import { helper } from '../../../../scripts/helper';" },
    { filename: sourceFile('browlet/dom/events/event'), code: "import { EventTargetImpl } from './event-target';" },
    { filename: sourceFile('browlet/dom/nodes/document'), code: "import { HTMLElementImpl } from './html/index';" },
    { filename: sourceFile('web-idl/assembly/assembly'), code: "import type { WebIDLRealm } from '../environment';" },
    { filename, code: "import type { Window } from '../../platform.d.ts';" },
    { filename: sourceFile('browlet/user-agent'), code: "import { createWindowEnvironment } from './bindings';" },
    { filename: fileURLToPath(new URL('../browlet/example.ts', import.meta.url)), code: "import { Browlet } from '../../src/browlet/index';" },
    { filename, code: "import type { UserAgent } from '../../user-agent';" },
    { filename, code: "import { type UserAgent } from '../../user-agent';" },
    { filename, code: "import type * as Binding from '../../bindings';" },
    { filename, code: "export type { UserAgent } from '../../user-agent';" },
    { filename, code: "export { type UserAgent } from '../../user-agent';" },
    { filename, code: "export type * from '../../bindings';" },
    { filename, code: "type Owner = import('../../user-agent').UserAgent;" },
    { filename, code: "import type Binding = require('../../bindings');" },
    { filename: sourceFile('http/example'), code: "import type { Store } from '../storage/index';" },
    { filename, code: "import type { Helper } from '../../../new-subsystem/index';" },
  ],
  invalid: [
    {
      filename: sourceFile('browlet/browsing/window/window'),
      code: "import { Navigable } from '../navigation/index';",
      errors: [{ messageId: 'upward', data: { owner: 'browlet/browsing/window', target: 'browlet/browsing/navigation' } }],
    },
    {
      filename, code: "import { createWindowEnvironment } from '../../bindings';",
      errors: [{ messageId: 'upward', data: { owner: 'browlet/browsing/navigation', target: 'browlet/bindings' } }],
    },
    {
      filename, code: "import { createWindowEnvironment, type Config } from '../window/../../bindings.js';",
      errors: [{ messageId: 'upward', data: { owner: 'browlet/browsing/navigation', target: 'browlet/bindings' } }],
    },
    { filename, code: "import '../../bindings';", errors: [{ messageId: 'upward' }] },
    { filename, code: "import {} from '../../bindings';", errors: [{ messageId: 'upward' }] },
    { filename, code: "export * from '../../bindings';", errors: [{ messageId: 'upward' }] },
    {
      filename, code: "export { createWindowEnvironment, type Config } from '../../bindings';",
      errors: [{ messageId: 'upward' }],
    },
    { filename, code: "const load = import('../../bindings');", errors: [{ messageId: 'upward' }] },
    { filename, code: "const load = require('../../bindings');", errors: [{ messageId: 'upward' }] },
    { filename, code: "import Binding = require('../../bindings');", errors: [{ messageId: 'upward' }] },
    {
      filename: sourceFile('http/example'), code: "import { Store } from '../storage/index';",
      errors: [{ messageId: 'peer', data: { owner: 'http', target: 'storage' } }],
    },
    {
      filename: sourceFile('infra/example'), code: "import { createView } from '../js-engine/buffer-view';",
      errors: [{ messageId: 'upward' }],
    },
    { filename, code: "import { helper } from '../../../new-subsystem/index';", errors: [{ messageId: 'unmapped' }] },
    { filename: sourceFile('new-subsystem/example'), code: 'export {};', errors: [{ messageId: 'unmapped' }] },
  ],
});

tester.run('import-order', order, {
  valid: [
    { filename, code: "import { InternalError } from '../../../infra/internal-error';\nimport { JSRealm } from '../../../js-engine/index';\nimport { idlType } from '../../../web-idl/core/index';\n\nimport { WindowImpl } from '../window/index';\n\nimport { Navigable } from './navigable';" },
    { filename, code: "import { Navigable } from './navigable';\nimport './side-effect';\nimport { InternalError } from '../../../infra/index';" },
    { filename, code: "import { Navigable } from './navigable';\ninitialize();\nimport { InternalError } from '../../../infra/index';" },
    { filename, code: "import { InternalError } from '../../../infra/index'; // Keep this explanation.\n\nimport { Navigable } from './navigable';" },
    { filename, code: "import { Navigable } from './navigable';\nimport { Params } from './params';" },
  ],
  invalid: [
    {
      filename, code: "import { Navigable } from './navigable'; // Keep this explanation.\nimport { InternalError } from '../../../infra/index';",
      output: null, errors: [{ messageId: 'commented' }],
    },
    {
      filename, code: "// This explains Navigable.\nimport { Navigable } from './navigable';\nimport { InternalError } from '../../../infra/index';",
      output: null, errors: [{ messageId: 'commented' }],
    },
    {
      filename, code: "import { Navigable } from './navigable';\n// This explains the following dependency.\nimport { InternalError } from '../../../infra/index';",
      output: null, errors: [{ messageId: 'commented' }],
    },
    {
      filename, code: "import { Navigable } from './navigable';\nimport { InternalError } from '../../../infra/index'; // Error handling.",
      output: null, errors: [{ messageId: 'commented' }],
    },
    {
      filename,
      code: "import { Navigable } from './navigable';\nimport { idlType } from '../../../web-idl/core/index';\nimport { JSRealm } from '../../../js-engine/index';\nimport { InternalError } from '../../../infra/index';\nimport { WindowImpl } from '../window/index';",
      output: "import { InternalError } from '../../../infra/index';\nimport { JSRealm } from '../../../js-engine/index';\nimport { idlType } from '../../../web-idl/core/index';\n\nimport { WindowImpl } from '../window/index';\n\nimport { Navigable } from './navigable';",
      errors: [{ messageId: 'order' }],
    },
    {
      filename,
      code: "import { JSRealm } from '../../../js-engine/index';\nimport type { Moment } from '../../timing/index';\nimport { InternalError } from '../../../infra/index';\nimport type { JSValue } from '../../../js-engine/index';",
      output: "import { InternalError } from '../../../infra/index';\nimport { JSRealm } from '../../../js-engine/index';\nimport type { JSValue } from '../../../js-engine/index';\n\nimport type { Moment } from '../../timing/index';",
      errors: [{ messageId: 'order' }],
    },
    {
      filename,
      code: "import { JSRealm } from '../../../js-engine/index';\nimport { EOL } from 'node:os';\nimport { InternalError } from '../../../infra/index';",
      output: "import { EOL } from 'node:os';\n\nimport { InternalError } from '../../../infra/index';\nimport { JSRealm } from '../../../js-engine/index';",
      errors: [{ messageId: 'order' }],
    },
    {
      filename,
      code: "import { InternalError } from '../../../infra/index';\n\nimport { JSRealm } from '../../../js-engine/index';\nimport { WindowImpl } from '../window/index';\n\n\nimport { Navigable } from './navigable';",
      output: "import { InternalError } from '../../../infra/index';\nimport { JSRealm } from '../../../js-engine/index';\n\nimport { WindowImpl } from '../window/index';\n\nimport { Navigable } from './navigable';",
      errors: [{ messageId: 'spacing' }],
    },
    {
      filename,
      code: "import {\n  InternalError,\n} from '../../../infra/index';\n\nimport type { JSValue } from '../../../js-engine/index';",
      output: "import {\n  InternalError,\n} from '../../../infra/index';\nimport type { JSValue } from '../../../js-engine/index';",
      errors: [{ messageId: 'spacing' }],
    },
    {
      filename,
      code: "import { JSRealm } from '../../../js-engine/index';\r\nimport { InternalError } from '../../../infra/index';",
      output: "import { InternalError } from '../../../infra/index';\r\nimport { JSRealm } from '../../../js-engine/index';",
      errors: [{ messageId: 'order' }],
    },
    {
      filename: sourceFile('web-idl/converters/async-sequence'),
      code: "import { Converter } from './converter';\nimport { IDLAsyncSequence } from '../values/index';\nimport { InternalError } from '../../infra/index';\nimport { getMethod } from '../../js-engine/index';\nimport type { IDLType } from '../assembly/index';\nimport { idlType } from '../core/index';",
      output: "import { InternalError } from '../../infra/index';\nimport { getMethod } from '../../js-engine/index';\nimport { idlType } from '../core/index';\n\nimport type { IDLType } from '../assembly/index';\nimport { IDLAsyncSequence } from '../values/index';\n\nimport { Converter } from './converter';",
      errors: [{ messageId: 'order' }],
    },
  ],
});
