import { describe, expect, it } from 'vitest';

import { convertJSONDerivedValueToInfra, type JSONValue } from '../../src/infra/json';

describe('convert JSON-derived JavaScript values to Infra', () => {
  it('preserves primitive values while converting nested objects and arrays', () => {
    const value = JSON.parse('{"list":[null,true,"text",-0,1e400,{"nested":false}]}') as JSONValue;
    expect(convertJSONDerivedValueToInfra(value)).toEqual(new Map([
      ['list', [null, true, 'text', -0, Infinity, new Map([['nested', false]])]],
    ]));
  });

  it('uses JSON object own-key ordering and keeps prototype-like names as data', () => {
    const value = JSON.parse('{"z":0,"2":2,"1":1,"__proto__":{"safe":true},"z":3,"constructor":4}') as JSONValue;
    expect(convertJSONDerivedValueToInfra(value)).toEqual(new Map<string, unknown>([
      ['1', 1], ['2', 2], ['z', 3], ['__proto__', new Map([['safe', true]])], ['constructor', 4],
    ]));
  });
});
