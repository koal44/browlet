import { mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rollup } from 'rollup';
import ts from 'typescript';

/** Compile the source fixture once; abruptly terminated isolates must not perform loader cache writes. */
export async function buildWorkerFixture(): Promise<string> {
  const directory = resolve(__dirname, '../../../../node-compat/.cache/worker-fixtures');
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `thread-${process.pid}.cjs`);
  const entry = resolve(__dirname, 'thread.mjs');
  const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
  const bundle = await rollup({
    input: entry,
    external: (id) => !id.startsWith('.') && !isAbsolute(id),
    plugins: [{
      name: 'worker-fixture-typescript',
      resolveId(source, importer) {
        if (importer === undefined || !source.startsWith('.')) return null;
        return ts.resolveModuleName(source, importer, {
          ...compilerOptions, moduleResolution: ts.ModuleResolutionKind.Bundler,
        }, ts.sys).resolvedModule?.resolvedFileName ?? null;
      },
      load(id) {
        if (!id.endsWith('.ts')) return null;
        return ts.transpileModule(readFileSync(id, 'utf8'), { compilerOptions, fileName: id }).outputText;
      },
      resolveImportMeta(property, { moduleId }) {
        // Keep the source adapter's startup marker distinct from this fixture's
        // bundle URL, so only the fixture starts the worker runtime.
        if (property === 'url' && resolve(moduleId) !== entry) return JSON.stringify(pathToFileURL(moduleId).href);
        return null;
      },
    }],
    onwarn(warning, warn) {
      // The existing runtime graph contains cycles, also present in the package bundle.
      if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning);
    },
  });
  try {
    await bundle.write({ file, format: 'cjs', sourcemap: false });
    return file;
  } finally {
    await bundle.close();
  }
}
