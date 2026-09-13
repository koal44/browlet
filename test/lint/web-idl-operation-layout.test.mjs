import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import tseslint from 'typescript-eslint';
import rule from '../../scripts/eslint/web-idl-operation-layout.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const declarationImport = "import { op } from '../../src/web-idl/declaration/index';\n";
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

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});
tester.run('web-idl-operation-layout', rule, {
  valid: [
    { name: 'FileList layout', code: declarationImport + preferred },
    {
      name: 'compact declaration',
      code: declarationImport + "op('item', type, [arg('index', type)], indexedGetter(indices));",
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
    { name: 'unrelated op import', code: "import { op } from 'other';\n" + flattened },
    {
      name: 'shadowed op parameter',
      code: declarationImport + 'function example(op: Function) {\n' + flattened + '\n}',
    },
  ],
  invalid: [
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
      code: "import { op as operation } from '../../src/web-idl/declaration/index.js';\n" +
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
  ],
});
