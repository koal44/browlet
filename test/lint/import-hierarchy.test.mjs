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
    { filename: sourceFile('stylelet/props/registry'), code: "import { colorProperty } from './built-in/index';" },
    { filename: sourceFile('stylelet/props/built-in/color'), code: "import type { PropertyRecord } from '../property';" },
    { filename: sourceFile('stylelet/syntax/parser'), code: "import type { InterpretedDeclaration } from '../cssom/declarations/index';" },
    { filename: sourceFile('stylelet/cssom/rules/style'), code: "import { CSSStylePropertiesImpl } from '../declarations/index';" },
    { filename: sourceFile('stylelet/cssom/rules/import'), code: "import { MediaListImpl } from '../media/index';" },
    { filename: sourceFile('stylelet/cssom/typed/style-property-map'), code: "import { CSSDeclarationBlock } from '../declarations/index';" },
    { filename: sourceFile('stylelet/values/color'), code: "import { tokenize } from '../syntax/index';" },
    { filename: sourceFile('stylelet/values/length'), code: "import { lengthLiteral } from './numeric-literal/index';" },
    { filename: sourceFile('stylelet/values/color'), code: "import { MixPercentages } from './collections/index';" },
    { filename: sourceFile('stylelet/conditional/example'), code: "import { parseMediaQueryList } from '../values/index';" },
    { filename: sourceFile('stylelet/cssom/declarations/style-declaration'), code: "import type { StyleletContext } from '../../context';" },
    { filename: sourceFile('stylelet/cssom/rule-list'), code: "import { CSSStyleRuleImpl } from './rules/index';" },
    { filename: sourceFile('stylelet/cssom/rules/style'), code: "import type { CSSRuleListImpl } from '../rule-list';" },
    { filename: sourceFile('stylelet/cssom/rules/context'), code: "import type { CSSStyleRuleImpl } from './style';" },
    { filename: sourceFile('stylelet/engine/cascade'), code: "import { CSSStyleSheetImpl } from '../cssom/index';" },
    { filename: sourceFile('stylelet/environment'), code: "import type { StreamsEnvironment } from '../streams/index';" },
    { filename, code: "import { WindowImpl } from '../window/index';" },
    { filename, code: "import { Navigable } from './navigable';" },
    { filename, code: "import { parseURL } from '../../../url/index';" },
    { filename, code: "import { helper } from 'external-package';" },
    { filename, code: "import { helper } from '../../../../scripts/helper';" },
    { filename: sourceFile('browlet/dom/events/event'), code: "import { EventTargetImpl } from './event-target';" },
    { filename: sourceFile('browlet/dom/nodes/document'), code: "import { HTMLElementImpl } from './html/index';" },
    { filename: sourceFile('browlet/dom/nodes/html/scripting/script'), code: "import { HTMLElementImpl } from '../html-element';" },
    { filename: sourceFile('browlet/dom/nodes/element'), code: "import { ContentCategory } from './element-definitions/index';" },
    { filename: sourceFile('browlet/dom/nodes/element-definitions/content-model'), code: "import type { ElementImpl } from '../element';" },
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
      filename: sourceFile('stylelet/props/built-in/color'), code: "import { propertyRegistry } from '../registry';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/props/built-in', target: 'stylelet/props' } }],
    },
    {
      filename: sourceFile('stylelet/cssom/typed/style-property-map'), code: "import { CSSStyleRuleImpl } from '../rules/index';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/cssom/typed', target: 'stylelet/cssom/rules' } }],
    },
    {
      filename: sourceFile('stylelet/cssom/declarations/style-declaration'), code: "import { CSSStyleRuleImpl } from '../rules/index';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/cssom/declarations', target: 'stylelet/cssom/rules' } }],
    },
    {
      filename: sourceFile('stylelet/cssom/media/media-list'), code: "import { CSSImportRuleImpl } from '../rules/index';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/cssom/media', target: 'stylelet/cssom/rules' } }],
    },
    {
      filename: sourceFile('stylelet/props/property'), code: "import { CSSStyleDeclarationImpl } from '../cssom/declarations/index';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/props', target: 'stylelet/cssom/declarations' } }],
    },

    {
      filename: sourceFile('stylelet/syntax/parser'), code: "import { parseColor } from '../values/index';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/syntax', target: 'stylelet/values' } }],
    },
    {
      filename: sourceFile('stylelet/values/collections/mix'), code: "import { ColorValue } from '../color';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/values/collections', target: 'stylelet/values' } }],
    },
    {
      filename: sourceFile('stylelet/values/example'), code: "import { matchCondition } from '../conditional/index';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: sourceFile('stylelet/cssom/declarations/style-declaration'), code: "import { computeStyle } from '../../engine/index';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: sourceFile('stylelet/cssom/rules/style'), code: "import { CSSRuleListImpl } from '../rule-list';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/cssom/rules', target: 'stylelet/cssom' } }],
    },
    {
      filename: sourceFile('stylelet/cssom/rules/context'), code: "import { CSSStyleRuleImpl } from './style';",
      errors: [{ messageId: 'upward', data: { owner: 'stylelet/cssom/rules/context', target: 'stylelet/cssom/rules' } }],
    },
    {
      filename: sourceFile('streams/readable'), code: "import { Stylelet } from '../stylelet/index';",
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: sourceFile('browlet/dom/nodes/element-definitions/content-model'),
      code: "import { ElementImpl } from '../element';",
      errors: [{ messageId: 'upward', data: { owner: 'browlet/dom/nodes/element-definitions', target: 'browlet/dom/nodes' } }],
    },
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
