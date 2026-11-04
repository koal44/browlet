import type * as Platform from '../../../../src/browlet/platform';

declare const window: Platform.Window;
const wasm = window.WebAssembly;
declare const module: Platform.WebAssembly.Module;
declare const instance: Platform.WebAssembly.Instance;
declare const memory: Platform.WebAssembly.Memory;
declare const table: Platform.WebAssembly.Table;
declare const global: Platform.WebAssembly.Global;
declare const tag: Platform.WebAssembly.Tag;
declare const exception: Platform.WebAssembly.Exception;

const imports: Platform.ModuleImportDescriptor[] = wasm.Module.imports(module);
const exports: Platform.ModuleExportDescriptor[] = wasm.Module.exports(module);
const importModule: string = imports[0]!.module;
const importName: string = imports[0]!.name;
const exportKind: Platform.ImportExportKind = exports[0]!.kind;
const tagKind: Platform.ImportExportKind = 'tag';
// @ts-expect-error ImportExportKind is not an arbitrary string.
const invalidKind: Platform.ImportExportKind = 'function-like';
// @ts-expect-error Reflection requires a Module argument.
wasm.Module.imports();
// @ts-expect-error Metadata properties are required.
const incompleteImport: Platform.ModuleImportDescriptor = { name: 'entry', kind: 'function' };

const instanceExports: object = instance.exports;
// @ts-expect-error Instance exports is read-only.
instance.exports = {};

const previousPages: Platform.AddressValue = memory.grow(1);
memory.grow(1n);
const buffer: ArrayBuffer | SharedArrayBuffer = memory.buffer;
const fixed: ArrayBuffer | SharedArrayBuffer = memory.toFixedLengthBuffer();
const resizable: ArrayBuffer | SharedArrayBuffer = memory.toResizableBuffer();
// @ts-expect-error Growing requires a delta.
memory.grow();
// @ts-expect-error Memory buffer is read-only.
memory.buffer = new ArrayBuffer(0);

const previousLength: Platform.AddressValue = table.grow(1);
table.grow(1n, null);
table.get(0);
table.set(0);
const setResult: void = table.set(0n, undefined);
const length: Platform.AddressValue = table.length;
// @ts-expect-error Table set requires an index, even when omitting the value.
table.set();
// @ts-expect-error Table length is read-only.
table.length = 0;

global.value = 7n;
global.value = { arbitrary: 'externref' };
const value: unknown = global.value;
const valueOf: unknown = global.valueOf();
const payload: unknown = exception.getArg(tag, 0);
const matches: boolean = exception.is(tag);
const stack: string | undefined = exception.stack;
// @ts-expect-error getArg requires a numeric index.
exception.getArg(tag, '0');
// @ts-expect-error Exception stack is read-only.
exception.stack = '';

for (const Constructor of [wasm.CompileError, wasm.LinkError, wasm.RuntimeError]) {
  const called: Error = Constructor('message', { cause: 1 });
  const constructed: Error = new Constructor('message', { cause: called });
  const prototype: Error = Constructor.prototype;
  void [constructed, prototype];
}
wasm.CompileError = wasm.LinkError;
// @ts-expect-error Native error constructors expose message as a string in conventional TypeScript calls.
new wasm.RuntimeError(7);

void [imports, exports, importModule, importName, exportKind, tagKind, invalidKind, incompleteImport, instanceExports,
  previousPages, buffer, fixed, resizable, previousLength, setResult, length, value, valueOf, payload, matches, stack];
