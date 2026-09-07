import { describe, expect, it } from 'vitest';

import {
  serializeStructuredField, type StructuredBareItem, type StructuredDictionary,
  type StructuredField, type StructuredItem, type StructuredParameters,
} from '../../../src/http/struct-fields';

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
    expect(field.value.value).toBe(value);
  });

  it.each([1e12, -1e12, 999_999_999_999.9999, -999_999_999_999.9999, NaN, Infinity, -Infinity])(
    'rejects decimal overflow or a non-finite value %s', (value) => {
      expect(serializeStructuredField(item({ type: 'decimal', value }))).toBeNull();
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
  value: StructuredBareItem, parameters: StructuredParameters = new Map(),
): StructuredItem {
  return { type: 'item', value, parameters };
}
