import { describe, expect, it } from 'vitest';

import { parseLegacyColor } from '../../../../src/browlet/html/microsyntaxes/index';

describe('HTML legacy colors', () => {
  it.each(['', 'transparent', 'TRANSPARENT', '\t Transparent\r\n'])(
    'rejects %j instead of supplying a color', (input) => {
      expect(parseLegacyColor(input)).toBeNull();
    },
  );

  it.each([
    ['red', 255, 0, 0], ['ReD', 255, 0, 0], [' Red\t\n', 255, 0, 0], ['RebeccaPurple', 102, 51, 153],
    ['LIGHTGOLDENRODYELLOW', 250, 250, 210],
    ['black', 0, 0, 0], ['white', 255, 255, 255], ['DarkGrey', 169, 169, 169],
    ['#abc', 170, 187, 204], ['#AbC', 170, 187, 204], ['#000', 0, 0, 0],
    ['#123456', 18, 52, 86], ['abcdef', 171, 205, 239],
  ] as const)('parses the named or hexadecimal color %j', (input, red, green, blue) => {
    expect(parseLegacyColor(input)).toMatchObject({
      space: { name: 'srgb' }, components: [red, green, blue],
      alpha: 255, is8Bit: true, isLegacySrgb: true,
    });
  });

  it.each([
    [' ', 0, 0, 0], ['\t\n\f\r ', 0, 0, 0], ['#', 0, 0, 0],
    ['f', 15, 0, 0], ['#f', 15, 0, 0], ['#ff', 15, 15, 0], ['abc', 10, 11, 12],
    ['chucknorris', 192, 0, 0], ['##abc', 10, 188, 0],
    ['#abcd', 171, 205, 0], ['#12345678', 18, 69, 120],
    ['rgb(1, 2, 3)', 0, 16, 0], ['currentColor', 192, 224, 0], ['ButtonText', 176, 0, 0],
    ['constructor', 192, 0, 0], ['__proto__', 0, 0, 0],
    ['12  34', 18, 0, 52], ['12\t\n34', 18, 0, 52],
    ['\u00a0red\u00a0', 0, 237, 0], ['\vred\v', 0, 237, 0], ['\ufeffred\ufeff', 0, 237, 0],
    ['\ud83d\ude001234', 0, 18, 52], ['\ud8001234', 1, 35, 64], ['\udc001234', 1, 35, 64],
    ['#abc\u2028', 171, 192, 0], ['#abc\u2029', 171, 192, 0],
    ['\0abc', 10, 188, 0], ['\uff11\uff12\uff13', 0, 0, 0],
    ['000010000020000030', 16, 32, 48], ['000100002000300', 1, 2, 48],
    ['f00000011f00000022f00000033', 17, 34, 51], ['123456789', 18, 69, 120],
  ] as const)('recovers %j using HTML rules, not CSS parsing', (input, red, green, blue) => {
    expect(parseLegacyColor(input)).toMatchObject({
      space: { name: 'srgb' }, components: [red, green, blue],
      alpha: 255, is8Bit: true, isLegacySrgb: true,
    });
  });

  it('includes the leading hash in the 128-character limit', () => {
    expect(parseLegacyColor(`#${'0'.repeat(126)}11`)?.components).toEqual([0, 0, 16]);
    expect(parseLegacyColor(`${'0'.repeat(126)}11`)?.components).toEqual([0, 0, 17]);
  });

  it('replaces non-BMP characters with two zeros before applying the limit', () => {
    expect(parseLegacyColor(`${'0'.repeat(125)}\ud83d\ude00abc`)?.components).toEqual([0, 0, 160]);
    expect(parseLegacyColor(`#${'0'.repeat(125)}\ud83d\ude00abc`)?.components).toEqual([0, 0, 0]);
    // The limit can fall between the two zeros replacing one non-BMP code point.
    expect(parseLegacyColor(`1${'0'.repeat(126)}\ud83d\ude00abc`)?.components).toEqual([0, 0, 0]);
  });

  it('ignores all data beyond the limit', () => {
    const prefix = 'f'.repeat(128);
    expect(parseLegacyColor(`${prefix}${'0'.repeat(1000)}`)?.components).toEqual([255, 255, 255]);
    expect(parseLegacyColor(`${prefix}transparent`)?.components).toEqual([255, 255, 255]);
  });

  it('does not share mutable components between results or change the named-color table', () => {
    const first = parseLegacyColor('red')!;
    const second = parseLegacyColor('red')!;
    first.components[0] = 0;
    expect(second.components).toEqual([255, 0, 0]);
    expect(parseLegacyColor('red')?.components).toEqual([255, 0, 0]);
  });
});
