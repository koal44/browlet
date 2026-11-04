import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BindingWorld, DOMExceptionImpl, DOMExceptionNames } from '../../../src/web-idl/index';
import { SandboxEnvironment, type BrowletEnvironment } from '../../../src/browlet/environment/index';
import { createBrowletEnvironmentInit } from '../../../src/browlet/integration/web-idl/index';
import { structuredSerialize, structuredSerializeForStorage } from '../../../src/browlet/scripting/structured-data/serialize';
import { structuredDeserialize } from '../../../src/browlet/scripting/structured-data/deserialize';
import { structuredSerializeWithTransfer, structuredDeserializeWithTransfer } from '../../../src/browlet/scripting/structured-data/transfer';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';
import { createSiblingWindow } from '../../support/windows';
import { createManualRealm } from '../../support/browlet-agent';
import { PlatformRecordSource } from '../../../src/web-idl/index';

describe('WebAssembly Web API serialization', () => {
  it('clones Modules with their code and graph identity, without copying author properties', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      Object.defineProperty(module, 'extra', { enumerable: true, get() { throw new Error('author getter'); } });
      const graph = { module, repeated: [module] };
      const clone = structuredClone(graph);
      const instance = new WebAssembly.Instance(clone.module);
      return {
        distinct: clone.module !== module,
        repeated: clone.repeated[0] === clone.module,
        module: clone.module instanceof WebAssembly.Module,
        extra: Object.hasOwn(clone.module, 'extra'),
        result: (instance.exports.read as () => number)(),
      };
    }, moduleBytes)).toEqual({ distinct: true, repeated: true, module: true, extra: false, result: 7 });
  });

  it('clones Modules produced by compile and compileStreaming', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (bytes) => {
      const binary = new Uint8Array(bytes);
      const modules = await Promise.all([
        WebAssembly.compile(binary),
        WebAssembly.compileStreaming(new Response(binary, { headers: { 'Content-Type': 'application/wasm' } })),
      ]);
      return modules.map((module) => {
        const clone = structuredClone(module);
        return clone !== module && clone instanceof WebAssembly.Module &&
          (new WebAssembly.Instance(clone).exports.read as () => number)() === 7;
      });
    }, moduleBytes)).toEqual([true, true]);
  });

  it('creates a fresh Module in the target realm and records its owner', async () => {
    const browser = fixture();
    const foreign = createSiblingWindow(browser);
    Reflect.set(browser.window, 'foreign', foreign);
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const other = Reflect.get(globalThis, 'foreign') as Window & typeof globalThis;
      const clone = other.structuredClone(module);
      if (!(clone instanceof other.WebAssembly.Module) || clone instanceof WebAssembly.Module) throw new Error('wrong realm');
      Reflect.set(globalThis, 'moduleClone', clone);
      return true;
    }, moduleBytes)).toBe(true);
    const clone: unknown = Reflect.get(browser.window, 'moduleClone');
    const realm = getRelevantRealm(foreign);
    expect(getBindingContext(realm).getPlatformRecord(clone, PlatformRecordSource.Platform)?.realm).toBe(realm);
  });

  it('rejects storage serialization and delivery to another agent cluster', () => {
    const browser = fixture();
    const source = getBindingContext(getRelevantRealm(browser.window));
    const target = getBindingContext(getRelevantRealm(fixture().window));
    const module: unknown = Reflect.construct(source.realm.WebAssemblyModule, [new Uint8Array(moduleBytes)]);
    expect(source.realm.agent.agentCluster).not.toBe(target.realm.agent.agentCluster);
    expect(() => structuredSerializeForStorage({ module }, source)).toThrow(DOMExceptionImpl);
    const serialized = structuredSerialize(module, source);
    try {
      structuredDeserialize(serialized, target);
      throw new Error('cross-cluster clone succeeded');
    } catch (error) {
      expect(error).toBeInstanceOf(DOMExceptionImpl);
      expect((error as DOMExceptionImpl).name).toBe(DOMExceptionNames.dataClone);
    }
    const message = structuredSerializeWithTransfer({ module }, [], source);
    expect(message.interfaceNames.has('Module')).toBe(true);
    expect(message.cluster).toBe(source.realm.agent.agentCluster);
    expect(() => structuredDeserializeWithTransfer(message, target)).toThrow(DOMExceptionImpl);
  });

  it('uses the serializing realm cluster, independently of the original Module owner', () => {
    const original = getBindingContext(getRelevantRealm(fixture().window));
    const source = getBindingContext(getRelevantRealm(fixture().window));
    const module: unknown = Reflect.construct(original.realm.WebAssemblyModule, [new Uint8Array(moduleBytes)]);
    const serialized = structuredSerialize(module, source);
    expect(serialized.cluster).toBe(source.realm.agent.agentCluster);
    expect(structuredDeserialize(serialized, source)).not.toBe(module);
    expect(() => structuredDeserialize(serialized, original)).toThrow(DOMExceptionImpl);
  });

  it('checks Module exposure before consuming any receiving transfer holders', () => {
    const source = getBindingContext(getRelevantRealm(fixture().window));
    const bindings = new BindingWorld<BrowletEnvironment>([]);
    const realm = createManualRealm({ agent: source.realm.agent });
    const target = bindings.register(realm, (ctx) => new SandboxEnvironment(ctx.realm, createBrowletEnvironmentInit(ctx)));
    const module: unknown = Reflect.construct(source.realm.WebAssemblyModule, [new Uint8Array(moduleBytes)]);
    const buffer = new ArrayBuffer(4);
    const serialized = structuredSerialize(module, source);
    expect(() => structuredDeserialize(serialized, target)).toThrow(DOMExceptionImpl);
    const message = structuredSerializeWithTransfer({ module, buffer }, [buffer], source);
    expect(buffer.byteLength).toBe(0);
    expect(() => structuredDeserializeWithTransfer(message, target)).toThrow(DOMExceptionImpl);
    const holder = message.transferDataHolders[0]!;
    if (holder.type === 'platform-object') throw new Error('wrong holder');
    expect(holder.buffer.byteLength).toBe(4);
  });

  it('snapshots native state without retaining the original Module or its expandos', () => {
    const source = getBindingContext(getRelevantRealm(fixture().window));
    const module = Reflect.construct(source.realm.WebAssemblyModule, [new Uint8Array(moduleBytes)]) as object;
    Object.defineProperty(module, 'extra', { enumerable: true, get() { throw new Error('author getter'); } });
    Object.setPrototypeOf(module, null);
    const serialized = structuredSerialize(module, source);
    expect(serialized.type).toBe('WebAssembly.Module');
    if (serialized.type !== 'WebAssembly.Module') throw new Error('wrong record');
    expect(serialized.module).not.toBe(module);
    expect(Object.hasOwn(serialized.module, 'extra')).toBe(false);
    const first = structuredDeserialize(serialized, source);
    const second = structuredDeserialize(serialized, source);
    expect(first).not.toBe(second);
    expect(getBindingContext(source.realm).getPlatformRecord(first, PlatformRecordSource.Platform)?.realm).toBe(source.realm);
  });

  it('preserves imported-string and builtin compile options when cloning', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (bytes) => {
      const module = await WebAssembly.compile(new Uint8Array(bytes), {
        builtins: ['js-string'], importedStringConstants: 'strings',
      });
      const clone = structuredClone(module);
      const instance = new WebAssembly.Instance(clone);
      return {
        text: (instance.exports.hello as WebAssembly.Global).value as unknown,
        length: (instance.exports.length as (text: string) => number)('hello'),
      };
    }, builtinModule)).toEqual({ text: 'hello', length: 5 });
  });

  it('delivers Modules through MessagePort with repeated identity', async () => {
    const browser = fixture();
    expect(await browser.evaluate(async (bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const channel = new MessageChannel();
      const received = new Promise<boolean>((resolve) => {
        channel.port2.onmessage = ({ data }: MessageEvent<{ first: WebAssembly.Module; second: WebAssembly.Module; }>) => {
          resolve(data.first !== module && data.first === data.second && data.first instanceof WebAssembly.Module &&
            (new WebAssembly.Instance(data.first).exports.read as () => number)() === 7);
        };
      });
      channel.port1.postMessage({ first: module, second: module });
      const result = await received;
      channel.port1.close();
      channel.port2.close();
      return result;
    }, moduleBytes)).toBe(true);
  });

  it('rejects Module transfers before detaching other transfer entries', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const buffer = new ArrayBuffer(4);
      try { structuredClone({ module, buffer }, { transfer: [buffer, module] }); }
      catch (error) { return error instanceof DOMException && error.name === 'DataCloneError' && buffer.byteLength === 4; }
      return false;
    }, moduleBytes)).toBe(true);
  });

  it('rejects Module proxies and live non-Module Wasm objects', async () => {
    const browser = fixture();
    expect(await browser.evaluate((bytes) => {
      const module = new WebAssembly.Module(new Uint8Array(bytes));
      const values = [new Proxy(module, {}), new WebAssembly.Instance(module), new WebAssembly.Memory({ initial: 0 }),
        new WebAssembly.Table({ element: 'anyfunc', initial: 0 }), new WebAssembly.Global({ value: 'i32' })];
      return values.every((value) => {
        try { structuredClone(value); }
        catch (error) { return error instanceof DOMException && error.name === 'DataCloneError'; }
        return false;
      });
    }, moduleBytes)).toBe(true);
  });
});

function fixture(): Browlet { return new Browlet({ route: () => '', reporting: false }); }

// (module (func (export "read") (result i32) i32.const 7))
const moduleBytes = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 0x60, 0, 1, 0x7f,
  3, 2, 1, 0, 7, 8, 1, 4, 114, 101, 97, 100, 0, 0, 10, 6, 1, 4, 0, 0x41, 7, 0x0b,
];

// Import a compile-time string and js-string.length, then export both.
const builtinModule = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 0x60, 1, 0x6f, 1, 0x7f,
  2, 42, 2, 7, 115, 116, 114, 105, 110, 103, 115, 5, 104, 101, 108, 108, 111, 3, 0x6f, 0,
  14, 119, 97, 115, 109, 58, 106, 115, 45, 115, 116, 114, 105, 110, 103, 6, 108, 101, 110, 103, 116, 104, 0, 0,
  7, 18, 2, 5, 104, 101, 108, 108, 111, 3, 0, 6, 108, 101, 110, 103, 116, 104, 0, 0,
];
