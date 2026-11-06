import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { ESLint } from 'eslint';
import { clearCandidateTSConfigRootDirs } from '@typescript-eslint/typescript-estree';
import tseslint from 'typescript-eslint';
import { afterEach, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const otherRoot = resolve(fileURLToPath(new URL('./fixtures/other-checkout/', import.meta.url)));

afterEach(() => { clearCandidateTSConfigRootDirs(); });

it('keeps linting after inspecting an ignored dependency in another checkout', async () => {
  // Root selection happens before program creation. Exercise the real config
  // and parser without building the entire TypeScript project for this check.
  const eslint = new ESLint({ cwd: root, overrideConfig: tseslint.configs.disableTypeChecked });
  const file = resolve(root, 'src/js-engine/message-channel.ts');
  const fatalMessages = results => results.flatMap(result => result.messages.filter(message => message.fatal));
  expect(fatalMessages(await eslint.lintFiles([file]))).toEqual([]);

  // VS Code loads the other checkout's configuration even for ignored Node
  // declarations. Their contents are never read, so this path need not exist.
  const other = new ESLint({ cwd: otherRoot });
  const declaration = resolve(otherRoot, 'node_modules/@types/node/worker_threads.d.ts');
  expect(await other.isPathIgnored(declaration)).toBe(true);

  // Prove the fixture still reproduces the ambiguity without our explicit root.
  const unrooted = new ESLint({ cwd: root, overrideConfig: [
    tseslint.configs.disableTypeChecked,
    { languageOptions: { parserOptions: { tsconfigRootDir: null } } },
  ] });
  expect(fatalMessages(await unrooted.lintFiles([file]))).toEqual([
    expect.objectContaining({ message: expect.stringContaining('multiple candidate TSConfigRootDirs') }),
  ]);
  expect(fatalMessages(await eslint.lintFiles([file]))).toEqual([]);
});
