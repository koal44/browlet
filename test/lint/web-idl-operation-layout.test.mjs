import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import rule from '../../scripts/eslint/web-idl-operation-layout.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const declarationImport = "import { op } from '../../src/web-idl/core/index';\n";
const preferred = `op('item', nullable(reference('File')),
  [arg('index', idlType.unsignedLong)],
  indexedGetter(
    function* (list: FileListImpl) {
      for (let index = 0; index < list.length; index++) yield index;
    },
    { unsupportedValue: null },
  ),
);`;
const flattened = `op('item', nullable(reference('File')), [
  arg('index', idlType.unsignedLong),
], indexedGetter(
  function* (list: FileListImpl) {
    for (let index = 0; index < list.length; index++) yield index;
  },
  { unsupportedValue: null },
));`;
const constructorImport = "import { ctor } from '../../src/web-idl/index';\n";
const flattenedConstructor = `ctor([
  arg('input', reference('RequestInfo')),
], {
  construct(ctx, input) {
    return createRequest(ctx, input);
  },
});`;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});
tester.run('web-idl-operation-layout', rule, {
  valid: [
    { name: 'FileList layout', code: declarationImport + preferred },
    {
      name: 'attribute name and type stay with the helper',
      code: "import { roAttr } from '../../src/web-idl/index';\n" +
        "roAttr('window', reference('WindowProxy'),\n  xattr('LegacyUnforgeable'),\n);",
    },
    {
      name: 'multiline type starts beneath the name',
      code: "import { attr } from '../../src/web-idl/index';\n" +
        "attr('value',\n  union(\n    idlType.DOMString,\n    idlType.long,\n  ),\n);",
    },
    {
      name: 'multiline type and options are sibling arguments',
      plugins: { '@stylistic': stylistic },
      rules: { '@stylistic/indent': ['error', 2] },
      code: "import { arg } from '../../src/web-idl/index';\n" + `arg('init',
  union(
    sequence(sequence(idlType.USVString)),
    record(idlType.USVString, idlType.USVString),
    idlType.USVString,
  ),
  { default: '', optional: true },
);`,
    },
    {
      name: 'static operation layout',
      code: declarationImport.replace('{ op }', '{ staticOp }') + preferred.replace('op(', 'staticOp('),
    },
    {
      name: 'compact declaration',
      code: declarationImport + "op('item', type, [arg('index', type)], indexedGetter(indices));",
    },
    {
      name: 'compact nested calls stay in the header',
      code: "import { roAttr } from '../../src/web-idl/index';\n" +
        "roAttr('value', nullable(sequence(reference('Item'))));",
    },
    {
      name: 'compact groups below the header',
      code: declarationImport + "op('item', type,\n  [arg('index', type)], xattr('CEReactions'),\n);",
    },
    {
      name: 'declaration with no binding',
      code: declarationImport + "op('item', type, [\n  arg('index', type),\n]);",
    },
    {
      name: 'multiline array and object binding',
      code: declarationImport + `op('item', type,
  [
    arg('index', type),
  ],
  {
    invoke: item,
  },
);`,
    },
    {
      name: 'comments between arguments',
      code: declarationImport + `op('item', type,
  [arg('index', type)], // Index conversion.
  /* Item lookup. */ indexedGetter(
    indices,
  ),
);`,
    },
    {
      name: 'constructor layout',
      code: constructorImport + `ctor(
  [arg('input', reference('RequestInfo'))],
  {
    construct(ctx, input) {
      return createRequest(ctx, input);
    },
  },
);`,
    },
    {
      name: 'compact constructor',
      code: constructorImport + "ctor([arg('input', type)], { construct: createRequest });",
    },
    {
      name: 'constructor with no binding',
      code: constructorImport + "ctor([\n  arg('input', type),\n]);",
    },
    { name: 'unrelated op import', code: "import { op } from 'other';\n" + flattened },
    {
      name: 'shadowed op parameter',
      code: declarationImport + 'function example(op: Function) {\n' + flattened + '\n}',
    },
    {
      name: 'unrelated constructor import',
      code: "import { ctor } from 'other';\n" + flattenedConstructor,
    },
    {
      name: 'shadowed constructor parameter',
      code: constructorImport + 'function example(ctor: Function) {\n' + flattenedConstructor + '\n}',
    },
  ],
  invalid: [
    {
      name: 'multiline argument type cannot start inside the header',
      plugins: { '@stylistic': stylistic },
      rules: { '@stylistic/indent': ['error', 2] },
      code: "import { arg, ctor } from '../../src/web-idl/index';\n" + `const definition = {
  members: [
    ctor([
      arg('init', union(
        sequence(sequence(idlType.USVString)),
        record(idlType.USVString, idlType.USVString),
        idlType.USVString,
      ),
      { default: '', optional: true },
      ),
    ]),
  ],
};`,
      errors: [{ messageId: 'multilineType' }],
    },
    {
      name: 'multiline wrapped type cannot start inside an aliased header',
      code: "import { roAttr as attribute } from '../../src/web-idl/index';\n" +
        "attribute('value', nullable(union(\n  idlType.DOMString,\n  idlType.long,\n)));",
      errors: [{ messageId: 'multilineType' }],
    },
    {
      name: 'split attribute header',
      code: "import { roAttr } from '../../src/web-idl/index';\n" +
        "roAttr(\n  'window',\n  reference('WindowProxy'),\n  xattr('LegacyUnforgeable'),\n);",
      output: "import { roAttr } from '../../src/web-idl/index';\n" +
        "roAttr('window', reference('WindowProxy'),\n  xattr('LegacyUnforgeable'),\n);",
      errors: [{ messageId: 'header' }, { messageId: 'header' }],
    },
    {
      name: 'aliased writable attribute with options',
      code: "import { attr as attribute } from '../../src/web-idl/core/index.js';\n" +
        "attribute(\n  'value', type, { get: readValue });",
      output: "import { attr as attribute } from '../../src/web-idl/core/index.js';\n" +
        "attribute('value', type, { get: readValue });",
      errors: [{ messageId: 'header' }],
    },
    {
      name: 'split operation without a binding',
      code: declarationImport + "op(\n  'item',\n  type, [arg('index', type)],\n);",
      output: declarationImport + "op('item', type, [arg('index', type)],\n);",
      errors: [{ messageId: 'header' }, { messageId: 'header' }],
    },
    ...['staticOp', 'arg', 'dictMember', 'constant'].map((helper) => ({
      name: `${helper} header`,
      code: `import { ${helper} } from '../../src/web-idl/index';\n${helper}(\n  'value',\n  type,\n);`,
      output: `import { ${helper} } from '../../src/web-idl/index';\n${helper}('value', type,\n);`,
      errors: [{ messageId: 'header' }, { messageId: 'header' }],
    })),
    {
      name: 'header comments need manual placement',
      code: declarationImport + "op('item', // Keep this explanation.\n  type);",
      output: null,
      errors: [{ messageId: 'header' }],
    },
    {
      name: 'full Web IDL entry',
      code: "import { op } from '../../src/web-idl/index';\n" + flattened,
      errors: [{ messageId: 'argument' }, { messageId: 'argument' }, { messageId: 'closing' }],
    },
    {
      name: 'flattened FileList layout',
      code: declarationImport + flattened,
      errors: [
        { messageId: 'argument', line: 2 },
        { messageId: 'argument', line: 4 },
        { messageId: 'closing', line: 9 },
      ],
    },
    {
      name: 'aliased op import',
      code: "import { op as operation } from '../../src/web-idl/core/index.js';\n" +
        flattened.replace('op(', 'operation('),
      errors: [{ messageId: 'argument' }, { messageId: 'argument' }, { messageId: 'closing' }],
    },
    {
      name: 'aliased staticOp import',
      code: "import { staticOp as operation } from '../../src/web-idl/core/index.js';\n" +
        flattened.replace('op(', 'operation('),
      errors: [{ messageId: 'argument' }, { messageId: 'argument' }, { messageId: 'closing' }],
    },
    {
      name: 'import below its use',
      code: flattened + '\n' + declarationImport,
      errors: [{ messageId: 'argument' }, { messageId: 'argument' }, { messageId: 'closing' }],
    },
    {
      name: 'inline empty array before multiline binding',
      code: declarationImport + `op('text', type, [], {
  invoke: text,
});`,
      errors: [{ messageId: 'argument' }, { messageId: 'argument' }, { messageId: 'closing' }],
    },
    {
      name: 'flattened constructor layout',
      code: constructorImport + flattenedConstructor,
      errors: [
        { messageId: 'argument', line: 2 },
        { messageId: 'argument', line: 4 },
        { messageId: 'closing', line: 8 },
      ],
    },
    {
      name: 'aliased constructor import',
      code: "import { ctor as constructor } from '../../src/web-idl/core/index.js';\n" +
        flattenedConstructor.replace('ctor(', 'constructor('),
      errors: [{ messageId: 'argument' }, { messageId: 'argument' }, { messageId: 'closing' }],
    },
    {
      name: 'inline empty array before multiline constructor binding',
      code: constructorImport + `ctor([], {
  construct: createRequest,
});`,
      errors: [{ messageId: 'argument' }, { messageId: 'argument' }, { messageId: 'closing' }],
    },
  ],
});
