import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

// Web API §4 is non-normative. Test the useful location/name components rather
// than imposing a complete stack-string format on the engine.
describe('WebAssembly diagnostic display', () => {
  it.each([
    { moduleName: '', functionName: '', displayName: '' },
    { moduleName: 'diagnostics', functionName: '', displayName: 'diagnostics' },
    { moduleName: '', functionName: 'crash', displayName: 'crash' },
    { moduleName: 'diagnostics', functionName: 'crash', displayName: 'diagnostics.crash' },
  ])('shows the name section ($moduleName / $functionName) and binary instruction location', async ({ moduleName, functionName, displayName }) => {
    const browser = fixture();
    const result = await browser.evaluate((source) => {
      const run = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(source)), { env: { noop() {} } }).exports.run as () => void;
      try { run(); } catch (error) {
        if (!(error instanceof WebAssembly.RuntimeError)) throw error;
        return { frame: error.stack?.split('\n')[1], functionName: run.name };
      }
      throw new Error('expected the unreachable instruction to trap');
    }, trapModule(moduleName, functionName));
    // The imported function occupies index 0; run is index 1. The trap is the
    // byte at offset 46 in the whole binary, not an offset into its function.
    expect(result.frame).toContain(':wasm-function[1]:0x2e');
    if (displayName) expect(result.frame).toContain(`at ${displayName} (`);
    // Diagnostic names do not change the JS API's numeric exported-function name.
    expect(result.functionName).toBe('1');
  });

  it('retains names and instruction offsets after asynchronous compilation and Module cloning', async () => {
    const browser = fixture();
    const frames = await browser.evaluate(async (source) => {
      const module = await WebAssembly.compile(new Uint8Array(source));
      return [module, structuredClone(module)].map((current) => {
        const run = new WebAssembly.Instance(current, { env: { noop() {} } }).exports.run as () => void;
        try { run(); } catch (error) {
          if (!(error instanceof WebAssembly.RuntimeError)) throw error;
          return error.stack?.split('\n')[1];
        }
        throw new Error('expected the unreachable instruction to trap');
      });
    }, trapModule('diagnostics', 'crash'));
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame).toContain('at diagnostics.crash (');
      expect(frame).toContain(':wasm-function[1]:0x2e');
    }
  });

  it.each(['compileStreaming', 'instantiateStreaming'] as const)('associates the fetched response URL with %s frames', async (operation) => {
    const browser = fixture();
    // Use fresh bytes: the native cache's first-source behavior is tested below.
    const url = moduleURL(trapModule(`stream-${operation}`, 'crash'));
    const result = await browser.evaluate(async ({ url, operation }) => {
      const response = await fetch(url);
      const sourceURL = response.url;
      Object.defineProperty(response, 'url', { get() { throw new Error('author URL getter'); } });
      const imports = { env: { noop() {} } };
      const instance = operation === 'compileStreaming'
        ? new WebAssembly.Instance(await WebAssembly.compileStreaming(response), imports)
        : (await WebAssembly.instantiateStreaming(response, imports)).instance;
      try { (instance.exports.run as () => void)(); } catch (error) {
        if (!(error instanceof WebAssembly.RuntimeError)) throw error;
        return { url: sourceURL, frame: error.stack?.split('\n')[1] };
      }
      throw new Error('expected the unreachable instruction to trap');
    }, { url, operation });
    expect(result.url).toBe(url);
    expect(result.frame).toContain(`${url}:wasm-function[1]:0x2e`);
  });

  it('retains a streamed Module\'s source URL through structured cloning', async () => {
    const browser = fixture();
    const url = moduleURL(trapModule('cloned-stream', 'crash'));
    const frame = await browser.evaluate(async (url) => {
      const module = structuredClone(await WebAssembly.compileStreaming(fetch(url)));
      try { (new WebAssembly.Instance(module, { env: { noop() {} } }).exports.run as () => void)(); }
      catch (error) { if (error instanceof WebAssembly.RuntimeError) return error.stack?.split('\n')[1]; throw error; }
      throw new Error('expected trap');
    }, url);
    expect(frame).toContain(`${url}:wasm-function[1]:0x2e`);
  });

  // SPEC_CLASH(wasm-cached-source-url): retain Chromium's first-source cache
  // behavior. Firefox attributes each streaming compilation to its own URL.
  it('retains the generated URL when identical bytes were compiled before streaming', async () => {
    const browser = fixture();
    const source = trapModule('compiled-before-streaming', 'crash');
    const url = moduleURL(source);
    const frames = await browser.evaluate(async ({ source, url }) => {
      const initial = new WebAssembly.Module(new Uint8Array(source));
      const streamed = await WebAssembly.compileStreaming(fetch(url));
      return [initial, streamed].map((module) => {
        try { (new WebAssembly.Instance(module, { env: { noop() {} } }).exports.run as () => void)(); }
        catch (error) { if (error instanceof WebAssembly.RuntimeError) return error.stack?.split('\n')[1]; throw error; }
        throw new Error('expected trap');
      });
    }, { source, url });
    expect(frames[0]).toContain('wasm://wasm/');
    expect(frames[1]).toBe(frames[0]);
  });

  it('retains the first fetched URL when identical bytes are streamed from different URLs', async () => {
    const browser = fixture();
    const first = moduleURL(trapModule('repeated-streaming', 'crash'));
    const second = first.replace('application/wasm', 'APPLICATION/WASM');
    const frames = await browser.evaluate(async (urls) => {
      const modules = [];
      for (const url of urls) modules.push(await WebAssembly.compileStreaming(fetch(url)));
      return modules.map((module) => {
        try { (new WebAssembly.Instance(module, { env: { noop() {} } }).exports.run as () => void)(); }
        catch (error) { if (error instanceof WebAssembly.RuntimeError) return error.stack?.split('\n')[1]; throw error; }
        throw new Error('expected trap');
      });
    }, [first, second]);
    expect(frames[0]).toContain(`${first}:wasm-function[1]:0x2e`);
    expect(frames[1]).toBe(frames[0]);
  });
});

function fixture(): Browlet { return new Browlet({ route: () => '', reporting: false }); }
function moduleURL(bytes: number[]): string { return `data:application/wasm;base64,${Buffer.from(bytes).toString('base64')}`; }

// (module (import "env" "noop" (func)) (func (export "run") unreachable))
// Append optional name subsections after code so the trap offset stays fixed.
function trapModule(moduleName: string, functionName: string): number[] {
  const names = [
    ...(moduleName ? section(0, name(moduleName)) : []),
    ...(functionName ? section(1, [1, 1, ...name(functionName)]) : []),
  ];
  return [
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(2, [1, ...name('env'), ...name('noop'), 0, 0]),
    ...section(3, [1, 0]),
    ...section(7, [1, ...name('run'), 0, 1]),
    ...section(10, [1, 3, 0, 0, 0x0b]),
    ...(names.length ? section(0, [...name('name'), ...names]) : []),
  ];
}

// All fixture names and section lengths fit in one unsigned LEB128 byte.
function name(value: string): number[] { return [value.length, ...Buffer.from(value)]; }
function section(id: number, bytes: number[]): number[] { return [id, bytes.length, ...bytes]; }
