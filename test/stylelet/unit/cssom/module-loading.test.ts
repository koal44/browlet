import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it.each([
  'rules/rule', 'rules/nested-declarations', 'rule-list', 'rules/property',
  'rules/grouping', 'rules/style', 'rules/import', 'rules/namespace',
  'rules/page', 'rules/margin', 'rules/context', 'css-stylesheet',
  'rules/index', 'declarations/declaration-block', 'declarations/declaration',
  'declarations/style-properties', 'declarations/index', 'media/media-list', 'media/index',
  'typed/style-property-map', 'typed/index', 'index',
])('loads %s without requiring an earlier stylesheet import', (module) => {
  // A fresh process exposes class-initialization cycles that an already loaded
  // Browlet/CSSOM barrel can hide in the rest of the suite.
  const entry = pathToFileURL(resolve(__dirname, `../../../../src/stylelet/cssom/${module}.ts`)).href;
  expect(() => execFileSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e', 'await import(process.argv[1]);', entry,
  ], { stdio: 'pipe' })).not.toThrow();
});
