import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Resolve both package entries without ambient browser types. Only the Node API needs Node types.
const consumers = [{
  name: 'platform', types: [], source: `
  import type { Window, Document, Blob } from 'browlet/platform';
  declare const window: Window;
  const document: Document = window.document;
  const blob: Blob = new window.Blob(['hello']);
  const text: Promise<string> = blob.text();
  // @ts-expect-error only registered declarations describe the generated Window
  window.alert('hello');
`,
}, {
  name: 'browlet', types: ['node'], source: `
  import { Browlet } from 'browlet';
  import type { WindowProxy, Document } from 'browlet/platform';
  const browlet = new Browlet({ route: () => '' });
  const window: WindowProxy = browlet.window;
  const document: Document = browlet.document;
  const navigation: Promise<WindowProxy> = browlet.navigate('https://example.test/');
  // @ts-expect-error the public API retains the generated Window surface
  browlet.window.alert('hello');
  // @ts-expect-error the public API retains the generated Document surface
  browlet.document.unregisteredMember();
`,
}];

for (const { name, source, types } of consumers) {
  const file = fileURLToPath(new URL(`./${name}-consumer.mts`, import.meta.url));
  const options = {
    strict: true, noEmit: true, skipLibCheck: false,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.esnext.d.ts'], types,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (path, version, onError, createNew) => resolve(path) === file
    ? ts.createSourceFile(path, source, version, true)
    : original(path, version, onError, createNew);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  if (diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: path => path,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }));
  }
}
console.log('platform declaration artifacts passed');
