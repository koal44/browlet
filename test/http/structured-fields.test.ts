import { describe, expect, it } from 'vitest';

import {
  parseStructuredField, serializeStructuredField, type StructuredBareItem, type StructuredDictionary,
  type StructuredField, type StructuredInnerList, type StructuredItem, type StructuredParameters,
} from '../../src/http/structured-fields';

describe('RFC 9651 §4.2: parsing structured fields', () => {
  it.each([
    ['1', { type: 'integer', value: 1 }],
    ['1.0', { type: 'decimal', value: 1 }],
    ['"foo"', { type: 'string', value: 'foo' }],
    ['foo', { type: 'token', value: 'foo' }],
    ['%"foo"', { type: 'display-string', value: 'foo' }],
    [':Zg==:', { type: 'bytes', value: new Uint8Array([102]) }],
    ['?1', { type: 'boolean', value: true }],
    ['?0', { type: 'boolean', value: false }],
    ['@1', { type: 'date', value: 1 }],
  ] satisfies [string, StructuredBareItem][])('retains the type of %s', (source, expected) => {
    expect(parseStructuredField(bytes(source), 'item')).toEqual(item(expected));
  });

  it('uses the requested top-level type', () => {
    expect(parseStructuredField(bytes('foo'), 'item'))
      .toEqual(item({ type: 'token', value: 'foo' }));
    expect(parseStructuredField(bytes('foo'), 'list')).toEqual({
      type: 'list', members: [item({ type: 'token', value: 'foo' })],
    });
    expect(parseStructuredField(bytes('foo'), 'dictionary')).toEqual({
      type: 'dictionary', members: new Map([['foo', item({ type: 'boolean', value: true })]]),
    });
  });

  it.each(['', '   '])('accepts empty containers, but not an empty Item: %j', (source) => {
    expect(parseStructuredField(bytes(source), 'list')).toEqual({ type: 'list', members: [] });
    expect(parseStructuredField(bytes(source), 'dictionary'))
      .toEqual({ type: 'dictionary', members: new Map() });
    expect(parseStructuredField(bytes(source), 'item')).toBeNull();
  });

  it('retains item and inner-list parameters separately', () => {
    expect(parseStructuredField(bytes(' (1;a "foo";b=?0);level=2, ();empty '), 'list')).toEqual({
      type: 'list',
      members: [
        {
          type: 'inner-list',
          items: [
            item({ type: 'integer', value: 1 }, new Map([['a', { type: 'boolean', value: true }]])),
            item({ type: 'string', value: 'foo' }, new Map([['b', { type: 'boolean', value: false }]])),
          ],
          parameters: new Map([['level', { type: 'integer', value: 2 }]]),
        },
        { type: 'inner-list', items: [], parameters: new Map([['empty', { type: 'boolean', value: true }]]) },
      ],
    });
  });

  it('overwrites duplicate dictionary keys without moving their position', () => {
    expect(parseStructuredField(bytes('z=1;old, a, z=(2);new'), 'dictionary')).toEqual({
      type: 'dictionary',
      members: new Map<string, StructuredItem | StructuredInnerList>([
        ['z', {
          type: 'inner-list', items: [item({ type: 'integer', value: 2 })],
          parameters: new Map([['new', { type: 'boolean', value: true }]]),
        }],
        ['a', item({ type: 'boolean', value: true })],
      ]),
    });
  });

  it('overwrites duplicate parameters without moving their position', () => {
    expect(parseStructuredField(bytes('foo;z=1; a=2;z=?0'), 'item')).toEqual(item(
      { type: 'token', value: 'foo' },
      new Map<string, StructuredBareItem>([
        ['z', { type: 'boolean', value: false }],
        ['a', { type: 'integer', value: 2 }],
      ]),
    ));
  });

  it('allows tabs around list/dictionary commas, but not at the field start', () => {
    expect(parseStructuredField(bytes('  a \t,\tb\t '), 'list')).toEqual({
      type: 'list', members: [item({ type: 'token', value: 'a' }), item({ type: 'token', value: 'b' })],
    });
    expect(parseStructuredField(bytes('  a=1\t, \tb\t'), 'dictionary')?.members.size).toBe(2);
    expect(parseStructuredField(bytes('  1  '), 'item')).toEqual(item({ type: 'integer', value: 1 }));
    for (const type of ['item', 'list', 'dictionary'] as const) {
      expect(parseStructuredField(bytes('\ta'), type)).toBeNull();
      expect(parseStructuredField(bytes(' \t'), type)).toBeNull();
    }
  });

  it.each([
    ['1\t', 'item'], ['1 ;a', 'item'], ['1;\ta', 'item'],
    ['a =1', 'dictionary'], ['a= 1', 'dictionary'],
    ['1;a =2', 'item'], ['1;a= 2', 'item'],
    ['(1\t2)', 'list'], ['(\t)', 'list'], ['((1))', 'list'],
    ['a,', 'list'], ['a, \t', 'dictionary'], [',a', 'list'],
    ['a,,b', 'list'], ['a,b=???', 'dictionary'], ['a\r\n,b', 'list'],
    ['"foo"junk', 'item'], ['1.2.3', 'item'], ['?10', 'item'],
    ['1,2', 'item'], ['a;=1', 'dictionary'], ['a;A', 'item'],
    ['a/1', 'dictionary'], ['a;', 'list'], ['"unterminated', 'list'],
  ] as const)('rejects the complete %s field as %s', (source, type) => {
    expect(parseStructuredField(bytes(source), type)).toBeNull();
  });

  it('rejects non-ASCII input bytes before parsing any field', () => {
    for (const type of ['item', 'list', 'dictionary'] as const) {
      expect(parseStructuredField(new Uint8Array([0x61, 0xff]), type)).toBeNull();
      expect(parseStructuredField(bytes('%"é"'), type)).toBeNull();
    }
  });

  it('reads only the supplied byte view and creates independent results', () => {
    const input = new Uint8Array([0xff, 0x31, 0xff]);
    const field = parseStructuredField(input.subarray(1, 2), 'item')!;
    field.parameters.set('later', { type: 'boolean', value: true });
    expect(parseStructuredField(input.subarray(1, 2), 'item'))
      .toEqual(item({ type: 'integer', value: 1 }));
    expect([...input]).toEqual([0xff, 0x31, 0xff]);
  });
});

