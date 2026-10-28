'use strict';

// Tiny binary fixtures, with Wasm instruction bytes at each call site. No WAT
// compiler, copied engine test harness, or downloaded dependency is required.
const kind = { function: 0, table: 1, memory: 2, global: 3 };
function binary({ types = [[[], [0x7f]]], imports = [], functions = [],
  tables = [], memories = [], globals = [], exports = [], start } = {}) {
  const sections = [];
  const section = (id, bytes) => sections.push(id, ...uint(bytes.length), ...bytes);
  section(1, vector(types.map(([params, results]) => [0x60, ...vector(params.map(x => [x])), ...vector(results.map(x => [x]))])));
  if (imports.length) section(2, vector(imports.map(([module, name, type, descriptor]) =>
    [...string(module), ...string(name), kind[type], ...descriptor])));
  if (functions.length) section(3, vector(functions.map(fn => uint(fn.type ?? 0))));
  if (tables.length) section(4, vector(tables));
  if (memories.length) section(5, vector(memories));
  if (globals.length) section(6, vector(globals.map(g => [g.type ?? 0x7f, g.mutable ? 1 : 0, ...g.value, 0x0b])));
  if (exports.length) section(7, vector(exports.map(([name, type, index]) => [...string(name), kind[type], ...uint(index)])));
  if (start !== undefined) section(8, uint(start));
  if (functions.length) section(10, vector(functions.map(fn => {
    const body = [0, ...fn.code, 0x0b];
    return [...uint(body.length), ...body];
  })));
  return Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, ...sections]);
}

function uint(value) {
  const bytes = [];
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    bytes.push(byte | (value ? 0x80 : 0));
  } while (value);
  return bytes;
}
function string(value) {
  const bytes = Buffer.from(value);
  return [...uint(bytes.length), ...bytes];
}
function vector(entries) { return [...uint(entries.length), ...entries.flat()]; }

function constant(name = 'answer') {
  return binary({ functions: [{ code: [0x41, 42] }], exports: [[name, 'function', 0]] });
}
function callImport(module = './js', name = 'answer') {
  return binary({ imports: [[module, name, 'function', [0]]],
    functions: [{ code: [0x10, 0] }], exports: [['answer', 'function', 1]] });
}
function mutableGlobal() {
  // (global (export "value") (mut i32) (i32.const 1))
  // (func (export "bump") (global.set 0 (i32.add (global.get 0) (i32.const 1))))
  // (func (export "read") (result i32) (global.get 0))
  return binary({ types: [[[], []], [[], [0x7f]]], globals: [{ mutable: true, value: [0x41, 1] }],
    functions: [{ code: [0x23, 0, 0x41, 1, 0x6a, 0x24, 0] }, { type: 1, code: [0x23, 0] }],
    exports: [['value', 'global', 0], ['bump', 'function', 0], ['read', 'function', 1]] });
}
function importGlobal(module = './dep') {
  return binary({ imports: [[module, 'value', 'global', [0x7f, 1]]],
    functions: [{ code: [0x23, 0] }], exports: [['read', 'function', 0], ['value', 'global', 0]] });
}

module.exports = { binary, constant, callImport, mutableGlobal, importGlobal };
