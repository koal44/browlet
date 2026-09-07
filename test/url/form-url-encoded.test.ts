import { describe, expect, it } from 'vitest';

import { urlAlgorithms, type FormTuple } from './contract';

const encoder = new TextEncoder();

describe('URL Standard section 5: application/x-www-form-urlencoded', () => {
  for (const [input, output] of [
    ['', []],
    ['&&', []],
    ['a=b&c=d', [['a', 'b'], ['c', 'd']]],
    ['a=b=c', [['a', 'b=c']]],
    ['=b&a=', [['', 'b'], ['a', '']]],
    ['a', [['a', '']]],
    ['a+b=c+d', [['a b', 'c d']]],
    ['a%2Bb=c%2Bd', [['a+b', 'c+d']]],
    ['a%26b=c%3Dd', [['a&b', 'c=d']]],
    ['a=1&a=2', [['a', '1'], ['a', '2']]],
    ['%E2%80%BD=%F0%9F%92%A9', [['‽', '💩']]],
  ] as const satisfies readonly (readonly [string, readonly FormTuple[]])[]) {
    it(`parses ${JSON.stringify(input)}`, () => {
      expect(urlAlgorithms().parseFormUrlEncoded([...encoder.encode(input)]))
        .toEqual(output);
    });
  }

  it('decodes malformed UTF-8 without BOM using replacement', () => {
    expect(urlAlgorithms().parseFormUrlEncoded([...encoder.encode('a=%FF')]))
      .toEqual([['a', '�']]);
  });

  it('preserves a percent-encoded UTF-8 BOM', () => {
    expect(urlAlgorithms().parseFormUrlEncoded([
      ...encoder.encode('%EF%BB%BF=value'),
    ])).toEqual([['\uFEFF', 'value']]);
  });

  it('the string parser UTF-8 encodes before parsing', () => {
    expect(urlAlgorithms().parseFormUrlEncodedString('q=🏳️‍🌈'))
      .toEqual([['q', '🏳️‍🌈']]);
  });

  for (const [tuples, output] of [
    [[], ''],
    [[['a', 'b']], 'a=b'],
    [[['a', '1'], ['a', '2']], 'a=1&a=2'],
    [[['a b', 'c d']], 'a+b=c+d'],
    [[['a&b', 'c=d']], 'a%26b=c%3Dd'],
    [[['~', '*-._']], '%7E=*-._'],
    [[['q', '🏳️‍🌈']], 'q=%F0%9F%8F%B3%EF%B8%8F%E2%80%8D%F0%9F%8C%88'],
  ] as const satisfies readonly (readonly [readonly FormTuple[], string])[]) {
    it(`serializes ${JSON.stringify(tuples)}`, () => {
      expect(urlAlgorithms().serializeFormUrlEncoded([...tuples]))
        .toBe(output);
    });
  }

  it('serializes with a requested legacy output encoding', () => {
    expect(urlAlgorithms().serializeFormUrlEncoded(
      [['q', '≡‽']],
      'Shift_JIS',
    )).toBe('q=%81%DF%26%238253%3B');
  });

  it('uses UTF-8 when the requested encoding has no encoder', () => {
    expect(urlAlgorithms().serializeFormUrlEncoded(
      [['q', '‽']],
      'UTF-16LE',
    )).toBe('q=%E2%80%BD');
  });
});
