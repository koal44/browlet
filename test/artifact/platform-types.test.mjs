import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Resolve both package entries without ambient browser types. Only the Node API needs Node types.
const consumers = [{
  name: 'platform', types: [], source: `
  import type { Window, Document, Blob, WebAssembly } from 'browlet/platform';
  import * as Platform from 'browlet/platform';
  declare const window: Window;
  const document: Document = window.document;
  const blob: Blob = new window.Blob(['hello']);
  const text: Promise<string> = blob.text();
  const tag: WebAssembly.Tag = new window.WebAssembly.Tag({ parameters: [] });
  const exception: WebAssembly.Exception = new window.WebAssembly.Exception(tag, []);
  const exceptionConstructor: WebAssembly.ExceptionConstructor = window.WebAssembly.Exception;
  // @ts-expect-error LegacyNamespace types do not become flat exports
  type FlatException = Platform.Exception;
  // @ts-expect-error the type-only namespace does not invent a runtime export
  Platform.WebAssembly;
  const clone = window.structuredClone({ count: 1 });
  const event = new window.CustomEvent('data', { detail: 'text' });
  const count: number = clone.count;
  const detail: string = event.detail;
  // @ts-expect-error packaged declarations retain structuredClone inference
  const wrongCount: string = clone.count;
  // @ts-expect-error packaged declarations retain CustomEvent inference
  const wrongDetail: number = event.detail;
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
  // Package self-reference checks this checkout's exports, even when node_modules is shared with another worktree.
  const file = fileURLToPath(new URL(`../../packages/browlet/${name}-consumer.mts`, import.meta.url));
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
