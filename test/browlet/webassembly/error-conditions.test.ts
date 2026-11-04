import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSiblingWindow } from '../../support/windows';

// JavaScript API §7: native failures unwind the current call, not the instance.
// §7.2 permits fatal out-of-memory handling. Do not turn this into a process-wide
// exhaustion test; deterministic failed growth is covered by memory/table tests.
describe('WebAssembly error conditions', () => {
  it('uses the JavaScript stack-overflow class and can call the instance again', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as (n: number) => number;
      const recurse = (): number => 1 + recurse();
      let jsError: unknown;
      try { recurse(); } catch (error) { jsError = error; }
      const attempts = [1, 2].map(() => {
        let sameClass = false;
        try { run(1); } catch (error) {
          sameClass = error instanceof Error && jsError instanceof Error &&
            Object.getPrototypeOf(error) === Object.getPrototypeOf(jsError) && !(error instanceof WebAssembly.RuntimeError);
        }
        return { sameClass, recovered: run(0) };
      });
      return attempts;
    }, recursiveModule)).toEqual([{ sameClass: true, recovered: 7 }, { sameClass: true, recovered: 7 }]);
  });

  it('keeps stack-overflow errors in the exported function realm', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    Reflect.set(browser.window, 'foreign', createSiblingWindow(browser));
    expect(await browser.evaluate((source) => {
      const foreign = Reflect.get(globalThis, 'foreign') as typeof globalThis;
      const run = new foreign.WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports.run as (n: number) => number;
      let ownError = false;
      try { run(1); } catch (error) {
        const foreignError = error instanceof foreign.RangeError;
        const localError = error instanceof RangeError;
        const wasmTrap = error instanceof foreign.WebAssembly.RuntimeError;
        ownError = foreignError && !localError && !wasmTrap;
      }
      return { ownError, recovered: run(0) };
    }, recursiveModule)).toEqual({ ownError: true, recovered: 7 });
  });

  it('preserves earlier state changes across traps without running subsequent instructions', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const exports = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source))).exports;
      const run = exports.run as (trap: number) => number;
      const state = exports.state as WebAssembly.Global;
      return [1, 2].map(() => {
        let trapped = false;
        try { run(1); } catch (error) { trapped = error instanceof WebAssembly.RuntimeError; }
        const afterTrap: unknown = state.value;
        return { trapped, afterTrap, recovered: run(0), afterSuccess: state.value as unknown };
      });
    }, stateModule)).toEqual([
      { trapped: true, afterTrap: 1, recovered: 7, afterSuccess: 12 },
      { trapped: true, afterTrap: 13, recovered: 7, afterSuccess: 24 },
    ]);
  });

  it('unwinds a throwing import and preserves the exact thrown value before the next call', async () => {
    const browser = new Browlet({ route: () => '', reporting: false });
    expect(await browser.evaluate((source) => {
      const markers = [new Error('import'), new DOMException('import', 'AbortError'), {}, null, undefined, 7, Symbol('import')];
      let shouldThrow = true;
      let marker: unknown;
      let calls = 0;
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), {
        env: {
          run() {
            calls++;
            // Wasm must preserve arbitrary JavaScript exceptions, including primitives.
            if (shouldThrow) throw marker;
          },
        },
      }).exports.run as () => number;
      const results = markers.map((value) => {
        shouldThrow = true;
        marker = value;
        let original = false;
        try { run(); } catch (error) { original = error === marker; }
        shouldThrow = false;
        return { original, recovered: run() };
      });
      return { results, calls };
    }, importedModule)).toEqual({ results: Array.from({ length: 7 }, () => ({ original: true, recovered: 7 })), calls: 14 });
  });
});

// (module (func (export "run") (param i32) (result i32)
//   local.get 0 if local.get 0 call 0 drop end i32.const 7))
const recursiveModule = moduleBytes(
  section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]), section(3, [1, 0]), section(7, [1, ...name('run'), 0, 0]),
  section(10, code([0, 0x20, 0, 0x04, 0x40, 0x20, 0, 0x10, 0, 0x1a, 0x0b, 0x41, 7, 0x0b])),
);

// run(trap): increment the exported global, optionally trap, then add ten and return 7.
const stateModule = moduleBytes(
  section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]), section(3, [1, 0]), section(6, [1, 0x7f, 1, 0x41, 0, 0x0b]),
  section(7, [2, ...name('run'), 0, 0, ...name('state'), 3, 0]),
  section(10, code([0, 0x23, 0, 0x41, 1, 0x6a, 0x24, 0, 0x20, 0, 0x04, 0x40, 0x00, 0x0b,
    0x23, 0, 0x41, 10, 0x6a, 0x24, 0, 0x41, 7, 0x0b])),
);

// (module (import "env" "run" (func)) (func (export "run") (result i32) call 0 i32.const 7))
const importedModule = moduleBytes(
  section(1, [2, 0x60, 0, 0, 0x60, 0, 1, 0x7f]), section(2, [1, ...name('env'), ...name('run'), 0, 0]),
  section(3, [1, 1]), section(7, [1, ...name('run'), 0, 1]), section(10, code([0, 0x10, 0, 0x41, 7, 0x0b])),
);

function moduleBytes(...sections: number[][]): number[] { return [0, 97, 115, 109, 1, 0, 0, 0, ...sections.flat()]; }
function section(id: number, bytes: number[]): number[] { return [id, bytes.length, ...bytes]; }
function code(body: number[]): number[] { return [1, body.length, ...body]; }
function name(value: string): number[] { return [value.length, ...Buffer.from(value)]; }
