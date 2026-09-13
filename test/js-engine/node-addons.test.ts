import { describe, expect, it } from 'vitest';
import { NodeAPI } from '../../src/js-engine/node-addons';

describe('Node add-on API', () => {
  it('keeps availability per operation and throws when an absent operation is called', () => {
    const api = new NodeAPI({ runInContext: (source: string) => source });

    expect(api.getMethod('runInContext')).toBe(api.runInContext);
    expect(api.runInContext('source', {})).toBe('source');
    expect(api.getMethod('createContextHandle')).toBeUndefined();
    expect(() => api.createContextHandle())
      .toThrow('Node backend does not provide createContextHandle');
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
