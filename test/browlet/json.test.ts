import { describe, expect, it } from 'vitest';

import type { InfraValue } from '../../src/infra/json';
import { utf8Encode } from '../../src/encoding/index';
import { createSandboxEnvironment } from '../../src/browlet/bindings';

describe('Infra §6: JSON bytes', () => {
  it('parses with the supplied realm\'s captured JSON.parse and allocation prototypes', () => {
    const env = createSandboxEnvironment();
    env.realm.evaluate('JSON.parse = () => { throw new Error("replacement parser"); };', 'json-test.js');
    const input = utf8Encode('{"items":[{"key":1}]}');
    const value = env.parseJSONBytes(input) as { items: object[]; };
    expect(Object.getPrototypeOf(value)).toBe(env.realm.intrinsics.objectPrototype);
    expect(Object.getPrototypeOf(value.items)).toBe(env.realm.intrinsics.array.prototype);
    expect(Object.getPrototypeOf(value.items[0])).toBe(env.realm.intrinsics.objectPrototype);
    expect(env.parseJSONBytesToInfra(input)).toEqual(new Map([
      ['items', [new Map([['key', 1]])]],
    ]));
  });

  it('decodes only the supplied byte view, removes one BOM, and replaces malformed UTF-8', () => {
    const env = createSandboxEnvironment();
    const bytes = Uint8Array.of(0xff, 0xef, 0xbb, 0xbf, 0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 0xff);
    const input = bytes.subarray(1, -1);
    expect(env.parseJSONBytes(input)).toEqual({ x: '\ufffd' });
    expect(env.parseJSONBytesToInfra(input)).toEqual(new Map([['x', '\ufffd']]));
    const doubleBOM = Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x30);
    for (const method of ['parseJSONBytes', 'parseJSONBytesToInfra'] as const) {
      expect(() => env[method](doubleBOM)).toThrow(env.realm.intrinsics.syntaxError);
      expect(() => env[method](new Uint8Array())).toThrow(env.realm.intrinsics.syntaxError);
    }
  });

  it.each([undefined, Symbol('value'), () => {}, { toJSON: () => undefined }])(
    'throws the supplied realm\'s TypeError for a value without JSON representation', (value) => {
      const env = createSandboxEnvironment();
      expect(() => env.serializeJavaScriptValueToJSONBytes(value)).toThrow(env.exec.TypeError);
    },
  );

  it('encodes UTF-8 without a BOM using captured serialization and JSON surrogate escaping', () => {
    const env = createSandboxEnvironment();
    env.realm.evaluate('JSON.stringify = () => "replacement serializer";', 'json-test.js');
    expect(env.serializeJavaScriptValueToJSONBytes('é😀'))
      .toEqual(Uint8Array.of(0x22, 0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80, 0x22));
    expect(env.serializeJavaScriptValueToJSONBytes('\ud800'))
      .toEqual(Uint8Array.of(0x22, 0x5c, 0x75, 0x64, 0x38, 0x30, 0x30, 0x22));
  });

  it('round-trips Infra data with JavaScript own-key order and JSON numeric rules', () => {
    const env = createSandboxEnvironment();
    const value = new Map<string, InfraValue>([
      ['z', [-0, NaN, Infinity, -Infinity]], ['2', true], ['1', null], ['a', 'é😀'],
    ]);
    expect(env.parseJSONBytesToInfra(env.serializeInfraValueToJSONBytes(value)))
      .toEqual(new Map<string, InfraValue>([
        ['1', null], ['2', true], ['z', [0, null, null, null]], ['a', 'é😀'],
      ]));
  });

  it('serializes Infra values with the supplied realm\'s captured JSON.stringify', () => {
    const env = createSandboxEnvironment();
    env.realm.evaluate('JSON.stringify = () => "replacement serializer";', 'json-test.js');
    expect(env.serializeInfraValueToJSONBytes(new Map([['x', 1]])))
      .toEqual(Uint8Array.of(0x7b, 0x22, 0x78, 0x22, 0x3a, 0x31, 0x7d));
  });
});
