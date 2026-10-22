import { describe, expect, it } from 'vitest';
import { serializeCssIdentifier, serializeCssString } from '../../../../src/stylelet/syntax/component-value';
import { AutoValue } from '../../../../src/stylelet/values/auto';
import { IdentValue } from '../../../../src/stylelet/values/ident';
import { CustomIdentValue } from '../../../../src/stylelet/values/custom-ident';
import { DashedIdentValue } from '../../../../src/stylelet/values/dashed-ident';
import { StringValue } from '../../../../src/stylelet/values/string';
import { AnPlusBValue } from '../../../../src/stylelet/values/an-plus-b';

describe('auto', () => {
  it('serializes the auto keyword', () => {
    expect(new AutoValue().serialize()).toBe('auto');
  });
});
describe('ident', () => {
  it('parses an ident token into its semantic value', () => {
    expect(IdentValue.parse('foo', {})).toEqual(new IdentValue('foo'));
    expect(IdentValue.parse(String.raw`foo\ bar`, {})).toEqual(new IdentValue('foo bar'));
    expect(IdentValue.parse(String.raw`\31 abc`, {})).toEqual(new IdentValue('1abc'));
  });

  it('accepts trivia and identifiers with no custom-ident restrictions', () => {
    expect(IdentValue.parse(' /* before */ default /* after */ ', {})).toEqual(new IdentValue('default'));
    expect(IdentValue.parse('inherit', {})).not.toBeNull();
    expect(IdentValue.parse('--custom', {})).not.toBeNull();
  });

  it.each([
    '',
    '1abc',
    '10px',
    'foo bar',
    'fn()',
    '"foo"',
  ])('rejects %j as an ident production', (input) => {
    expect(IdentValue.parse(input, {})).toBeNull();
  });

  it.each([
    ['', ''],
    ['foo', 'foo'],
    ['foo_bar-10', 'foo_bar-10'],
    ['1abc', String.raw`\31 abc`],
    ['-1abc', String.raw`-\31 abc`],
    ['-', String.raw`\-`],
    ['foo bar', String.raw`foo\ bar`],
    ['.foo#bar', String.raw`\.foo\#bar`],
    ['foo\\bar', String.raw`foo\\bar`],
    ['\0', '\uFFFD'],
    ['\t\n\r\f', String.raw`\9 \a \d \c `],
    ['\x01\x1f\x7f', String.raw`\1 \1f \7f `],
    ['f\u00F6o', 'f\u00F6o'],
    ['\u{1F600}', '\u{1F600}'],
  ])('serializes %j as %j', (value, expected) => {
    expect(serializeCssIdentifier(value)).toBe(expected);
  });

  it('serializes an IdentValue', () => {
    expect(new IdentValue('1abc').serialize())
      .toBe(String.raw`\31 abc`);
  });

  it.each([
    'foo',
    '1abc',
    '-1abc',
    '-',
    'foo bar',
    '.foo#bar',
    '\x01a',
    'f\u00F6o',
    '\u{1F600}',
  ])('round-trips the semantic identifier %j', (value) => {
    expect(IdentValue.parse(serializeCssIdentifier(value), {})).toEqual(new IdentValue(value));
  });
});
describe('custom-ident', () => {
  it('parses an author-defined identifier case-sensitively', () => {
    expect(CustomIdentValue.parse('MyName', [], {})).toEqual(new CustomIdentValue('MyName'));
    expect(CustomIdentValue.parse(String.raw`my\ name`, [], {})).toEqual(new CustomIdentValue('my name'));
  });

  it.each([
    'inherit',
    'INITIAL',
    'UnSeT',
    'revert',
    'REVERT-LAYER',
    'default',
    'DeFaUlT',
    String.raw`\64 efault`,
  ])('rejects the globally reserved keyword %j', (input) => {
    expect(CustomIdentValue.parse(input, [], {})).toBeNull();
  });

  it('rejects caller-supplied keywords ASCII case-insensitively', () => {
    expect(CustomIdentValue.parse('none', ['none'], {})).toBeNull();
    expect(CustomIdentValue.parse('NoNe', ['none'], {})).toBeNull();
    expect(CustomIdentValue.parse(String.raw`\6e one`, ['none'], {})).toBeNull();
  });

  it('does not exclude property-specific keywords unless requested', () => {
    expect(CustomIdentValue.parse('none', [], {})).toEqual(new CustomIdentValue('none'));
  });

  it('serializes through the generic identifier algorithm', () => {
    expect(new CustomIdentValue('foo bar').serialize())
      .toBe(String.raw`foo\ bar`);
  });
});
describe('dashed-ident', () => {
  it.each<[string, `--${string}`]>([
    ['--name', '--name'],
    ['--', '--'],
    [String.raw`\2d -escaped`, '--escaped'],
  ])('parses %j as the semantic value %j', (input, value) => {
    expect(DashedIdentValue.parse(input, {})).toEqual(new DashedIdentValue(value));
  });

  it.each([
    '',
    'name',
    '-name',
    'default',
    'inherit',
    '"--name"',
  ])('rejects %j', (input) => {
    expect(DashedIdentValue.parse(input, {})).toBeNull();
  });

  it('serializes through the generic identifier algorithm', () => {
    expect(new DashedIdentValue('--foo bar').serialize()).toBe(String.raw`--foo\ bar`);
  });

  it('round-trips a semantic dashed identifier', () => {
    const value = new DashedIdentValue('--foo bar');
    expect(DashedIdentValue.parse(value.serialize(), {})).toEqual(value);
  });
});
describe('string', () => {
  it('parses a string token into its semantic value', () => {
    expect(StringValue.parse('"foo"', {})).toEqual(new StringValue('foo'));
    expect(StringValue.parse(String.raw`'foo\20 bar'`, {})).toEqual(new StringValue('foo bar'));
    expect(StringValue.parse(String.raw`"foo\
bar"`, {})).toEqual(new StringValue('foobar'));
  });

  it('accepts surrounding trivia', () => {
    expect(StringValue.parse(' /* before */ "foo" /* after */ ', {})).toEqual(new StringValue('foo'));
  });

  it.each([
    '',
    'foo',
    '"foo" "bar"',
    '"foo\nbar"',
  ])('rejects %j as a string production', (input) => {
    expect(StringValue.parse(input, {})).toBeNull();
  });

  it.each([
    ['', '""'],
    ['foo', '"foo"'],
    ['"\\', String.raw`"\"\\"`],
    ["'", `"'"`],
    ['\0', '"\uFFFD"'],
    ['\x01\t\n\r\f\x1f\x7f', String.raw`"\1 \9 \a \d \c \1f \7f "`],
    ['f\u00F6o', '"f\u00F6o"'],
    ['\u{1F600}', '"\u{1F600}"'],
  ])('serializes %j as %j', (value, expected) => {
    expect(serializeCssString(value)).toBe(expected);
  });

  it('serializes a StringValue', () => {
    expect(new StringValue('foo"bar').serialize())
      .toBe(String.raw`"foo\"bar"`);
  });

  it.each([
    '',
    'foo',
    'foo bar',
    '"\\',
    "'",
    '\x01a',
    'f\u00F6o',
    '\u{1F600}',
  ])('round-trips the semantic string %j', (value) => {
    expect(StringValue.parse(serializeCssString(value), {})).toEqual(new StringValue(value));
  });
});
describe('An+B', () => {
  it.each([
    [{ a: 0, b: 3 }, '3'],
    [{ a: 1, b: 0 }, 'n'],
    [{ a: -1, b: 3 }, '-n+3'],
    [{ a: 2, b: -1 }, '2n-1'],
    [{ a: -2, b: 0 }, '-2n'],
    [{ a: 0, b: -0 }, '0'],
  ] as const)('serializes %j as %s', (value, expected) => {
    expect(new AnPlusBValue(value).serialize()).toBe(expected);
  });
});