describe('RFC 9651 §4.1: serializing structured fields', () => {
  it.each([
    [{ type: 'integer', value: 1 }, '1'],
    [{ type: 'decimal', value: 1 }, '1.0'],
    [{ type: 'string', value: 'example' }, '"example"'],
    [{ type: 'token', value: 'example' }, 'example'],
    [{ type: 'display-string', value: 'example' }, '%"example"'],
    [{ type: 'bytes', value: new Uint8Array([102]) }, ':Zg==:'],
    [{ type: 'boolean', value: true }, '?1'],
    [{ type: 'boolean', value: false }, '?0'],
    [{ type: 'date', value: 1 }, '@1'],
  ] satisfies [StructuredBareItem, string][])('preserves the %j type', (value, expected) => {
    expect(serializeStructuredField(item(value))).toBe(expected);
  });

  it('distinguishes omitted fields from empty item values and inner lists', () => {
    expect(serializeStructuredField({ type: 'list', members: [] }))
      .toBeUndefined();
    expect(serializeStructuredField({ type: 'dictionary', members: new Map() }))
      .toBeUndefined();
    expect(serializeStructuredField(item({ type: 'string', value: '' })))
      .toBe('""');
    expect(serializeStructuredField(item({ type: 'bytes', value: new Uint8Array() })))
      .toBe('::');
    expect(serializeStructuredField(item({ type: 'display-string', value: '' })))
      .toBe('%""');
    expect(serializeStructuredField({
      type: 'list',
      members: [{ type: 'inner-list', items: [], parameters: new Map() }],
    })).toBe('()');
  });

  it('serializes both levels of parameters on inner lists', () => {
    expect(serializeStructuredField({
      type: 'list',
      members: [
        {
          type: 'inner-list',
          items: [item({ type: 'string', value: 'foo' }, new Map([
            ['a', { type: 'integer', value: 1 }],
            ['b', { type: 'integer', value: 2 }],
          ]))],
          parameters: new Map([['lvl', { type: 'integer', value: 5 }]]),
        },
        {
          type: 'inner-list',
          items: [
            item({ type: 'string', value: 'bar' }),
            item({ type: 'string', value: 'baz' }),
          ],
          parameters: new Map([['lvl', { type: 'integer', value: 1 }]]),
        },
      ],
    })).toBe('("foo";a=1;b=2);lvl=5, ("bar" "baz");lvl=1');
  });

  it('preserves dictionary and parameter order and omits only true values', () => {
    const field: StructuredDictionary = {
      type: 'dictionary',
      members: new Map<string, StructuredItem>([
        ['z', item({ type: 'boolean', value: false })],
        ['a', item({ type: 'boolean', value: true }, new Map<string, StructuredBareItem>([
          ['b', { type: 'boolean', value: true }],
          ['a', { type: 'boolean', value: false }],
          ['c', { type: 'integer', value: 1 }],
        ]))],
        ['one', item({ type: 'integer', value: 1 })],
      ]),
    };
    const before = structuredClone(field);
    expect(serializeStructuredField(field)).toBe('z=?0, a;b;a=?0;c=1, one=1');
    expect(field).toEqual(before);
  });

  it('serializes dictionary members that are inner lists', () => {
    expect(serializeStructuredField({
      type: 'dictionary',
      members: new Map([
        ['feelings', {
          type: 'inner-list',
          items: [item({ type: 'token', value: 'joy' }), item({ type: 'token', value: 'sadness' })],
          parameters: new Map([['valid', { type: 'boolean', value: true }]]),
        }],
      ]),
    })).toBe('feelings=(joy sadness);valid');
  });

  it.each(['', 'A', '0a', 'a b', 'a\n', 'a\r', 'a\t', 'é'])(
    'rejects the invalid dictionary/parameter key %j', (key) => {
      const member = item({ type: 'boolean', value: true });
      expect(serializeStructuredField({
        type: 'dictionary', members: new Map([[key, member]]),
      })).toBeNull();
      expect(serializeStructuredField(item(
        { type: 'integer', value: 1 },
        new Map([[key, { type: 'boolean', value: true }]]),
      ))).toBeNull();
    });

  it('accepts the key alphabet without normalizing it', () => {
    expect(serializeStructuredField({
      type: 'dictionary',
      members: new Map([['*a0._-', item({ type: 'token', value: '*Foo:/!#$%&\'*+-.^_`|~012' })]]),
    })).toBe('*a0._-=*Foo:/!#$%&\'*+-.^_`|~012');
  });

  it.each([
    { type: 'list', members: [item({ type: 'integer', value: 1 }), item({ type: 'string', value: '\n' })] },
    { type: 'dictionary', members: new Map([['bad', item({ type: 'string', value: '\n' })]]) },
    { type: 'list', members: [{ type: 'inner-list', items: [item({ type: 'token', value: 'bad token' })], parameters: new Map() }] },
    item({ type: 'integer', value: 1 }, new Map([['bad', { type: 'integer', value: Infinity }]])),
    { type: 'list', members: [{ type: 'inner-list', items: [], parameters: new Map([['Bad', { type: 'boolean', value: true }]]) }] },
  ] satisfies StructuredField[])('fails the whole field for an invalid nested value: %j', (field) => {
    expect(serializeStructuredField(field)).toBeNull();
  });
});

