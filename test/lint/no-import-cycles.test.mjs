import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import tseslint from 'typescript-eslint';
import ts from 'typescript';
import rule, { findImportCycles } from '../../scripts/eslint/no-import-cycles.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = resolve(root, 'src');
const fixtureRoot = resolve(sourceRoot, '__cycle_tests__');
const options = {
  noLib: true, types: [],
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

describe('runtime import cycles', () => {
  it('allows an acyclic diamond and ignores external packages', () => {
    expect(scan({
      'a.ts': "import './b'; import './c'; import 'node:fs';",
      'b.ts': "import './d';",
      'c.ts': "export * from './d';",
      'd.ts': 'export const value = 1;',
    }).cycles).toEqual([]);
  });

  it('finds a chain through a barrel and directory/JavaScript import spellings', () => {
    const result = scan({
      'a.ts': "import './b';",
      'b/index.ts': "export * from '../c.js';",
      'c.ts': "import './a';",
    });
    expect(result.cycles).toEqual([['a.ts', 'b/index.ts', 'c.ts', 'a.ts']]);
    expect([...result.imports.values()].flat()).toHaveLength(3);
  });

  it('has no arbitrary depth limit', () => {
    const count = 80;
    const files = Object.fromEntries(Array.from({ length: count }, (_, i) => [
      `node${i}.ts`, `import './node${(i + 1) % count}';`,
    ]));
    const result = scan(files);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toHaveLength(count + 1);
    expect([...result.imports.values()].flat()).toHaveLength(count);
  });

  it('reports every participating import, without blaming an incoming acyclic edge', () => {
    const result = scan({
      'entry.ts': "import './a';",
      'a.ts': "import './b'; import './c';",
      'b.ts': "import './c';",
      'c.ts': "import './a';",
    });
    expect(result.cycles).toEqual([
      ['a.ts', 'b.ts', 'c.ts', 'a.ts'],
      ['a.ts', 'c.ts', 'a.ts'],
    ]);
    expect([...result.imports.values()].flat()).toHaveLength(4);
    expect(result.imports.has(resolve(fixtureRoot, 'entry.ts'))).toBe(false);
  });

  it('excludes erased type imports, type exports, and import types', () => {
    expect(scan({
      'a.ts': `
        import type { B } from './b';
        import { type C } from './b';
        export type * from './b';
        export { type D } from './b';
        import type E = require('./b');
        type F = import('./b').B;
      `,
      'b.ts': "import './a'; export type B = number;",
    }).cycles).toEqual([]);
  });

  it('retains value imports mixed with types and verbatim side-effect imports', () => {
    expect(scan({
      'a.ts': "import { type B, value } from './b'; value();",
      'b.ts': "import './a'; export function value() {}",
    }).cycles).toHaveLength(1);
    expect(scan({
      'a.ts': "import { type B } from './b';",
      'b.ts': "import './a'; export type B = number;",
    }, { verbatimModuleSyntax: true }).cycles).toHaveLength(1);
  });

  it('includes self imports, literal dynamic imports, and require dependencies', () => {
    expect(scan({
      'a.ts': "import './a'; export const load = () => import('./b');",
      'b.ts': "const dependency = require('./c');",
      'c.ts': "import dependency = require('./a');",
    }).cycles).toEqual([
      ['a.ts', 'a.ts'],
      ['a.ts', 'b.ts', 'c.ts', 'a.ts'],
    ]);
  });

  it('fails explicitly for an unresolved relative runtime import', () => {
    expect(() => scan({ 'a.ts': "import './missing';" })).toThrow('Cannot resolve runtime import "./missing"');
  });

  it('keeps production source free of runtime import cycles', () => {
    const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    expect(parsed.errors).toEqual([]);
    const filenames = ts.sys.readDirectory(sourceRoot,
      ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'],
      ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts'],
    );
    const files = filenames.map(filename => ts.createSourceFile(filename, ts.sys.readFile(filename), ts.ScriptTarget.Latest));
    const { cycles } = findImportCycles(files, sourceRoot, parsed.options);
    const paths = cycles.map(cycle => cycle.map(file => `src/${file}`).join(' -> '));
    expect(cycles.length, `Runtime import cycles:\n${paths.join('\n')}`).toBe(0);
  });
});

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

const chain = {
  'a.ts': "import './b';",
  'b.ts': "export * from './c';",
  'c.ts': "import './a';",
};
tester.run('no-import-cycles', rule, {
  valid: [
    lintCase({ 'a.ts': "import './b';", 'b.ts': 'export const value = 1;' }),
    // The current file is unchanged; a new project snapshot reflects a dependency edit.
    lintCase({ ...chain, 'c.ts': "import type { A } from './a';" }),
  ],
  invalid: [
    {
      ...lintCase(chain),
      errors: [{
        messageId: 'cycle', line: 1, column: 8, endLine: 1, endColumn: 13,
        data: { path: '__cycle_tests__/a.ts -> __cycle_tests__/b.ts -> __cycle_tests__/c.ts -> __cycle_tests__/a.ts' },
      }],
    },
    {
      ...lintCase({ 'a.ts': "import './a';" }),
      errors: [{ messageId: 'cycle', data: { path: '__cycle_tests__/a.ts -> __cycle_tests__/a.ts' } }],
    },
  ],
});

function scan(contents, overrides = {}) {
  return findImportCycles(sourceFiles(contents), fixtureRoot, { ...options, ...overrides });
}

function sourceFiles(contents) {
  return Object.entries(contents).map(([name, code]) => ts.createSourceFile(
    resolve(fixtureRoot, name), code, ts.ScriptTarget.Latest, true,
  ));
}

function lintCase(contents) {
  const files = new Map(sourceFiles(contents).map(file => [resolve(file.fileName), file]));
  const host = ts.createCompilerHost(options);
  host.getSourceFile = filename => files.get(resolve(filename));
  host.fileExists = filename => files.has(resolve(filename));
  host.readFile = filename => files.get(resolve(filename))?.text;
  host.directoryExists = () => true;
  const program = ts.createProgram([...files.keys()], options, host);
  const filename = resolve(fixtureRoot, 'a.ts');
  return { filename, code: contents['a.ts'], languageOptions: { parserOptions: { programs: [program] } } };
}
