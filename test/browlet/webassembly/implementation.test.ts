import { describe, expect, it } from 'vitest';

import type { TaskRecord, TaskSourceKey } from '../../../src/infra/index';

import { BindingWorld } from '../../../src/web-idl/index';
import type { WebAssembly as WebAssemblyAPI } from '../../../src/browlet/platform';
import { WasmImpl, wasmIDLDefinitions, type WasmEnvironment, type WebAssemblyCompileOptions } from '../../../src/browlet/webassembly/index';
import { wasmStreamingIDL } from '../../../src/browlet/webassembly/webassembly';
import { TestRealm } from '../../support/web-idl-realm';

// Exercise Web IDL conversion with a standalone realm and controlled host task delivery.
describe('WebAssembly with a standalone binding', () => {
  it('converts byte input and projects Module results without Browlet', async () => {
    const { api } = fixture();
    const bytes = new Uint8Array(emptyModule);
    const result = await api.instantiate(new DataView(bytes.buffer), undefined, { builtins: ['unknown'] });
    expect(result.module).toBeInstanceOf(Reflect.get(api, 'Module'));
    expect(result.instance).toBeInstanceOf(Reflect.get(api, 'Instance'));
    expect(await api.instantiate(result.module)).toBeInstanceOf(Reflect.get(api, 'Instance'));
  });

  it('converts DataView and iterable options before native compilation', async () => {
    const { api, realm } = fixture();
    const bytes = new Uint8Array(emptyModule);
    const view = new DataView(bytes.buffer);
    const trace: string[] = [];
    const options = {
      get builtins() {
        trace.push('builtins');
        return { *[Symbol.iterator]() { trace.push('iterator'); yield 'unknown'; } };
      },
      get importedStringConstants() { trace.push('strings'); return null; },
    };
    expect(api.validate(view)).toBe(true);
    const promise = Reflect.apply(Reflect.get(api, 'compile'), null, [view, options]);
    expect(promise).toBeInstanceOf(realm.NativePromise);
    expect(await promise).toBeInstanceOf(Reflect.get(api, 'Module'));
    expect(trace).toEqual(['builtins', 'iterator', 'strings']);
  });

  it('preserves conversion errors through the invoked realm promise', async () => {
    const { api, realm } = fixture();
    const bytes = new Uint8Array(emptyModule);
    await expect(Reflect.apply(Reflect.get(api, 'compile'), null, [bytes, 1])).rejects.toBeInstanceOf(realm.TypeError);
    const marker = new Error('iterator failure');
    const options = { builtins: { [Symbol.iterator]() { throw marker; } } };
    await expect(Reflect.apply(Reflect.get(api, 'compile'), null, [bytes, options])).rejects.toBe(marker);
  });

  it.each(['mutate', 'detach'])('copies bytes after options can %s them', async (action) => {
    const { api, realm } = fixture();
    const bytes = new Uint8Array(emptyModule);
    const options = {
      get builtins() {
        if (action === 'detach') bytes.buffer.transfer();
        else bytes.fill(0);
        return [];
      },
    };
    await expect(api.compile(bytes, options)).rejects.toBeInstanceOf(realm.WebAssemblyCompileError);
  });

  it('delivers duplicate-builtin rejection through the host task', async () => {
    const { api, realm, tasks } = fixture();
    const bytes = new Uint8Array(emptyModule);
    const options = { builtins: ['unknown', 'unknown'] };
    expect(api.validate(bytes, options)).toBe(false);
    const result = api.compile(bytes, options);
    const rejected = expect(result).rejects.toBeInstanceOf(realm.WebAssemblyCompileError);
    expect(tasks.map((task) => task.source)).toEqual(['engine']);
    tasks.shift()!.run();
    await rejected;
  });
});

describe('WebAssembly implementation', () => {
  it('can validate and compile converted values without invoking Web IDL', async () => {
    const { env, realm, api } = fixture();
    const implementation = new WasmImpl(env);
    const bytes = new Uint8Array(emptyModule);
    const options: WebAssemblyCompileOptions = { builtins: [], importedStringConstants: null };
    expect(implementation.validate(bytes, options, env)).toBe(true);
    const result = implementation.compile(bytes, options, env);
    expect(result.backing).toBeInstanceOf(realm.NativePromise);
    expect(await result.backing).toBeInstanceOf(Reflect.get(api, 'Module'));
  });
});

function fixture() {
  const realm = new TestRealm();
  const tasks: (TaskRecord & { source: TaskSourceKey; })[] = [];
  // This host tests the JS namespace without browser Fetch/Response integration.
  const definitions = wasmIDLDefinitions.filter((definition) => definition !== wasmStreamingIDL);
  const world = new BindingWorld<WasmEnvironment & { realm: TestRealm; }>(definitions, {
    // This standalone host has no HTML caller environment to capture.
    getIncumbentEnvironment: () => undefined,
  });
  const binding = world.register(realm, (ctx) => ({
    realm, InternalPromise: ctx.InternalPromise,
    project: (implInst) => ctx.project(implInst.constructor, implInst),
    unwrap: (platformObject) => ctx.unwrap(platformObject),
    runInParallel: (steps) => { queueMicrotask(steps); },
    // This standalone host has no Document or worker destruction lifecycle.
    addDestructionSteps: () => () => {},
    queueTask(source, init) {
      const task = { source, ...init };
      tasks.push(task);
      // This standalone host must deliver the public compilation-resolution task,
      // as well as allowing the rejection test to deliver its queued task manually.
      queueMicrotask(() => {
        const index = tasks.indexOf(task);
        if (index === -1) return;
        tasks.splice(index, 1);
        task.run();
      });
      return {
        remove() {
          const index = tasks.indexOf(task);
          if (index === -1) return;
          tasks.splice(index, 1);
          task.discard?.();
        },
      };
    },
  }));
  const api = world.getRealmBinding(realm)!.installDefinitions().get('WebAssembly') as WebAssemblyAPI;
  return { api, env: binding.getEnvironment(), realm, tasks };
}

// (module)
const emptyModule = [0, 97, 115, 109, 1, 0, 0, 0];
