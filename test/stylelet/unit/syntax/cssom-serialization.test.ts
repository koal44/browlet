import { describe, expect, it } from 'vitest';
import {
  serializeCssFunction, serializeCssIdentifier, serializeCssLocal, serializeCssString,
  serializeComponentValues,
} from '../../../../src/stylelet/syntax/component-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';

describe('CSSOM common serialization', () => {
  it.each([
    ['', ''],
    ['\0', '\ufffd'],
    ['\x01\x1f\x7f', '\\1 \\1f \\7f '],
    ['1a', '\\31 a'],
    ['-1a', '-\\31 a'],
    ['-', '\\-'],
    ['--1', '--1'],
    ['a b?\\', 'a\\ b\\?\\\\'],
    ['AZaz_-09', 'AZaz_-09'],
  ])('serializes identifier %j', (input, expected) => {
    expect(serializeCssIdentifier(input)).toBe(expected);
  });

  it.each([
    ['', '""'],
    ['a\0b', '"a\ufffdb"'],
    ['\x01\x1f\x7f', '"\\1 \\1f \\7f "'],
    ['"\\', '"\\"\\\\"'],
    ["a'b", '"a\'b"'],
    ['\ud800', '"\ud800"'],
  ])('serializes string %j', (input, expected) => {
    expect(serializeCssString(input)).toBe(expected);
  });

  it('formats interpreted functions without changing their serialized contents', () => {
    expect(serializeCssFunction('F?O', '1em, "UPPER"')).toBe('f\\?o(1em, "UPPER")');
    expect(serializeCssFunction('F', '')).toBe('f()');
    // Generic syntax has no value grammar and must retain the name's spelling.
    expect(serializeComponentValues(parseListOfComponentValues('UPPER()').tokens)).toBe('UPPER()');
  });

  it('serializes local font names as quoted strings', () => {
    expect(serializeCssLocal('A "font"\n')).toBe('local("A \\"font\\"\\a ")');
  });
});
