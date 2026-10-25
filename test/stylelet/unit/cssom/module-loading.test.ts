import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each([
  'rules/rule', 'rules/nested-declarations', 'rule-list', 'rules/property',
  'rules/grouping', 'rules/style', 'rules/import', 'rules/namespace',
  'rules/page', 'rules/margin', 'rules/context', 'css-stylesheet',
  'rules/index', 'declarations/declaration-block', 'declarations/style-declaration',
  'declarations/interpreted-declaration', 'declarations/style-properties', 'declarations/index', 'media/media-list', 'media/index',
  'typed/style-property-map', 'typed/index', 'index',
])('loads %s without requiring an earlier stylesheet import', { timeout: 15_000 }, (module) => {
  // A fresh process exposes class-initialization cycles that an already loaded
  // Browlet/CSSOM barrel can hide in the rest of the suite.
  // These sources load as CommonJS; avoid also starting TSX's ESM loader.
  // Allow for process startup under suite load, but bound the synchronous child:
  // Vitest cannot interrupt execFileSync with its own timeout.
  const entry = resolve(__dirname, `../../../../src/stylelet/cssom/${module}.ts`);
  expect(() => execFileSync(process.execPath, [
    '--require', 'tsx/cjs', '-e', 'require(process.argv[1]);', entry,
  ], { stdio: 'pipe', timeout: 10_000 })).not.toThrow();
});
