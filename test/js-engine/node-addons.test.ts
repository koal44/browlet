import { describe, expect, it } from 'vitest';
import { addon, NodeAPI } from '../../src/js-engine/node-addons';
import { createContext, createMicrotaskQueue } from '../../src/js-engine/runtime';
import { isCallable, isObject } from '../../src/js-engine/abstract-operations';
import { itPassesWith } from '../test-runtime';

describe('Node add-on API', () => {
  it('keeps availability per operation and throws when an absent operation is called', () => {
    const api = new NodeAPI({ runInContext: (source: string) => source });
    const context = createContext(createMicrotaskQueue());

    expect(api.getMethod('runInContext')).toBe(api.runInContext);
    expect(api.runInContext('source', context)).toBe('source');
    expect(api.getMethod('createContextHandle')).toBeUndefined();
    expect(() => api.createContextHandle())
      .toThrow('Node backend does not provide createContextHandle');
    expect(api.getMethod('createHTMLDDA')).toBeUndefined();
    expect(() => api.createHTMLDDA(context, () => null))
      .toThrow('Node backend does not provide createHTMLDDA');
    expect(api.getMethod('setPropertyHandlers')).toBeUndefined();
    expect(api.getMethod('isWeakRef')).toBeUndefined();
    expect(() => api.isWeakRef({}))
      .toThrow('Node backend does not provide isWeakRef');
  });

  itPassesWith('htmlDDA')('allocates an undetectable callable through the native backend', () => {
    const context = createContext(createMicrotaskQueue());
    const result = {};
    const value = addon.createHTMLDDA(context, () => result);
    expect(Boolean(value)).toBe(false);
    expect(typeof value).toBe('undefined');
    expect(value).not.toBe(undefined);
    expect(value()).toBe(result);
    expect(isObject(value)).toBe(true);
    expect(isCallable(value)).toBe(true);
    expect(addon.getMethod('setPropertyHandlers')).toBeTypeOf('function');
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

    expect(api.getMethod('getRealm')).toBe(getRealm);
    expect(getRealm(backend)).toBe(realm);
  });

  it('rejects a supplied operation that is not callable', () => {
    expect(() => new NodeAPI({ getRealm: 42 }))
      .toThrow('Node backend getRealm is not callable');
  });
});
