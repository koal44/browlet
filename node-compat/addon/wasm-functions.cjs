'use strict';

const moduleImports = WebAssembly.Module.imports;
const instanceExports = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports').get;
const kinds = ['function', 'table', 'memory', 'global', 'tag'];

// Keep result conversion inside the caller's callback scope. Public V8 APIs
// expose Module bytes, but not import signatures or a post-conversion hook.
// A generated import/re-export bridge lets V8 do the conversion itself.
module.exports = native => {
  const modules = new WeakMap();

  return function createWebAssemblyImportCall(module, importIndex, callback, Instance) {
    let run;
    let results;
    return (...args) => {
      if (run === undefined) {
        let metadata = modules.get(module);
        if (metadata === undefined) {
          metadata = inspect(native.getWasmModuleBytes(module), moduleImports(module));
          modules.set(module, metadata);
        }
        const type = metadata.imports[importIndex];
        results = metadata.resultCounts[type];
        if (typeof results !== 'number') throw new TypeError('Expected a function import');
        let bridge = metadata.bridges.get(type);
        if (bridge === undefined) {
          // (module <original types> (import "" "" (func (type N))) (export "" (func 0)))
          const imports = [1, 0, 0, 0, ...leb(type)];
          bridge = native.compileWasmImportBridge(Buffer.concat([
            Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), metadata.types, // \0asm, binary version 1.
            Buffer.from([2, ...leb(imports.length), ...imports, 7, 4, 1, 0, 0, 0]),
          ]));
          metadata.bridges.set(type, bridge);
        }
        // Resolve revoked/callable Proxies only on invocation. Do not hand the
        // original callback to V8's import-time function-realm lookup.
        const invoke = (...values) => Reflect.apply(callback, undefined, values);
        const namespaces = Object.assign(Object.create(null), {
          '': Object.assign(Object.create(null), { '': invoke }),
        });
        const instance = new Instance(bridge, namespaces);
        run = Reflect.apply(instanceExports, instance, [])[''];
      }
      const result = Reflect.apply(run, undefined, args);
      if (results <= 1) return result;
      // Outer Wasm conversion runs after HTML cleanup. Transport the already
      // converted tuple without consulting an author-replaced Array iterator.
      return {
        [Symbol.iterator]() {
          let index = 0;
          return {
            next: () => index < results
              ? { value: result[index++], done: false }
              : { value: undefined, done: true },
          };
        },
      };
    };
  };
};

function inspect(bytes, declarations) {
  const reader = new Reader(bytes);
  reader.take(8);
  const metadata = { types: undefined, resultCounts: [], imports: [], bridges: new Map() };
  let importIndex = 0;
  while (reader.position < bytes.length) {
    const start = reader.position;
    const kind = reader.byte();
    const section = new Reader(reader.take(reader.leb()));
    if (kind === 1) {
      // Own just the type bytes, not a view retaining the entire compiled module.
      // Preserve recursive groups and indexed references for V8 canonicalization.
      metadata.types = Buffer.from(bytes.subarray(start, reader.position));
      for (let count = section.leb(); count; count--) {
        const group = section.peek() === 0x4e ? (section.byte(), section.leb()) : 1;
        for (let index = 0; index < group; index++) metadata.resultCounts.push(section.subtype());
      }
    } else if (kind === 2) {
      for (let count = section.leb(); count; count--) {
        const module = section.name();
        const name = section.name();
        const importKind = section.byte();
        let type;
        switch (importKind) {
          case 0: type = section.leb(); break;
          case 1: section.valueType(); section.limits(); break;
          case 2: section.limits(); break;
          case 3: section.valueType(); section.byte(); break;
          case 4: section.byte(); section.leb(); break;
          default: throw new Error(`Unsupported Wasm import kind: ${importKind}`);
        }
        // Native reflection omits engine-provided builtins and string constants.
        // Follow its visible declaration order, including repeated names/types.
        const declaration = declarations[importIndex];
        if (declaration?.module === module && declaration.name === name && declaration.kind === kinds[importKind]) {
          metadata.imports.push(type);
          importIndex++;
        }
      }
    }
  }
  if (importIndex !== declarations.length) throw new Error('Unsupported Wasm import metadata');
  return metadata;
}

// This reads metadata from an already validated Module; it is not a second
// Wasm validator. Unknown proposal encodings fail explicitly rather than falling
// back to running author result conversion outside the callback scope.
// TODO(wasm-proposal-types): Extend before enabling shared-everything, custom
// descriptors (including exact-function imports), core stack switching, or
// string-view types, or upgrading to a runtime that enables them by default.
// These proposals are disabled by default on our Node 24/26/custom builds.
// Ordinary shared memories and memory64 are supported. Future limits encodings
// (e.g. custom page sizes, not accepted by the current V8 decoder) also need review.
class Reader {
  constructor(bytes) { this.bytes = bytes; this.position = 0; }
  byte() {
    if (this.position >= this.bytes.length) throw new Error('Truncated Wasm metadata');
    return this.bytes[this.position++];
  }
  peek() { return this.bytes[this.position]; }
  leb() {
    let value = 0;
    for (let count = 0; count < 10; count++) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** (count * 7);
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid Wasm LEB128');
  }
  take(count) {
    const start = this.position;
    this.position += count;
    if (this.position > this.bytes.length) throw new Error('Truncated Wasm metadata');
    return this.bytes.subarray(start, this.position);
  }
  name() { return this.take(this.leb()).toString('utf8'); }
  valueType() {
    const code = this.byte();
    if (code === 0x63 || code === 0x64) {
      if (this.peek() === 0x62 || this.peek() === 0x65) this.byte();
      this.leb();
    } else if (code < 0x66 || code > 0x7f) {
      throw new Error(`Unsupported Wasm value type: ${code.toString(16)}`);
    }
  }
  limits() {
    const flags = this.byte();
    if (flags & ~7) throw new Error(`Unsupported Wasm limits: ${flags}`);
    this.leb();
    if (flags & 1) this.leb();
  }
  subtype() {
    if (this.peek() === 0x50 || this.peek() === 0x4f) {
      this.byte();
      for (let count = this.leb(); count; count--) this.leb();
    }
    const kind = this.byte();
    if (kind === 0x60) {
      for (let count = this.leb(); count; count--) this.valueType();
      const results = this.leb();
      for (let count = results; count; count--) this.valueType();
      return results;
    }
    const count = kind === 0x5f ? this.leb() : kind === 0x5e ? 1 : undefined;
    if (count === undefined) throw new Error(`Unsupported Wasm type form: ${kind.toString(16)}`);
    for (let index = 0; index < count; index++) { this.valueType(); this.byte(); }
    return null;
  }
}

function leb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
}
