import { assert, describe, expect, it } from 'vitest';
import { addon, NodeAPI } from '../../src/js-engine/node-addons';
import { createContext, createMicrotaskQueue } from '../../src/js-engine/runtime';
import { isCallable, isObject } from '../../src/js-engine/abstract-operations';
import { itPassesWith } from '../test-runtime';

describe('Node add-on API', () => {
  it('leaves unavailable operations undefined', () => {
    const api = new NodeAPI({ runInContext: (source: string) => source });
    const context = createContext(createMicrotaskQueue());

    assert(api.runInContext);
    expect(api.runInContext('source', context)).toBe('source');
    expect(api.createContextHandle).toBeUndefined();
    expect(api.createHTMLDDA).toBeUndefined();
    expect(api.setPropertyHandlers).toBeUndefined();
    expect(api.isWeakRef).toBeUndefined();
    expect(api.isFinalizationRegistry).toBeUndefined();
    expect(api.supportsHTMLDDA).toBe(false);
  });

  itPassesWith('htmlDDA')('allocates an undetectable callable through the native backend', () => {
    assert(addon.createHTMLDDA);
    const context = createContext(createMicrotaskQueue());
    const result = {};
    const value = addon.createHTMLDDA(context, () => result);
    expect(Boolean(value)).toBe(false);
    expect(typeof value).toBe('undefined');
    expect(value).not.toBe(undefined);
    expect(value()).toBe(result);
    expect(isObject(value)).toBe(true);
    expect(isCallable(value)).toBe(true);
    expect(addon.setPropertyHandlers).toBeTypeOf('function');
  });

  itPassesWith('finalizationRegistryPredicate')('recognizes a registry through the native backend', () => {
    assert(addon.isFinalizationRegistry);
    expect(addon.isFinalizationRegistry(new FinalizationRegistry(() => {}))).toBe(true);
    expect(addon.isFinalizationRegistry({})).toBe(false);
  });

  it('retains the loaded function and its backend receiver', () => {
    const realm = {};
    const backend = {
      realm,
      getRealm(value: object) { return value === this ? this.realm : value; },
    };
    const api = new NodeAPI(backend);
    const getRealm = api.getRealm;
    backend.getRealm = () => ({});

    assert(getRealm);
    expect(api.getRealm).toBe(getRealm);
    expect(getRealm(backend)).toBe(realm);
  });

  it('rejects a supplied operation that is not callable', () => {
    expect(() => new NodeAPI({ getRealm: 42 }))
      .toThrow('Node backend getRealm is not callable');
  });
});
