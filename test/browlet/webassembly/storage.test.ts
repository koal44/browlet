import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';

// WebAssembly JavaScript API §§4.1–4.2. Exercise native state through Browlet's
// author realms; these same-Agent checks do not establish cross-Agent isolation.
describe('WebAssembly store and object identities', () => {
  it('shares memory updates between Wasm and JavaScript in sibling realms', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const exports = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes))).exports as StoreExports;
      const ownView = new Uint8Array(exports.memory.buffer);
      const foreignView = new foreign.Uint8Array(exports.memory.buffer);
      foreignView[0] = 29;
      const read = exports.read();
      exports.write(42);
      return [read, ownView[0], foreignView[0]];
    }, storeBytes)).toEqual([29, 42, 42]);
  });

  it('reuses native objects when another realm imports and re-exports their addresses', async () => {
    const browser = fixture();
    expect(await browser.evaluate(({ source, aliases }) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const exports = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports as StoreExports;
      const module = new foreign.WebAssembly.Module(new Uint8Array(aliases));
      const first = new foreign.WebAssembly.Instance(module, { env: exports }).exports as CachedExports;
      const second = new foreign.WebAssembly.Instance(module, { env: exports }).exports as CachedExports;
      exports.table.set(0, exports.read);
      return {
        distinctConstructors: WebAssembly.Memory !== foreign.WebAssembly.Memory,
        foreignModule: Object.getPrototypeOf(module) === foreign.WebAssembly.Module.prototype,
        sameObjects: [first, second].every((alias) =>
          alias.memory === exports.memory && alias.table === exports.table &&
          alias.global === exports.global && alias.read === exports.read),
        sameBuffer: first.memory.buffer === exports.memory.buffer,
        sameFunction: first.table.get(0) === exports.read,
      };
    }, { source: storeBytes, aliases: aliasBytes })).toEqual({
      distinctConstructors: true, foreignModule: true,
      sameObjects: true, sameBuffer: true, sameFunction: true,
    });
  });

  it('round-trips host values, including platform objects, through externref without projection', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const exports = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes))).exports as StoreExports;
      const values = [
        undefined, null, false, NaN, -0, 42, 1n, 'kept', Symbol('host'),
        {}, () => 42, document.createElement('div'), foreign.document,
      ];
      return values.every((value) => Object.is(exports.echo(value), value));
    }, storeBytes)).toBe(true);
  });
});

function fixture(): Browlet {
  const browser = new Browlet({ route: () => '', reporting: false });
  const foreign = createSiblingWindow(browser);
  expect(getRelevantRealm(foreign).agent).toBe(getRelevantRealm(browser.window).agent);
  Reflect.set(browser.window, 'foreign', foreign);
  return browser;
}

type CachedExports = {
  read: () => number;
  table: WebAssembly.Table;
  memory: WebAssembly.Memory;
  global: WebAssembly.Global;
};
type StoreExports = CachedExports & {
  write: (value: number) => void;
  echo: (value: unknown) => unknown;
};

// (module
//   (table (export "table") 1 funcref)
//   (memory (export "memory") 1)
//   (global (export "global") (mut i32) (i32.const 1))
//   (func (export "read") (result i32) (i32.load8_u (i32.const 0)))
//   (func (export "write") (param i32) (i32.store8 (i32.const 0) (local.get 0)))
//   (func (export "echo") (param externref) (result externref) (local.get 0)))
const storeBytes = [
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0e, 0x03, 0x60, 0x00, 0x01, 0x7f, 0x60,
  0x01, 0x7f, 0x00, 0x60, 0x01, 0x6f, 0x01, 0x6f, 0x03, 0x04, 0x03, 0x00, 0x01, 0x02, 0x04, 0x04,
  0x01, 0x70, 0x00, 0x01, 0x05, 0x03, 0x01, 0x00, 0x01, 0x06, 0x06, 0x01, 0x7f, 0x01, 0x41, 0x01,
  0x0b, 0x07, 0x31, 0x06, 0x04, 0x72, 0x65, 0x61, 0x64, 0x00, 0x00, 0x05, 0x77, 0x72, 0x69, 0x74,
  0x65, 0x00, 0x01, 0x04, 0x65, 0x63, 0x68, 0x6f, 0x00, 0x02, 0x05, 0x74, 0x61, 0x62, 0x6c, 0x65,
  0x01, 0x00, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x06, 0x67, 0x6c, 0x6f, 0x62,
  0x61, 0x6c, 0x03, 0x00, 0x0a, 0x18, 0x03, 0x07, 0x00, 0x41, 0x00, 0x2d, 0x00, 0x00, 0x0b, 0x09,
  0x00, 0x41, 0x00, 0x20, 0x00, 0x3a, 0x00, 0x00, 0x0b, 0x04, 0x00, 0x20, 0x00, 0x0b,
];

// (module
//   (import "env" "read" (func (result i32)))
//   (import "env" "table" (table 1 funcref))
//   (import "env" "memory" (memory 1))
//   (import "env" "global" (global (mut i32)))
//   (export "read" (func 0)) (export "table" (table 0))
//   (export "memory" (memory 0)) (export "global" (global 0)))
const aliasBytes = [
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x02,
  0x36, 0x04, 0x03, 0x65, 0x6e, 0x76, 0x04, 0x72, 0x65, 0x61, 0x64, 0x00, 0x00, 0x03, 0x65, 0x6e,
  0x76, 0x05, 0x74, 0x61, 0x62, 0x6c, 0x65, 0x01, 0x70, 0x00, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06,
  0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x67, 0x6c,
  0x6f, 0x62, 0x61, 0x6c, 0x03, 0x7f, 0x01, 0x07, 0x22, 0x04, 0x04, 0x72, 0x65, 0x61, 0x64, 0x00,
  0x00, 0x05, 0x74, 0x61, 0x62, 0x6c, 0x65, 0x01, 0x00, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79,
  0x02, 0x00, 0x06, 0x67, 0x6c, 0x6f, 0x62, 0x61, 0x6c, 0x03, 0x00,
];
