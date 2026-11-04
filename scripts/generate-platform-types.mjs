import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { require as tsRequire } from 'tsx/cjs/api';

// Loading TypeScript declarations without typechecking avoids a bootstrap dependency on the output.
const { generatePlatformTypes } = tsRequire('../src/web-idl/generate.ts', import.meta.url);
const { DefinitionAssembly } = tsRequire('../src/web-idl/assembly/index.ts', import.meta.url);
const { reference, webIDLCommonDefinitions } = tsRequire('../src/web-idl/core/index.ts', import.meta.url);
const { browletDefinitions } = tsRequire('../src/browlet/integration/web-idl/index.ts', import.meta.url);

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/generate-platform-types.mjs [--check]');

const target = new URL('../src/browlet/platform.d.ts', import.meta.url);
const assembly = new DefinitionAssembly([...webIDLCommonDefinitions, ...browletDefinitions]);
const source = generatePlatformTypes(assembly, {
  // HTML's indexed child properties belong to WindowProxy, not to a Window IDL getter.
  proxyInterfaces: { WindowProxy: { interface: 'Window', indexedGetter: reference('WindowProxy') } },
  // Wasm §5.10 defines NativeError data properties through ECMAScript, not IDL.
  // ErrorConstructor retains their call/new signatures without declaring replacement interfaces.
  namespaceProperties: { WebAssembly: {
    CompileError: 'ErrorConstructor', LinkError: 'ErrorConstructor', RuntimeError: 'ErrorConstructor',
  } },
});
let previous;
try {
  previous = await readFile(target, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (args.includes('--check')) {
  if (previous !== source) {
    console.error('Platform declarations are stale. Run npm run generate:types.');
    process.exitCode = 1;
  } else {
    console.log('Platform declarations are current.');
  }
} else if (previous !== source) {
  await writeFile(target, source);
  console.log(`Generated ${fileURLToPath(target)}`);
} else {
  console.log('Platform declarations are unchanged.');
}
