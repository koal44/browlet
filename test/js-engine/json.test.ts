import { describe, expect, it } from 'vitest';

import type { InfraValue } from '../../src/infra/json';
import { getAssociatedRealm, JSRealm } from '../../src/js-engine/index';

describe('Infra §6: parse JSON', () => {
  it('allocates nested JavaScript objects and arrays in the supplied realm', () => {
    const realm = new JSRealm();
    const value = realm.parseJSON('{"items":[{"key":1}]}') as { items: object[]; };
    expect(Object.getPrototypeOf(value)).toBe(realm.objectPrototype);
    expect(Object.getPrototypeOf(value.items)).toBe(realm.Array.prototype);
    expect(Object.getPrototypeOf(value.items[0])).toBe(realm.objectPrototype);
  });

  it.each(['null', 'true', 'false', '"text"', '-0', '1e400'])(
    'preserves primitive JSON %s in both representations', (input) => {
      const realm = new JSRealm();
      expect(realm.parseJSON(input)).toBe(JSON.parse(input));
      expect(realm.parseJSONStringToInfra(input)).toBe(JSON.parse(input));
    },
  );

  it('parses into ordered maps and lists without consulting an author array iterator', () => {
    const realm = new JSRealm();
    realm.evaluate('Array.prototype[Symbol.iterator] = () => { throw new Error("author iterator"); };', 'json-test.js');
    expect(realm.parseJSONStringToInfra('{"items":[1,{"x":2}]}')).toEqual(new Map([
      ['items', [1, new Map([['x', 2]])]],
    ]));
  });

  it('uses captured JSON.parse and retains the realm of its SyntaxError', () => {
    const realm = new JSRealm();
    realm.evaluate('JSON.parse = () => { throw new Error("replacement parser"); };', 'json-test.js');
    expect(realm.parseJSON('42')).toBe(42);
    expect(realm.parseJSONStringToInfra('{"x":1}')).toEqual(new Map([['x', 1]]));
    for (const method of ['parseJSON', 'parseJSONStringToInfra'] as const) {
      expect(() => realm[method]('{')).toThrow(realm.SyntaxError);
      // String input does not perform the byte algorithm's BOM removal.
      expect(() => realm[method]('\ufeffnull')).toThrow(realm.SyntaxError);
    }
  });
});

describe('Infra §6: serialize JavaScript values', () => {
  it('uses captured JSON.stringify without a replacer or spacing', () => {
    const realm = new JSRealm();
    realm.evaluate('JSON.stringify = () => "replacement serializer";', 'json-test.js');
    expect(realm.serializeJavaScriptValueToJSONString({ x: [1, null, true] })).toBe('{"x":[1,null,true]}');
    expect(realm.serializeJavaScriptValueToJSONString({ toJSON: () => 'converted' })).toBe('"converted"');
    expect(realm.serializeJavaScriptValueToJSONString({ x: undefined, y: [undefined], z: Infinity }))
      .toBe('{"y":[null],"z":null}');
  });

  it.each([undefined, Symbol('value'), () => {}, { toJSON: () => undefined }])(
    'throws the supplied realm\'s TypeError for a value without JSON representation', (value) => {
      const realm = new JSRealm();
      expect(() => realm.serializeJavaScriptValueToJSONString(value)).toThrow(realm.TypeError);
    },
  );

  it('preserves intrinsic serialization errors and author-thrown exceptions', () => {
    const realm = new JSRealm();
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => realm.serializeJavaScriptValueToJSONString(cyclic)).toThrow(realm.TypeError);
    expect(() => realm.serializeJavaScriptValueToJSONString(1n)).toThrow(realm.TypeError);
    const error: unknown = { message: 'author failure' };
    for (const value of [{ get x() { throw error; } }, { toJSON() { throw error; } }]) {
      let caught: unknown;
      try { realm.serializeJavaScriptValueToJSONString(value); } catch (exception) { caught = exception; }
      expect(caught).toBe(error);
    }
  });

  it('preserves JSON escaping of lone surrogates', () => {
    const realm = new JSRealm();
    expect(realm.serializeJavaScriptValueToJSONString('\ud800')).toBe('"\\ud800"');
  });
});

describe('Infra §6: convert and serialize Infra values', () => {
  it('creates target-realm arrays and null-prototype objects, including prototype-like map keys', () => {
    const realm = new JSRealm();
    const value = new Map<string, InfraValue>([
      ['__proto__', new Map([['nested', true]])], ['constructor', [1, null]],
    ]);
    const converted = realm.convertInfraValueToJavaScript(value) as { __proto__: object; constructor: unknown[]; };
    expect(Object.getPrototypeOf(converted)).toBeNull();
    expect(Object.getPrototypeOf(converted.__proto__)).toBeNull();
    expect(Object.getPrototypeOf(converted.constructor)).toBe(realm.Array.prototype);
    expect(getAssociatedRealm(converted)).toBe(realm);
    expect(getAssociatedRealm(converted.__proto__)).toBe(realm);
    expect(getAssociatedRealm(converted.constructor)).toBe(realm);
    expect(Object.getOwnPropertyDescriptor(converted, '__proto__')).toEqual({
      value: converted.__proto__, writable: true, enumerable: true, configurable: true,
    });
    expect(realm.serializeInfraValueToJSONString(value)).toBe('{"__proto__":{"nested":true},"constructor":[1,null]}');
  });

  it('defines array data properties without invoking inherited setters', () => {
    const realm = new JSRealm();
    realm.evaluate('Object.defineProperty(Array.prototype, "0", { set() { throw new Error("author setter"); } });', 'json-test.js');
    const converted = realm.convertInfraValueToJavaScript([new Map([['x', 1]])]) as unknown[];
    expect(converted).toHaveLength(1);
    expect(Object.getOwnPropertyDescriptor(converted, '0')).toEqual({
      value: converted[0], writable: true, enumerable: true, configurable: true,
    });
    expect(converted[0]).toEqual({ x: 1 });
  });

  it('serializes map keys in JavaScript own-key order and keeps JSON numeric rules', () => {
    const realm = new JSRealm();
    const value = new Map<string, InfraValue>([
      ['z', [-0, NaN, Infinity, -Infinity]], ['2', true], ['1', null], ['a', 'é😀'],
    ]);
    const expected = '{"1":null,"2":true,"z":[0,null,null,null],"a":"é😀"}';
    expect(realm.serializeInfraValueToJSONString(value)).toBe(expected);
  });

  it('uses captured serialization and preserves ordinary primitive inputs', () => {
    const realm = new JSRealm();
    realm.evaluate('JSON.stringify = () => "replacement serializer";', 'json-test.js');
    for (const value of [null, true, false, 'text', -0, Infinity]) {
      expect(realm.convertInfraValueToJavaScript(value)).toBe(value);
      expect(realm.serializeInfraValueToJSONString(value)).toBe(JSON.stringify(value));
    }
  });
});
