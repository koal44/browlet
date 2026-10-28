import { describe, expect, it } from 'vitest';

import { JSRealm, createMicrotaskQueue, type CompiledModule } from '../../src/js-engine/index';
import { runInHostTask } from '../support/tasks';

describe('retained engine modules', () => {
  it('reports requests and links without executing source', async () => {
    await runInHostTask(() => {
      const { realm, queue } = fixture();
      const data = realm.createDefaultExportModule('value');
      const root = realm.compileModule('import value from "data" with { type: "text" }; globalThis.ran = true; export { value };', 'root.js');
      expect(realm.getModuleRequests(root)).toEqual([
        { specifier: 'data', attributes: { type: 'text' }, phase: 'evaluation' },
      ]);
      realm.linkModule(root, new Map([[root, [data]]]));
      expect(Reflect.has(realm.globalObject, 'ran')).toBe(false);
      const result = observe(realm, root);
      queue.performMicrotaskCheckpoint();
      expect(result).toEqual({ state: 'fulfilled', value: undefined });
      expect(Reflect.get(realm.getModuleNamespace(root), 'value')).toBe('value');
    });
  });

  it('retains graph cycles and live bindings across repeated evaluation', async () => {
    await runInHostTask(() => {
      const { realm, queue } = fixture();
      const first = realm.compileModule('import { read } from "b"; export let count = 1; export function bump() { count++; } export { read };', 'a.js');
      const second = realm.compileModule('import { count } from "a"; export function read() { return count; }', 'b.js');
      realm.linkModule(first, new Map([[first, [second]], [second, [first]]]));
      const result = observe(realm, first);
      queue.performMicrotaskCheckpoint();
      expect(result.state).toBe('fulfilled');
      const namespace = realm.getModuleNamespace(first) as { count: number; read(): number; bump(): void; };
      expect(namespace.read()).toBe(1);
      namespace.bump();
      realm.linkModule(first, new Map([[first, [second]], [second, [first]]]));
      observe(realm, first);
      queue.performMicrotaskCheckpoint();
      expect(namespace.count).toBe(2);
      expect(namespace.read()).toBe(2);
    });
  });

  it('keeps pending top-level await pending until its dependency settles', async () => {
    await runInHostTask(() => {
      const { realm, queue } = fixture();
      const gate = realm.NativePromise.withResolvers<void>();
      Reflect.set(realm.globalObject, 'gate', gate.promise);
      const root = realm.compileModule('await gate; export const value = {};', 'await.js');
      realm.linkModule(root, new Map());
      const result = observe(realm, root);
      queue.performMicrotaskCheckpoint();
      expect(result.state).toBe('pending');
      gate.resolve();
      queue.performMicrotaskCheckpoint();
      expect(result.state).toBe('fulfilled');
      expect(Object.getPrototypeOf(Reflect.get(realm.getModuleNamespace(root), 'value'))).toBe(realm.objectPrototype);
    });
  });

  it('preserves an abrupt completion instead of throwing it synchronously', async () => {
    await runInHostTask(() => {
      const { realm, queue } = fixture();
      const reason = {};
      Reflect.set(realm.globalObject, 'reason', reason);
      const root = realm.compileModule('await 0; throw reason;', 'rejected.js');
      realm.linkModule(root, new Map());
      const result = observe(realm, root);
      queue.performMicrotaskCheckpoint();
      expect(result).toEqual({ state: 'rejected', value: reason });
    });
  });

  it('exports a thenable without reading or awaiting it', async () => {
    await runInHostTask(() => {
      const { realm, queue } = fixture();
      const value = { get then(): never { throw new Error('The default export is not a completion Promise'); } };
      const module = realm.createDefaultExportModule(value);
      realm.linkModule(module, new Map());
      const result = observe(realm, module);
      queue.performMicrotaskCheckpoint();
      expect(result.state).toBe('fulfilled');
      expect(Reflect.get(realm.getModuleNamespace(module), 'default')).toBe(value);
    });
  });

  it('rejects linking a dependency from another realm', () => {
    const { realm } = fixture();
    const foreign = fixture().realm;
    const root = realm.compileModule('import "foreign";', 'root.js');
    const dependency = foreign.compileModule('', 'foreign.js');
    expect(() => realm.linkModule(root, new Map([[root, [dependency]]]))).toThrow();
  });

  it('reports missing exports synchronously during linking', () => {
    const { realm } = fixture();
    const root = realm.compileModule('import { missing } from "data";', 'root.js');
    const data = realm.createDefaultExportModule(42);
    expect(() => realm.linkModule(root, new Map([[root, [data]]]))).toThrow(/missing/u);
  });
});

function fixture() {
  const queue = createMicrotaskQueue();
  return { realm: new JSRealm(queue), queue };
}

function observe(realm: JSRealm, module: CompiledModule) {
  const result: { state: string; value?: unknown; } = { state: 'pending' };
  realm.observePromise(realm.evaluateModule(module), (value) => {
    result.state = 'fulfilled';
    result.value = value;
  }, (value) => {
    result.state = 'rejected';
    result.value = value;
  });
  return result;
}