describe('RFC 9651 §4.2.4 and §4.2.9: numbers and dates', () => {
  it.each([
    ['-0', { type: 'integer', value: 0 }], ['-0.0', { type: 'decimal', value: 0 }],
    ['0001', { type: 'integer', value: 1 }], ['0001.000', { type: 'decimal', value: 1 }],
    ['0.001', { type: 'decimal', value: 0.001 }],
    ['999999999999999', { type: 'integer', value: 999_999_999_999_999 }],
    ['-999999999999999', { type: 'integer', value: -999_999_999_999_999 }],
    ['999999999999.999', { type: 'decimal', value: 999_999_999_999.999 }],
    ['-999999999999.999', { type: 'decimal', value: -999_999_999_999.999 }],
    ['@-62135596800', { type: 'date', value: -62_135_596_800 }],
    ['@253402214400', { type: 'date', value: 253_402_214_400 }],
    ['@999999999999999', { type: 'date', value: 999_999_999_999_999 }],
    ['@-999999999999999', { type: 'date', value: -999_999_999_999_999 }],
    ['@-0', { type: 'date', value: 0 }],
  ] satisfies [string, StructuredBareItem][])('parses %s as %j', (source, expected) => {
    expect(parseStructuredField(bytes(source), 'item')).toEqual(item(expected));
  });

  it.each([
    '-', '- 1', '--1', '+1', '.1', '1.', '1.0000', '1e3', '1E3',
    '1000000000000000', '-1000000000000000', '0000000000000000',
    '1000000000000.0', '0000000000000.1', '-999999999999.9999',
    '@', '@1.0', '@.1', '@1000000000000000', '@0000000000000000',
  ])('rejects invalid numeric syntax or excessive digits: %s', (source) => {
    expect(parseStructuredField(bytes(source), 'item')).toBeNull();
  });
});

