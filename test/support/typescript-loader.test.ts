import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('reuses transforms across processes while evaluating a fresh module in each process', () => {
  const directory = mkdtempSync(join(tmpdir(), 'browlet-typescript-loader-'));
  const entry = join(directory, 'fixture.ts');
  const source = `
    import { randomUUID } from 'node:crypto';
    enum Answer { Value = 42 }
    export const answer = Answer.Value;
    export const identity = randomUUID();
  `;
  writeFileSync(entry, source);
  try {
    const first = runLoader(entry);
    const second = runLoader(entry);
    expect(first.answer).toBe(42);
    expect(first.writes).toBeGreaterThan(0);
    expect(second.answer).toBe(42);
    expect(second.writes).toBe(0);
    expect(second.identity).not.toBe(first.identity);
    expect(first.sameModule).toBe(true);
    expect(second.sameModule).toBe(true);
    expect(first.restoredTemp).toBe(true);
    expect(second.restoredTemp).toBe(true);

    writeFileSync(entry, source.replace('Value = 42', 'Value = 43'));
    const changed = runLoader(entry);
    expect(changed.answer).toBe(43);
    expect(changed.writes).toBeGreaterThan(0);

    const uncached = runLoader(entry, true);
    expect(uncached.answer).toBe(43);
    expect(uncached.writes).toBe(0);
    expect(uncached.identity).not.toBe(changed.identity);
    expect(uncached.restoredTemp).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runLoader(entry: string, disableCache = false) {
  const loader = resolve('test/support/typescript.cjs');
  const output = execFileSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    let writes = 0;
    const writeFile = fs.promises.writeFile;
    fs.promises.writeFile = function (...args) {
      writes++;
      return writeFile.apply(this, args);
    };
    const temp = [process.env.TMPDIR, process.env.TMP, process.env.TEMP];
    const { requireTypeScript: load } = require(process.argv[1]);
    const entry = process.argv[2];
    const result = load(entry, entry);
    const sameModule = load(entry, entry) === result;
    const restoredTemp = JSON.stringify(temp) === JSON.stringify([process.env.TMPDIR, process.env.TMP, process.env.TEMP]);
    process.once('beforeExit', () => console.log(JSON.stringify({ ...result, writes, sameModule, restoredTemp })));
  `, loader, entry], {
    cwd: resolve('.'), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, TSX_DISABLE_CACHE: disableCache ? '1' : '' },
  });
  return JSON.parse(output) as {
    answer: number; identity: string; writes: number; sameModule: boolean; restoredTemp: boolean;
  };
}