describe('RFC 9651 §4.1.4–§4.1.5 and §4.1.10: numbers and dates', () => {
  it.each([
    [0, '0'], [-0, '0'], [42, '42'],
    [999_999_999_999_999, '999999999999999'],
    [-999_999_999_999_999, '-999999999999999'],
    [-62_135_596_800, '-62135596800'], [253_402_214_400, '253402214400'],
  ])('serializes integer/epoch seconds %s', (value, expected) => {
    expect(serializeStructuredField(item({ type: 'integer', value }))).toBe(expected);
    expect(serializeStructuredField(item({ type: 'date', value }))).toBe(`@${expected}`);
  });

  it.each([1e15, -1e15, 0.1, NaN, Infinity, -Infinity])('rejects invalid integer/epoch seconds %s', (value) => {
    expect(serializeStructuredField(item({ type: 'integer', value }))).toBeNull();
    expect(serializeStructuredField(item({ type: 'date', value }))).toBeNull();
  });

  it.each([
    [0, '0.0'], [-0, '0.0'], [1, '1.0'], [5.23, '5.23'], [-0.4, '-0.4'],
    [0.0015, '0.002'], [0.0025, '0.002'], [-0.0015, '-0.002'], [-0.0025, '-0.002'],
    [0.0005, '0.0'], [-0.0005, '0.0'], [Number.MIN_VALUE, '0.0'], [-1e-7, '0.0'],
    [9.9995, '10.0'], [-9.9995, '-10.0'], [0.5015, '0.502'],
    [1.23449, '1.234'], [1.2345, '1.234'], [1.2345000000000002, '1.235'],
    [999_999_999_999.999, '999999999999.999'], [-999_999_999_999.999, '-999999999999.999'],
  ])('serializes decimal %s as %s', (value, expected) => {
    const field = item({ type: 'decimal', value });
    expect(serializeStructuredField(field)).toBe(expected);
    expect(field.bareItem.value).toBe(value);
  });

  it.each([1e12, -1e12, 999_999_999_999.9999, -999_999_999_999.9999, NaN, Infinity, -Infinity])(
    'rejects decimal overflow or a non-finite value %s', (value) => {
      expect(serializeStructuredField(item({ type: 'decimal', value }))).toBeNull();
    });
});

describe('RFC 9651 §4.2.5–§4.2.7 and §4.2.10: text and bytes', () => {
  it('unescapes only quotes and backslashes in strings', () => {
    expect(parseStructuredField(bytes('"a \\"quote\\" and \\\\ !~"'), 'item'))
      .toEqual(item({ type: 'string', value: 'a "quote" and \\ !~' }));
  });

  it.each(['"\\a"', '"\\n"', '"\\', '"\t"', '"\n"', '"\x7f"'])('rejects invalid string %j', (source) => {
    expect(parseStructuredField(bytes(source), 'item')).toBeNull();
  });

  it('accepts the token alphabet without changing case', () => {
    const value = '*Foo:/!#$%&\'*+-.^_`|~012';
    expect(parseStructuredField(bytes(value), 'item')).toEqual(item({ type: 'token', value }));
  });

  it.each([
    ['::', []], [':Zg==:', [102]], [':Zg:', [102]], [':Zm8:', [102, 111]],
    [':YR==:', [97]], [':/+Ah:', [255, 224, 33]],
  ] as const)('decodes base64 %s, including missing padding and nonzero pad bits', (source, expected) => {
    expect(parseStructuredField(bytes(source), 'item'))
      .toEqual(item({ type: 'bytes', value: Uint8Array.from(expected) }));
  });

  it.each([':', ':Zg', ':Z g==:', ':Zg==\n:', ':_-Ah:', ':=Zg=:', ':Z=g=:', ':Zg===:', ':A:'])(
    'rejects malformed base64 %j', (source) => {
      expect(parseStructuredField(bytes(source), 'item')).toBeNull();
    });

  it.each([
    ['%""', ''], ['%"%61"', 'a'], ['%"%25%22\\%00%0a%7f"', '%"\\\0\n\x7f'],
    ['%"%f0%9f%98%80"', '😀'], ['%"%ef%bb%bfe%cc%81"', '\ufeffe\u0301'],
    ['%"%ef%bf%bf"', '\uffff'],
  ])('strictly UTF-8 decodes %s without stripping BOM or normalizing', (source, expected) => {
    expect(parseStructuredField(bytes(source), 'item')).toEqual(item({ type: 'display-string', value: expected }));
  });

  it.each([
    '%', '%foo', '%"%', '%"%"', '%"%a"', '%"%gg"', '%"%FF"',
    '%"%c3"', '%"%ff"', '%"%80"', '%"%c0%80"', '%"%e0%80%80"',
    '%"%ed%a0%80"', '%"%f4%90%80%80"', '%"\n"', '%"\x7f"', '%"a\\"b"',
  ])('rejects malformed escapes, controls, or invalid UTF-8 in %j', (source) => {
    expect(parseStructuredField(bytes(source), 'item')).toBeNull();
  });
});

describe('RFC 9651 §4.1.6–§4.1.8 and §4.1.11: text and bytes', () => {
  it('escapes only quotes and backslashes in an ASCII string', () => {
    expect(serializeStructuredField(item({ type: 'string', value: 'a "quote" and \\ !~' })))
      .toBe('"a \\"quote\\" and \\\\ !~"');
  });

  it.each(['\0', '\t', '\n', '\r', '\x7f', 'é', '😀'])('rejects non-printable/non-ASCII string %j', (value) => {
    expect(serializeStructuredField(item({ type: 'string', value }))).toBeNull();
  });

  it.each(['', '1token', 'a b', 'a\n', 'a\r', 'a\t', 'é', 'foo,bar', 'foo;bar', 'foo=bar'])(
    'rejects invalid token %j', (value) => {
      expect(serializeStructuredField(item({ type: 'token', value }))).toBeNull();
    });

  it('uses padded base64 with zero pad bits and only the supplied byte view', () => {
    const bytes = new Uint8Array([0, 102, 111, 111, 255]);
    const outputs = [':Zg==:', ':Zm8=:', ':Zm9v:'];
    for (let length = 1; length <= 3; length++) {
      expect(serializeStructuredField(item({ type: 'bytes', value: bytes.subarray(1, 1 + length) })))
        .toBe(outputs[length - 1]);
    }
    expect([...bytes]).toEqual([0, 102, 111, 111, 255]);
  });

  it.each([
    ['This is intended for display to üsers.', '%"This is intended for display to %c3%bcsers."'],
    ['%"\\\0\n\x7f', '%"%25%22\\%00%0a%7f"'],
    ['😀', '%"%f0%9f%98%80"'],
    ['\ufeffe\u0301', '%"%ef%bb%bfe%cc%81"'],
  ])('UTF-8 encodes display string %j without Unicode normalization', (value, expected) => {
    expect(serializeStructuredField(item({ type: 'display-string', value }))).toBe(expected);
  });

  it.each(['\ud800', '\udfff', '\ud800a', 'a\udfff', '\udfff\ud800'])(
    'fails instead of replacing unpaired surrogates in %j', (value) => {
      expect(serializeStructuredField(item({ type: 'display-string', value }))).toBeNull();
    });
});

function item(
  bareItem: StructuredBareItem, parameters: StructuredParameters = new Map(),
): StructuredItem {
  return { type: 'item', bareItem, parameters };
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
