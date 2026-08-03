import { describe, expect, it } from 'vitest';
import { ValueStage } from '../../../../src/stylelet/value-processing';
import { parseStylesheet } from '../../../../src/stylelet/parser/ast';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import {
  BlockKind, parseListOfComponentValues,
  type ComponentValue,
} from '../../../../src/stylelet/parser/syntax';
import {
  BadStringToken, BadUrlToken, RightParenToken, WhitespaceToken, identToken,
  stringToken,
} from '../../../../src/stylelet/parser/tokens';
import { BlockItemAstKind, type StyleRuleAst } from '../../../../src/stylelet/parser/types';
import { serializeAnPlusB } from '../../../../src/stylelet/values/an-plus-b';
import {
  ANGLE_UNITS, canonicalizeAngle, createAngleConsumer, parseAngle, serializeAngle,
  serializeCanonicalAngle, tryConsumeAngle,
} from '../../../../src/stylelet/values/numeric-literal/angle';
import {
  createAnglePercentageConsumer, parseAnglePercentage, serializeAnglePercentage,
  tryConsumeAnglePercentage, tryAccumulateAnglePercentages, tryAddAnglePercentages,
  tryInterpolateAnglePercentages, tryResolveAnglePercentage,
} from '../../../../src/stylelet/values/numeric-literal/angle-percentage';
import { parseAnyValue, tryConsumeAnyValue } from '../../../../src/stylelet/values/any-value';
import { serializeAuto } from '../../../../src/stylelet/values/auto';
import { parseCssWideValue, tryConsumeCssWideValue } from '../../../../src/stylelet/values/css-wide';
import { parseDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import {
  accumulateDimensions, addDimensions, interpolateDimensions, parseDimension, serializeDimension,
  tryConsumeDimension,
} from '../../../../src/stylelet/values/numeric-literal/dimension';
import { parseCustomIdent, serializeCustomIdent } from '../../../../src/stylelet/values/custom-ident';
import { parseDashedIdent, serializeDashedIdent } from '../../../../src/stylelet/values/dashed-ident';
import {
  parseIdent, serializeIdent,
  serializeIdentifier,
} from '../../../../src/stylelet/values/ident';
import { createKeywordConsumer } from '../../../../src/stylelet/values/keyword';
import {
  accumulateIntegers, addIntegers, createIntegerConsumer, interpolateIntegers, parseInteger,
  serializeInteger, tryConsumeInteger,
} from '../../../../src/stylelet/values/numeric-literal/integer';
import {
  canonicalizeFrequency, createFrequencyConsumer, FREQUENCY_UNITS, parseFrequency,
  serializeCanonicalFrequency, serializeFrequency, tryConsumeFrequency,
} from '../../../../src/stylelet/values/numeric-literal/frequency';
import {
  createFrequencyPercentageConsumer, parseFrequencyPercentage, serializeFrequencyPercentage,
  tryConsumeFrequencyPercentage, tryAccumulateFrequencyPercentages, tryAddFrequencyPercentages,
  tryInterpolateFrequencyPercentages, tryResolveFrequencyPercentage,
} from '../../../../src/stylelet/values/numeric-literal/frequency-percentage';
import {
  createLengthConsumer, LENGTH_UNITS, parseLength, serializeCanonicalLength, serializeLength,
  snapLengthAsLineWidth, tryConsumeLength, tryResolveLength, type LengthResolutionContext,
} from '../../../../src/stylelet/values/numeric-literal/length';
import {
  createLengthPercentageConsumer, parseLengthPercentage, serializeLengthPercentage,
  tryConsumeLengthPercentage, tryAccumulateLengthPercentages, tryAddLengthPercentages,
  tryInterpolateLengthPercentages, tryResolveLengthPercentage,
} from '../../../../src/stylelet/values/numeric-literal/length-percentage';
import {
  accumulateNumbers, addNumbers, createNumberConsumer, interpolateNumbers, parseNumber,
  serializeNumber, tryConsumeNumber,
} from '../../../../src/stylelet/values/numeric-literal/number';
import {
  accumulatePercentages, addPercentages, createPercentageConsumer, interpolatePercentages,
  parsePercentage, serializePercentage, tryConsumePercentage,
} from '../../../../src/stylelet/values/numeric-literal/percentage';
import {
  interpolateRatios, isDegenerateRatio, parseRatio, serializeRatio,
  tryConsumeRatio,
} from '../../../../src/stylelet/values/ratio';
import {
  canonicalizeResolution, createResolutionConsumer, parseResolution, RESOLUTION_UNITS,
  serializeCanonicalResolution, serializeResolution, tryConsumeResolution,
} from '../../../../src/stylelet/values/numeric-literal/resolution';
import {
  parseString, serializeCssString,
  serializeString,
} from '../../../../src/stylelet/values/string';
import {
  canonicalizeTime, createTimeConsumer, parseTime, serializeCanonicalTime,
  serializeTime, TIME_UNITS, tryConsumeTime,
} from '../../../../src/stylelet/values/numeric-literal/time';
import {
  createTimePercentageConsumer, parseTimePercentage, serializeTimePercentage,
  tryConsumeTimePercentage, tryAccumulateTimePercentages, tryAddTimePercentages,
  tryInterpolateTimePercentages, tryResolveTimePercentage,
} from '../../../../src/stylelet/values/numeric-literal/time-percentage';
import {
  parseUrlModifier, serializeRequestUrlModifier,
  tryConsumeUrlModifier,
} from '../../../../src/stylelet/values/url-modifier';
import { parseUrl, serializeUrl, tryConsumeUrl } from '../../../../src/stylelet/values/url';
import { parseZero, tryConsumeZero } from '../../../../src/stylelet/values/zero';
import {
  accumulateOpacities, addOpacities, interpolateOpacities, parseOpacityValue, resolveOpacityValue,
  serializeOpacityValue,
} from '../../../../src/stylelet/values/opacity-value';

// Keywords

describe('keyword', () => {
  it('creates case-insensitive singleton and grouped keyword consumers', () => {
    const consumeAuto = createKeywordConsumer('auto');
    const consumeStrategy = createKeywordConsumer('nearest', 'up', 'to-zero');

    expect(consumeAuto(new ComponentCursor(parseListOfComponentValues('AUTO'))))
      .toBe('auto');
    expect(consumeStrategy(new ComponentCursor(parseListOfComponentValues('To-ZeRo'))))
      .toBe('to-zero');
  });

  it('leaves component trivia to the caller', () => {
    const cursor = new ComponentCursor(parseListOfComponentValues(' auto'));

    expect(createKeywordConsumer('auto')(cursor)).toBeNull();
    expect(cursor.pos()).toBe(0);
  });
});

describe('auto', () => {
  it('serializes the auto keyword', () => {
    expect(serializeAuto({ type: 'auto' })).toBe('auto');
  });
});

describe('CSS-wide value', () => {
  it('parses keywords case-insensitively and serializes their canonical spelling', () => {
    const value = parseCssWideValue(' ReVeRt-LaYeR ');

    expect(value).toMatchObject({
      type: 'css-wide',
      keyword: 'revert-layer',
    });
    expect(value!.serialize()).toBe('revert-layer');
    expect(value!.resolve(ValueStage.Computed, {})).toBe(value);
  });

  it('rejects other identifiers and additional components', () => {
    expect(parseCssWideValue('default')).toBeNull();
    expect(parseCssWideValue('inherit initial')).toBeNull();
  });

  it('consumes one CSS-wide keyword without requiring the end of input', () => {
    const components = parseListOfComponentValues('inherit initial');
    const c = new ComponentCursor(components);

    expect(tryConsumeCssWideValue(c)).toMatchObject({
      type: 'css-wide',
      keyword: 'inherit',
    });
    expect(c.pos()).toBe(1);
  });
});

// Free-form productions

describe('any-value', () => {
  it('parses a nonempty sequence of arbitrary component values', () => {
    const expected = parseListOfComponentValues('a ! b; fn() []');
    expect(parseAnyValue('a ! b; fn() []')).toEqual({
      type: 'any-value',
      components: expected,
    });
  });

  it('returns the original component values after validating them', () => {
    const components = parseListOfComponentValues('a fn(b)');
    expect(parseAnyValue(components)?.components).toBe(components);
  });

  it('consumes the remaining nonempty component-value sequence', () => {
    const components = parseListOfComponentValues('a fn(b)');
    const c = new ComponentCursor(components);

    expect(tryConsumeAnyValue(c)).toEqual({
      type: 'any-value',
      components,
    });
    expect(c.pos()).toBe(components.length);
  });

  it('stops before a component that cannot belong to the production', () => {
    const components = parseListOfComponentValues('a)');
    const c = new ComponentCursor(components);

    expect(tryConsumeAnyValue(c)).toEqual({
      type: 'any-value',
      components: components.slice(0, 1),
    });
    expect(c.pos()).toBe(1);
    expect(c.peek()).toBe(RightParenToken);
  });

  it('restores the cursor when its first component does not match', () => {
    const empty = new ComponentCursor([]);
    const invalid = new ComponentCursor(parseListOfComponentValues(') a'));

    expect(tryConsumeAnyValue(empty)).toBeNull();
    expect(empty.pos()).toBe(0);
    expect(tryConsumeAnyValue(invalid)).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('accepts empty nested block contents', () => {
    expect(parseAnyValue('fn()')).not.toBeNull();
    expect(parseAnyValue('[]')).not.toBeNull();
  });

  it('rejects an empty production', () => {
    expect(parseAnyValue('')).toBeNull();
  });

  it('rejects bad tokens recursively', () => {
    expect(parseAnyValue('"x\ny"')).toBeNull();
    expect(parseAnyValue('fn("x\ny")')).toBeNull();
    expect(parseAnyValue('url(foo"bar)')).toBeNull();
    expect(parseAnyValue('fn(url(foo"bar))')).toBeNull();
  });

  it('rejects unmatched closing tokens recursively', () => {
    expect(parseAnyValue(')')).toBeNull();
    expect(parseAnyValue(']')).toBeNull();
    expect(parseAnyValue('}')).toBeNull();
    expect(parseAnyValue('fn(])')).toBeNull();
    expect(parseAnyValue('[)]')).toBeNull();
  });
});

describe('declaration-value', () => {
  const values = parseListOfComponentValues;

  it('parses a nonempty sequence of declaration component values', () => {
    const components = values('red 1px url(foo.png)');
    const value = parseDeclarationValue(components);

    expect(value).toEqual({
      type: 'declaration-value',
      components,
    });
    expect(value?.components).toBe(components);
  });

  it('rejects an empty production', () => {
    expect(parseDeclarationValue('')).toBeNull();
  });

  it('rejects top-level semicolons and bangs', () => {
    expect(parseDeclarationValue('a ! b')).toBeNull();
    expect(parseDeclarationValue('a; b')).toBeNull();
  });

  it('allows semicolons and bangs inside blocks', () => {
    expect(parseDeclarationValue('fn(a ! b; c)')).not.toBeNull();
    expect(parseDeclarationValue('[a ! b; c]')).not.toBeNull();
    expect(parseDeclarationValue('(a ! b; c)')).not.toBeNull();
  });

  it('rejects invalid component values recursively', () => {
    expect(parseDeclarationValue('"x\ny"')).toBeNull();
    expect(parseDeclarationValue('fn(url(foo"bar))')).toBeNull();
    expect(parseDeclarationValue('fn(])')).toBeNull();
    expect(parseDeclarationValue('[)]')).toBeNull();
  });
});

// Textual data types

describe('ident', () => {
  it('parses an ident token into its semantic value', () => {
    expect(parseIdent('foo')).toEqual({ type: 'ident', value: 'foo' });
    expect(parseIdent(String.raw`foo\ bar`)).toEqual({
      type: 'ident',
      value: 'foo bar',
    });
    expect(parseIdent(String.raw`\31 abc`)).toEqual({
      type: 'ident',
      value: '1abc',
    });
  });

  it('accepts trivia and identifiers with no custom-ident restrictions', () => {
    expect(parseIdent(' /* before */ default /* after */ ')).toEqual({
      type: 'ident',
      value: 'default',
    });
    expect(parseIdent('inherit')).not.toBeNull();
    expect(parseIdent('--custom')).not.toBeNull();
  });

  it.each([
    '',
    '1abc',
    '10px',
    'foo bar',
    'fn()',
    '"foo"',
  ])('rejects %j as an ident production', (input) => {
    expect(parseIdent(input)).toBeNull();
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
    expect(serializeIdentifier(value)).toBe(expected);
  });

  it('serializes an IdentValue', () => {
    expect(serializeIdent({ type: 'ident', value: '1abc' }))
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
    expect(parseIdent(serializeIdentifier(value))).toEqual({
      type: 'ident',
      value,
    });
  });
});

describe('custom-ident', () => {
  it('parses an author-defined identifier case-sensitively', () => {
    expect(parseCustomIdent('MyName')).toEqual({
      type: 'custom-ident',
      value: 'MyName',
    });
    expect(parseCustomIdent(String.raw`my\ name`)).toEqual({
      type: 'custom-ident',
      value: 'my name',
    });
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
    expect(parseCustomIdent(input)).toBeNull();
  });

  it('rejects caller-supplied keywords ASCII case-insensitively', () => {
    expect(parseCustomIdent('none', ['none'])).toBeNull();
    expect(parseCustomIdent('NoNe', ['none'])).toBeNull();
    expect(parseCustomIdent(String.raw`\6e one`, ['none'])).toBeNull();
  });

  it('does not exclude property-specific keywords unless requested', () => {
    expect(parseCustomIdent('none')).toEqual({
      type: 'custom-ident',
      value: 'none',
    });
  });

  it('serializes through the generic identifier algorithm', () => {
    expect(serializeCustomIdent({ type: 'custom-ident', value: 'foo bar' }))
      .toBe(String.raw`foo\ bar`);
  });
});

describe('dashed-ident', () => {
  it.each([
    ['--name', '--name'],
    ['--', '--'],
    [String.raw`\2d -escaped`, '--escaped'],
  ])('parses %j as the semantic value %j', (input, value) => {
    expect(parseDashedIdent(input)).toEqual({
      type: 'dashed-ident',
      value,
    });
  });

  it.each([
    '',
    'name',
    '-name',
    'default',
    'inherit',
    '"--name"',
  ])('rejects %j', (input) => {
    expect(parseDashedIdent(input)).toBeNull();
  });

  it('serializes through the generic identifier algorithm', () => {
    expect(serializeDashedIdent({
      type: 'dashed-ident',
      value: '--foo bar',
    })).toBe(String.raw`--foo\ bar`);
  });

  it('round-trips a semantic dashed identifier', () => {
    const value = { type: 'dashed-ident', value: '--foo bar' } as const;
    expect(parseDashedIdent(serializeDashedIdent(value))).toEqual(value);
  });
});

describe('string', () => {
  it('parses a string token into its semantic value', () => {
    expect(parseString('"foo"')).toEqual({
      type: 'string',
      value: 'foo',
    });
    expect(parseString(String.raw`'foo\20 bar'`)).toEqual({
      type: 'string',
      value: 'foo bar',
    });
    expect(parseString(String.raw`"foo\
bar"`)).toEqual({
      type: 'string',
      value: 'foobar',
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parseString(' /* before */ "foo" /* after */ ')).toEqual({
      type: 'string',
      value: 'foo',
    });
  });

  it.each([
    '',
    'foo',
    '"foo" "bar"',
    '"foo\nbar"',
  ])('rejects %j as a string production', (input) => {
    expect(parseString(input)).toBeNull();
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
    expect(serializeString({ type: 'string', value: 'foo"bar' }))
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
    expect(parseString(serializeCssString(value))).toEqual({
      type: 'string',
      value,
    });
  });
});

describe('url-modifier', () => {
  it('parses an identifier modifier through its value grammar', () => {
    expect(parseUrlModifier('cross-origin')).toEqual({
      type: 'ident',
      value: 'cross-origin',
    });
  });

  it('parses unknown functional notation as a function block', () => {
    expect(parseUrlModifier('future-modifier(value)')).toEqual({
      type: 'block',
      block: BlockKind.Function,
      name: 'future-modifier',
      value: [identToken('value')],
    });
  });

  it.each([
    [
      'cross-origin(anonymous)',
      { type: 'cross-origin-modifier', value: 'anonymous' },
    ],
    [
      'integrity("sha256-test")',
      { type: 'integrity-modifier', value: 'sha256-test' },
    ],
    [
      'referrer-policy(strict-origin)',
      { type: 'referrer-policy-modifier', value: 'strict-origin' },
    ],
  ])('parses the recognized request modifier %j', (input, expected) => {
    expect(parseUrlModifier(input)).toEqual(expected);
  });

  it.each([
    [
      { type: 'cross-origin-modifier', value: 'use-credentials' } as const,
      'cross-origin(use-credentials)',
    ],
    [
      { type: 'integrity-modifier', value: 'sha"256' } as const,
      String.raw`integrity("sha\"256")`,
    ],
    [
      { type: 'referrer-policy-modifier', value: 'strict-origin' } as const,
      'referrer-policy(strict-origin)',
    ],
  ])('serializes the request modifier %j', (value, expected) => {
    expect(serializeRequestUrlModifier(value)).toBe(expected);
  });

  it.each([
    'cross-origin(unknown)',
    'CROSS-ORIGIN(unknown)',
    'integrity(unknown)',
    'integrity("sha256-test" extra)',
    'referrer-policy(unknown)',
  ])('rejects the malformed recognized request modifier %j', (input) => {
    expect(parseUrlModifier(input)).toBeNull();
  });

  it('commits after recognizing a request modifier with invalid arguments', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('cross-origin(unknown)'),
    );

    expect(tryConsumeUrlModifier(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('rejects unknown functional notation containing a bad token', () => {
    const components: ComponentValue[] = [{
      type: 'block',
      block: BlockKind.Function,
      name: 'future-modifier',
      value: [BadStringToken],
    }];

    expect(parseUrlModifier(components)).toBeNull();

    const c = new ComponentCursor(components);
    expect(tryConsumeUrlModifier(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('consumes a URL modifier through the component grammar', () => {
    const c = new ComponentCursor(parseListOfComponentValues('future-modifier()'));

    expect(tryConsumeUrlModifier(c)).toEqual({
      type: 'block',
      block: BlockKind.Function,
      name: 'future-modifier',
      value: [],
    });
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for anything outside the modifier syntax', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1px'));

    expect(tryConsumeUrlModifier(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

describe('url', () => {
  it('preserves substitution in src() but not in url()', () => {
    expect(parseListOfComponentValues('src(var(--foo))')).toEqual([
      {
        type: 'block',
        block: BlockKind.Function,
        name: 'src',
        value: [
          {
            type: 'block',
            block: BlockKind.Function,
            name: 'var',
            value: [identToken('--foo')],
          },
        ],
      },
    ]);

    expect(parseListOfComponentValues('url(var(--foo))')).toEqual([
      BadUrlToken,
      RightParenToken,
    ]);
  });

  it.each([
    ['url(image.png)', 'url', 'image.png'],
    ['url("image.png")', 'url', 'image.png'],
    ['src("image.png")', 'src', 'image.png'],
    ['URL("image.png")', 'url', 'image.png'],
    ['SrC("image.png")', 'src', 'image.png'],
    ['url()', 'url', ''],
    ['url("")', 'url', ''],
    ['src("")', 'src', ''],
    ['url(#fragment)', 'url', '#fragment'],
  ])('parses %j', (input, notation, value) => {
    expect(parseUrl(input)).toEqual({
      type: 'url',
      notation,
      value,
      modifiers: {},
    });
  });

  it.each([
    ['url(image.png)', 'url("image.png")'],
    ['url("image.png")', 'url("image.png")'],
    ['src("image.png")', 'src("image.png")'],
    ['url()', 'url("")'],
    ['url(#fragment)', 'url("#fragment")'],
    [String.raw`url("a\"b\\c")`, String.raw`url("a\"b\\c")`],
    ['url("image.png" future-modifier())', 'url("image.png")'],
  ])('serializes %j as %j', (input, expected) => {
    expect(serializeUrl(parseUrl(input)!)).toBe(expected);
  });

  it('serializes request URL modifiers in grammar order', () => {
    const value = parseUrl([
      'url("image.png"',
      'referrer-policy(no-referrer)',
      'integrity("sha256-test")',
      'cross-origin(use-credentials))',
    ].join(' '))!;

    expect(serializeUrl(value)).toBe([
      'url("image.png"',
      'cross-origin(use-credentials)',
      'integrity("sha256-test")',
      'referrer-policy(no-referrer))',
    ].join(' '));
  });

  it('is idempotent after canonical serialization', () => {
    const value = parseUrl([
      'src("image.png"',
      'referrer-policy(origin)',
      'cross-origin(anonymous))',
    ].join(' '))!;
    const serialized = serializeUrl(value);

    expect(serializeUrl(parseUrl(serialized)!)).toBe(serialized);
  });

  it('accepts component trivia around and inside functional notation', () => {
    expect(parseUrl(' /* before */ src( /* inner */ "image.png" ) /* after */ '))
      .toEqual({
        type: 'url',
        notation: 'src',
        value: 'image.png',
        modifiers: {},
      });
  });

  it.each([
    'url("image.png" cross-origin)',
    'url("image.png" future-modifier())',
    'url("image.png" unknown another-unknown())',
  ])('ignores unrecognized URL modifiers in %j', (input) => {
    expect(parseUrl(input)).toEqual({
      type: 'url',
      notation: 'url',
      value: 'image.png',
      modifiers: {},
    });
  });

  it('projects recognized request URL modifiers into their grammar fields', () => {
    expect(parseUrl([
      'url("image.png"',
      'referrer-policy(no-referrer)',
      'unknown',
      'integrity("sha256-test")',
      'cross-origin(use-credentials))',
    ].join(' '))).toEqual({
      type: 'url',
      notation: 'url',
      value: 'image.png',
      modifiers: {
        crossOrigin: {
          type: 'cross-origin-modifier',
          value: 'use-credentials',
        },
        integrity: {
          type: 'integrity-modifier',
          value: 'sha256-test',
        },
        referrerPolicy: {
          type: 'referrer-policy-modifier',
          value: 'no-referrer',
        },
      },
    });
  });

  it.each([
    'url("image.png" integrity("first") integrity("second"))',
    [
      'url("image.png"',
      'cross-origin(anonymous)',
      'unknown',
      'referrer-policy(no-referrer)',
      'CROSS-ORIGIN(use-credentials))',
    ].join(' '),
  ])('rejects the duplicate request URL modifier in %j', (input) => {
    expect(parseUrl(input)).toBeNull();
  });

  it('commits after consuming a duplicate request URL modifier', () => {
    const c = new ComponentCursor(parseListOfComponentValues([
      'src("image.png"',
      'referrer-policy(no-referrer)',
      'unknown()',
      'REFERRER-POLICY(origin))',
    ].join(' ')));

    expect(tryConsumeUrl(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('rejects an unknown functional modifier containing a bad token', () => {
    expect(parseUrl([{
      type: 'block',
      block: BlockKind.Function,
      name: 'url',
      value: [
        stringToken('image.png'),
        WhitespaceToken,
        {
          type: 'block',
          block: BlockKind.Function,
          name: 'future-modifier',
          value: [BadStringToken],
        },
      ],
    }])).toBeNull();
  });

  it.each([
    '',
    '"image.png"',
    'src(image.png)',
    'src()',
    'src(var(--image))',
    'url(var(--image))',
    'url("image.png" 1px)',
    'url(foo"bar)',
  ])('rejects %j', (input) => {
    expect(parseUrl(input)).toBeNull();
  });

  it('commits after recognizing a function with invalid arguments', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('url("image.png" 1px)'),
    );
    const result = tryConsumeUrl(c);

    expect(result).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

// Numeric data types

describe('integer', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['+12', 12],
    ['-12', -12],
    ['0012', 12],
  ] as const)('parses %j as the integer %d', (input, expected) => {
    expect(parseInteger(input)).toEqual({
      type: 'integer',
      value: expected,
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parseInteger(' /* before */ -12 /* after */ ')).toEqual({
      type: 'integer',
      value: -12,
    });
  });

  it.each([
    '',
    '1.0',
    '1e0',
    '.0',
    '1%',
    '1px',
    '1 2',
    'integer',
  ])('rejects %j as an integer production', (input) => {
    expect(parseInteger(input)).toBeNull();
  });

  it('consumes one integer from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('12 13'));

    expect(tryConsumeInteger(c)).toEqual({
      type: 'integer',
      value: 12,
    });
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-integer number token', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1.0'));

    expect(tryConsumeInteger(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([-2, 0, 3])('includes the range boundary %d', (value) => {
    const c = new ComponentCursor(parseListOfComponentValues(String(value)));
    const consume = createIntegerConsumer({ min: -2, max: 3 });

    expect(consume(c)).toEqual({
      type: 'integer',
      value,
    });
  });

  it.each([-3, 4])('returns null without advancing for out-of-range integer %d', (value) => {
    const c = new ComponentCursor(parseListOfComponentValues(String(value)));
    const consume = createIntegerConsumer({ min: -2, max: 3 });

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('adds integers', () => {
    expect(addIntegers(
      { type: 'integer', value: -2 },
      { type: 'integer', value: 5 },
    )).toEqual({ type: 'integer', value: 3 });
  });

  it.each([
    [-1, 2, 0, -1],
    [-1, 2, 0.5, 1],
    [-2, -1, 0.5, -1],
    [10, 20, 2, 30],
  ])(
    'interpolates %d and %d at p = %d to %d',
    (a, b, p, expected) => {
      expect(interpolateIntegers(
        { type: 'integer', value: a },
        { type: 'integer', value: b },
        p,
      )).toEqual({ type: 'integer', value: expected });
    },
  );

  it('accumulates integers using addition', () => {
    expect(accumulateIntegers(
      { type: 'integer', value: -2 },
      { type: 'integer', value: 5 },
    )).toEqual({ type: 'integer', value: 3 });
  });

  it('normalizes negative zero after interpolation', () => {
    const result = interpolateIntegers(
      { type: 'integer', value: -1 },
      { type: 'integer', value: 0 },
      0.5,
    );

    expect(result.value).toBe(0);
    expect(Object.is(result.value, -0)).toBe(false);
  });

  it.each([
    [{ type: 'integer', value: 0 }, '0'],
    [{ type: 'integer', value: -0 }, '0'],
    [{ type: 'integer', value: 12 }, '12'],
    [{ type: 'integer', value: -12 }, '-12'],
    [{ type: 'integer', value: 1000000000000000128 }, '1000000000000000128'],
    [{ type: 'integer', value: 1e21 }, '1000000000000000000000'],
    [{ type: 'integer', value: -1e21 }, '-1000000000000000000000'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeInteger(value)).toBe(expected);
  });

  it.each([0, 12, -12, 1_000_000])('round-trips the semantic integer %d', (value) => {
    expect(parseInteger(serializeInteger({ type: 'integer', value }))).toEqual({
      type: 'integer',
      value,
    });
  });
});

describe('number', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['+12', 12],
    ['-12', -12],
    ['1.0', 1],
    ['.5', 0.5],
    ['-.5', -0.5],
    ['1e0', 1],
    ['1.5e2', 150],
  ] as const)('parses %j as the number %d', (input, expected) => {
    expect(parseNumber(input)).toEqual({
      type: 'number',
      value: expected,
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parseNumber(' /* before */ -1.25 /* after */ ')).toEqual({
      type: 'number',
      value: -1.25,
    });
  });

  it.each([
    '',
    '1%',
    '1px',
    '1 2',
    'number',
  ])('rejects %j as a number production', (input) => {
    expect(parseNumber(input)).toBeNull();
  });

  it('consumes one number from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1.25 2'));

    expect(tryConsumeNumber(c)).toEqual({
      type: 'number',
      value: 1.25,
    });
    expect(c.pos()).toBe(1);
  });

  it.each([-1.5, 0, 2.5])('includes the range boundary %d', (value) => {
    const c = new ComponentCursor(parseListOfComponentValues(String(value)));
    const consume = createNumberConsumer({ min: -1.5, max: 2.5 });

    expect(consume(c)).toEqual({
      type: 'number',
      value,
    });
  });

  it.each([-1.6, 2.6])('returns null without advancing for out-of-range number %d', (value) => {
    const c = new ComponentCursor(parseListOfComponentValues(String(value)));
    const consume = createNumberConsumer({ min: -1.5, max: 2.5 });

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('adds numbers', () => {
    expect(addNumbers(
      { type: 'number', value: -1.5 },
      { type: 'number', value: 2.25 },
    )).toEqual({ type: 'number', value: 0.75 });
  });

  it.each([
    [0, 10],
    [0.25, 15],
    [1, 30],
    [2, 50],
  ])('interpolates numbers at p = %d', (p, expected) => {
    expect(interpolateNumbers(
      { type: 'number', value: 10 },
      { type: 'number', value: 30 },
      p,
    )).toEqual({ type: 'number', value: expected });
  });

  it('accumulates numbers using addition', () => {
    expect(accumulateNumbers(
      { type: 'number', value: -1.5 },
      { type: 'number', value: 2.25 },
    )).toEqual({ type: 'number', value: 0.75 });
  });

  it.each([
    [0, '0'],
    [-0, '0'],
    [12, '12'],
    [1.25, '1.25'],
    [0.1234564, '0.123456'],
    [0.1234565, '0.123457'],
    [-0.1234565, '-0.123456'],
    [-0.1234566, '-0.123457'],
    [0.0000004, '0'],
    [0.0000005, '0.000001'],
    [0.0000006, '0.000001'],
    [123456789.1234567, '123456789.123457'],
    [1e21, '1000000000000000000000'],
  ] as const)('serializes %d as %j', (value, expected) => {
    expect(serializeNumber({ type: 'number', value })).toBe(expected);
  });

  it.each([0, 1.25, -1.25, 0.000001])('round-trips the semantic number %d', (value) => {
    expect(parseNumber(serializeNumber({ type: 'number', value }))).toEqual({
      type: 'number',
      value,
    });
  });
});

describe('zero', () => {
  it.each([
    '0',
    '+0',
    '-0',
    '0.0',
    '.0',
    '0e0',
  ])('parses the literal zero %j', (input) => {
    expect(parseZero(input)).toEqual({
      type: 'number',
      value: 0,
    });
  });

  it.each([
    '',
    '1',
    '0%',
    '0px',
    '0 0',
  ])('rejects %j as a zero production', (input) => {
    expect(parseZero(input)).toBeNull();
  });

  it('consumes one literal zero from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('0.0 1'));

    expect(tryConsumeZero(c)).toEqual({
      type: 'number',
      value: 0,
    });
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a nonzero number', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1'));

    expect(tryConsumeZero(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('participates in number operations without a zero-specific operation', () => {
    const zero = parseZero('0');

    expect(zero).not.toBeNull();
    expect(addNumbers(
      zero!,
      { type: 'number', value: 2.5 },
    )).toEqual({ type: 'number', value: 2.5 });
  });
});

describe('dimension', () => {
  it.each([
    ['0px', 0, 'px'],
    ['+12em', 12, 'em'],
    ['-1.5s', -1.5, 's'],
    ['1e2Hz', 100, 'Hz'],
    ['2furlong', 2, 'furlong'],
    ['1\\70 x', 1, 'px'],
    ['1\\65 2', 1, 'e2'],
    ['1.2--fem', 1.2, '--fem'],
  ] as const)('parses %j as the dimension %d%s', (input, value, unit) => {
    expect(parseDimension(input)).toEqual({
      type: 'dimension',
      value,
      unit,
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parseDimension(' /* before */ -1.25rem /* after */ ')).toEqual({
      type: 'dimension',
      value: -1.25,
      unit: 'rem',
    });
  });

  it.each([
    '',
    '1',
    '1%',
    'px',
    '1 px',
    '1px 2px',
  ])('rejects %j as a dimension production', (input) => {
    expect(parseDimension(input)).toBeNull();
  });

  it('consumes one dimension from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1.25em 2s'));

    expect(tryConsumeDimension(c)).toEqual({
      type: 'dimension',
      value: 1.25,
      unit: 'em',
    });
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-dimension component', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1%'));

    expect(tryConsumeDimension(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('adds dimensions with exactly the same unit', () => {
    expect(addDimensions(
      { type: 'angle', value: 90, unit: 'deg' },
      { type: 'angle', value: 45, unit: 'deg' },
    )).toEqual({ type: 'angle', value: 135, unit: 'deg' });
  });

  it.each([
    [0, 10],
    [0.25, 15],
    [1, 30],
    [2, 50],
  ])('interpolates dimensions at p = %d', (p, expected) => {
    expect(interpolateDimensions(
      { type: 'angle', value: 10, unit: 'deg' },
      { type: 'angle', value: 30, unit: 'deg' },
      p,
    )).toEqual({ type: 'angle', value: expected, unit: 'deg' });
  });

  it('accumulates dimensions using addition', () => {
    expect(accumulateDimensions(
      { type: 'angle', value: 90, unit: 'deg' },
      { type: 'angle', value: 45, unit: 'deg' },
    )).toEqual({ type: 'angle', value: 135, unit: 'deg' });
  });

  it('rejects addition when units differ by case', () => {
    expect(() => addDimensions(
      { type: 'dimension', value: 1, unit: 'px' },
      { type: 'dimension', value: 2, unit: 'PX' },
    )).toThrow('Dimension units must match: px and PX');
  });

  it('rejects interpolation when units differ', () => {
    expect(() => interpolateDimensions(
      { type: 'dimension', value: 1, unit: 'px' },
      { type: 'dimension', value: 2, unit: 'em' },
      0.5,
    )).toThrow('Dimension units must match: px and em');
  });

  it.each([
    [{ type: 'dimension', value: 0, unit: 'px' }, '0px'],
    [{ type: 'dimension', value: -0, unit: 'px' }, '0px'],
    [{ type: 'dimension', value: 1.25, unit: 'em' }, '1.25em'],
    [{ type: 'dimension', value: 100, unit: 'Hz' }, '100Hz'],
    [{ type: 'dimension', value: 1, unit: '123' }, '1\\31 23'],
    [{ type: 'dimension', value: 1, unit: 'e2' }, '1\\65 2'],
    [{ type: 'dimension', value: 1, unit: 'E-2' }, '1\\45 -2'],
    [{ type: 'dimension', value: 1.2, unit: '--fem' }, '1.2--fem'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeDimension(value)).toBe(expected);
  });

  it.each([
    { type: 'dimension', value: 0, unit: 'px' },
    { type: 'dimension', value: 1.25, unit: 'em' },
    { type: 'dimension', value: -2.5, unit: 's' },
    { type: 'dimension', value: 1, unit: 'e2' },
    { type: 'dimension', value: 1.2, unit: '--fem' },
  ] as const)('round-trips the semantic dimension %j', (value) => {
    expect(parseDimension(serializeDimension(value))).toEqual(value);
  });
});

describe('percentage', () => {
  it.each([
    ['0%', 0],
    ['+12%', 12],
    ['-12%', -12],
    ['1.5%', 1.5],
    ['.5%', 0.5],
    ['1e2%', 100],
  ] as const)('parses %j as the percentage %d', (input, expected) => {
    expect(parsePercentage(input)).toEqual({
      type: 'percentage',
      value: expected,
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parsePercentage(' /* before */ -12.5% /* after */ ')).toEqual({
      type: 'percentage',
      value: -12.5,
    });
  });

  it.each([
    '',
    '1',
    '%',
    '1px',
    '1 %',
    '1% 2%',
  ])('rejects %j as a percentage production', (input) => {
    expect(parsePercentage(input)).toBeNull();
  });

  it('consumes one percentage from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('12.5% 25%'));

    expect(tryConsumePercentage(c)).toEqual({
      type: 'percentage',
      value: 12.5,
    });
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-percentage component', () => {
    const c = new ComponentCursor(parseListOfComponentValues('12.5'));

    expect(tryConsumePercentage(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([-10, 0, 125])('includes the numeric range boundary %d', (value) => {
    const c = new ComponentCursor(parseListOfComponentValues(`${value}%`));
    const consume = createPercentageConsumer({ min: -10, max: 125 });

    expect(consume(c)).toEqual({
      type: 'percentage',
      value,
    });
  });

  it.each([-10.1, 125.1])(
    'returns null without advancing for out-of-range value %d',
    (value) => {
      const c = new ComponentCursor(parseListOfComponentValues(`${value}%`));
      const consume = createPercentageConsumer({ min: -10, max: 125 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('adds percentages', () => {
    expect(addPercentages(
      { type: 'percentage', value: 25 },
      { type: 'percentage', value: -10 },
    )).toEqual({ type: 'percentage', value: 15 });
  });

  it.each([
    [0, 10],
    [0.25, 15],
    [1, 30],
    [2, 50],
  ])('interpolates percentages at p = %d', (p, expected) => {
    expect(interpolatePercentages(
      { type: 'percentage', value: 10 },
      { type: 'percentage', value: 30 },
      p,
    )).toEqual({ type: 'percentage', value: expected });
  });

  it('accumulates percentages using addition', () => {
    expect(accumulatePercentages(
      { type: 'percentage', value: 25 },
      { type: 'percentage', value: -10 },
    )).toEqual({ type: 'percentage', value: 15 });
  });

  it.each([
    [0, '0%'],
    [-0, '0%'],
    [12, '12%'],
    [-12.5, '-12.5%'],
    [0.1234565, '0.123457%'],
  ] as const)('serializes %d as %j', (value, expected) => {
    expect(serializePercentage({ type: 'percentage', value })).toBe(expected);
  });

  it.each([0, 12.5, -12.5, 0.000001])(
    'round-trips the semantic percentage %d',
    (value) => {
      expect(parsePercentage(serializePercentage({
        type: 'percentage',
        value,
      }))).toEqual({
        type: 'percentage',
        value,
      });
    },
  );
});

describe('length-percentage', () => {
  it.each([
    ['1px', { type: 'length', value: 1, unit: 'px' }],
    ['25%', { type: 'percentage', value: 25 }],
    ['0', { type: 'length', value: 0, unit: '' }],
  ] as const)('parses %j', (input, expected) => {
    expect(parseLengthPercentage(input)).toEqual(expected);
  });

  it.each(['', 'auto', '1', '1s', '1px 2px'])(
    'rejects %j as a length-percentage production',
    (input) => {
      expect(parseLengthPercentage(input)).toBeNull();
    },
  );

  it('consumes one length-percentage from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('25% 1px'));

    expect(tryConsumeLengthPercentage(c)).toEqual({
      type: 'percentage',
      value: 25,
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['0', '1em', '150%'])(
    'applies a nonnegative range to either alternative for %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createLengthPercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1em', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createLengthPercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createLengthPercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Length-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it('resolves a percentage using its canonical length basis', () => {
    expect(tryResolveLengthPercentage(
      { type: 'percentage', value: 25 },
      { percentageBasis: 200 },
    )).toEqual({
      type: 'length',
      value: 50,
      unit: 'px',
    });
  });

  it('resolves a length using the length resolution context', () => {
    expect(tryResolveLengthPercentage(
      { type: 'length', value: 2, unit: 'em' },
      { em: 16 },
    )).toEqual({
      type: 'length',
      value: 32,
      unit: 'px',
    });
  });

  it('returns null when the required resolution input is missing', () => {
    expect(tryResolveLengthPercentage({
      type: 'percentage',
      value: 25,
    })).toBeNull();
    expect(tryResolveLengthPercentage({
      type: 'length',
      value: 2,
      unit: 'em',
    })).toBeNull();
  });

  it.each([
    [{ type: 'length', value: 1.5, unit: 'rem' }, '1.5rem'],
    [{ type: 'percentage', value: -10 }, '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeLengthPercentage(value)).toBe(expected);
  });

  it('combines values from matching alternatives', () => {
    expect(tryAddLengthPercentages(
      { type: 'length', value: 10, unit: 'px' },
      { type: 'length', value: 5, unit: 'px' },
    )).toEqual({ type: 'length', value: 15, unit: 'px' });
    expect(tryInterpolateLengthPercentages(
      { type: 'percentage', value: 10 },
      { type: 'percentage', value: 30 },
      0.25,
    )).toEqual({ type: 'percentage', value: 15 });
    expect(tryAccumulateLengthPercentages(
      { type: 'length', value: 10, unit: 'px' },
      { type: 'length', value: 5, unit: 'px' },
    )).toEqual({ type: 'length', value: 15, unit: 'px' });
  });

  it('does not combine different alternatives or dimension units', () => {
    expect(tryAddLengthPercentages(
      { type: 'length', value: 10, unit: 'px' },
      { type: 'percentage', value: 0 },
    )).toBeNull();
    expect(tryAddLengthPercentages(
      { type: 'length', value: 0, unit: 'px' },
      { type: 'percentage', value: 20 },
    )).toBeNull();
    expect(tryInterpolateLengthPercentages(
      { type: 'length', value: 1, unit: 'em' },
      { type: 'length', value: 16, unit: 'px' },
      0.5,
    )).toBeNull();
  });
});

describe('angle-percentage', () => {
  it.each([
    ['90deg', { type: 'angle', value: 90, unit: 'deg' }],
    ['25%', { type: 'percentage', value: 25 }],
  ] as const)('parses %j', (input, expected) => {
    expect(parseAnglePercentage(input)).toEqual(expected);
  });

  it.each(['', '0', '1', 'auto', '1px', '1deg 25%'])(
    'rejects %j as an angle-percentage production',
    (input) => {
      expect(parseAnglePercentage(input)).toBeNull();
    },
  );

  it('consumes one angle-percentage from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('25% 90deg'));

    expect(tryConsumeAnglePercentage(c)).toEqual({
      type: 'percentage',
      value: 25,
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['1deg', '150%'])(
    'accepts the nonnegative angle-percentage %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createAnglePercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1deg', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createAnglePercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createAnglePercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Angle-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [{ type: 'angle', value: 0.25, unit: 'turn' }, {}, 90],
    [{ type: 'percentage', value: 25 }, { percentageBasis: 360 }, 90],
  ] as const)('resolves %j to %ddeg', (value, context, expected) => {
    expect(tryResolveAnglePercentage(value, context)).toEqual({
      type: 'angle',
      value: expected,
      unit: 'deg',
    });
  });

  it('returns null when the percentage basis is missing', () => {
    expect(tryResolveAnglePercentage({
      type: 'percentage',
      value: 25,
    })).toBeNull();
  });

  it.each([
    [{ type: 'angle', value: 0.5, unit: 'turn' }, '0.5turn'],
    [{ type: 'percentage', value: -10 }, '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeAnglePercentage(value)).toBe(expected);
  });

  it('combines matching alternatives and rejects mismatches', () => {
    expect(tryAddAnglePercentages(
      { type: 'angle', value: 10, unit: 'deg' },
      { type: 'angle', value: 20, unit: 'deg' },
    )).toEqual({ type: 'angle', value: 30, unit: 'deg' });
    expect(tryInterpolateAnglePercentages(
      { type: 'percentage', value: 20 },
      { type: 'percentage', value: 60 },
      0.5,
    )).toEqual({ type: 'percentage', value: 40 });
    expect(tryAccumulateAnglePercentages(
      { type: 'angle', value: 10, unit: 'deg' },
      { type: 'angle', value: 20, unit: 'deg' },
    )).toEqual({ type: 'angle', value: 30, unit: 'deg' });
    expect(tryAddAnglePercentages(
      { type: 'angle', value: 10, unit: 'deg' },
      { type: 'percentage', value: 20 },
    )).toBeNull();
  });
});

describe('frequency-percentage', () => {
  it.each([
    ['1khz', { type: 'frequency', value: 1, unit: 'khz' }],
    ['25%', { type: 'percentage', value: 25 }],
  ] as const)('parses %j', (input, expected) => {
    expect(parseFrequencyPercentage(input)).toEqual(expected);
  });

  it.each(['', '0', '1', 'auto', '1s', '1khz 25%'])(
    'rejects %j as a frequency-percentage production',
    (input) => {
      expect(parseFrequencyPercentage(input)).toBeNull();
    },
  );

  it('consumes one frequency-percentage from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('25% 1khz'));

    expect(tryConsumeFrequencyPercentage(c)).toEqual({
      type: 'percentage',
      value: 25,
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['1hz', '150%'])(
    'accepts the nonnegative frequency-percentage %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createFrequencyPercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1hz', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createFrequencyPercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createFrequencyPercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Frequency-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [{ type: 'frequency', value: 1.5, unit: 'khz' }, {}, 1500],
    [{ type: 'percentage', value: 25 }, { percentageBasis: 2000 }, 500],
  ] as const)('resolves %j to %dhz', (value, context, expected) => {
    expect(tryResolveFrequencyPercentage(value, context)).toEqual({
      type: 'frequency',
      value: expected,
      unit: 'hz',
    });
  });

  it('returns null when the percentage basis is missing', () => {
    expect(tryResolveFrequencyPercentage({
      type: 'percentage',
      value: 25,
    })).toBeNull();
  });

  it.each([
    [{ type: 'frequency', value: 1.5, unit: 'khz' }, '1.5khz'],
    [{ type: 'percentage', value: -10 }, '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeFrequencyPercentage(value)).toBe(expected);
  });

  it('combines matching alternatives and rejects mismatches', () => {
    expect(tryAddFrequencyPercentages(
      { type: 'percentage', value: 10 },
      { type: 'percentage', value: 15 },
    )).toEqual({ type: 'percentage', value: 25 });
    expect(tryInterpolateFrequencyPercentages(
      { type: 'frequency', value: 100, unit: 'hz' },
      { type: 'frequency', value: 300, unit: 'hz' },
      0.5,
    )).toEqual({ type: 'frequency', value: 200, unit: 'hz' });
    expect(tryAccumulateFrequencyPercentages(
      { type: 'percentage', value: 10 },
      { type: 'percentage', value: 15 },
    )).toEqual({ type: 'percentage', value: 25 });
    expect(tryAddFrequencyPercentages(
      { type: 'frequency', value: 1, unit: 'khz' },
      { type: 'frequency', value: 100, unit: 'hz' },
    )).toBeNull();
  });
});

describe('time-percentage', () => {
  it.each([
    ['250ms', { type: 'time', value: 250, unit: 'ms' }],
    ['25%', { type: 'percentage', value: 25 }],
  ] as const)('parses %j', (input, expected) => {
    expect(parseTimePercentage(input)).toEqual(expected);
  });

  it.each(['', '0', '1', 'auto', '1deg', '1s 25%'])(
    'rejects %j as a time-percentage production',
    (input) => {
      expect(parseTimePercentage(input)).toBeNull();
    },
  );

  it('consumes one time-percentage from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('25% 1s'));

    expect(tryConsumeTimePercentage(c)).toEqual({
      type: 'percentage',
      value: 25,
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['1s', '150%'])(
    'accepts the nonnegative time-percentage %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createTimePercentageConsumer({ min: 0 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['-1s', '-10%'])(
    'returns null without advancing for the negative value %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createTimePercentageConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createTimePercentageConsumer({ min: 10, max: 100 })).toThrow(
      'Time-percentage ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [{ type: 'time', value: 250, unit: 'ms' }, {}, 0.25],
    [{ type: 'percentage', value: 25 }, { percentageBasis: 2 }, 0.5],
  ] as const)('resolves %j to %ds', (value, context, expected) => {
    expect(tryResolveTimePercentage(value, context)).toEqual({
      type: 'time',
      value: expected,
      unit: 's',
    });
  });

  it('returns null when the percentage basis is missing', () => {
    expect(tryResolveTimePercentage({
      type: 'percentage',
      value: 25,
    })).toBeNull();
  });

  it.each([
    [{ type: 'time', value: 250, unit: 'ms' }, '250ms'],
    [{ type: 'percentage', value: -10 }, '-10%'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeTimePercentage(value)).toBe(expected);
  });

  it('combines matching alternatives and rejects mismatches', () => {
    expect(tryAddTimePercentages(
      { type: 'time', value: 1, unit: 's' },
      { type: 'time', value: 2, unit: 's' },
    )).toEqual({ type: 'time', value: 3, unit: 's' });
    expect(tryInterpolateTimePercentages(
      { type: 'percentage', value: 25 },
      { type: 'percentage', value: 75 },
      0.5,
    )).toEqual({ type: 'percentage', value: 50 });
    expect(tryAccumulateTimePercentages(
      { type: 'time', value: 1, unit: 's' },
      { type: 'time', value: 2, unit: 's' },
    )).toEqual({ type: 'time', value: 3, unit: 's' });
    expect(tryInterpolateTimePercentages(
      { type: 'time', value: 1, unit: 's' },
      { type: 'percentage', value: 100 },
      0.5,
    )).toBeNull();
  });
});

describe('ratio', () => {
  it.each([
    ['3 / 2', { type: 'ratio', numerator: 3, denominator: 2 }],
    ['3/2', { type: 'ratio', numerator: 3, denominator: 2 }],
    ['1.5 / 2.5', { type: 'ratio', numerator: 1.5, denominator: 2.5 }],
    ['3', { type: 'ratio', numerator: 3, denominator: 1 }],
    ['0 / 0', { type: 'ratio', numerator: 0, denominator: 0 }],
  ] as const)('parses %j', (input, expected) => {
    expect(parseRatio(input)).toEqual(expected);
  });

  it('accepts surrounding and component trivia', () => {
    expect(parseRatio(' /* before */ 3 /* middle */ / 2 /* after */ ')).toEqual({
      type: 'ratio',
      numerator: 3,
      denominator: 2,
    });
  });

  it.each([
    '',
    '-1',
    '1 / -2',
    '/ 2',
    '1 /',
    '1 / 2 / 3',
    '1 2',
    '1px / 2',
  ])('rejects %j as a ratio production', (input) => {
    expect(parseRatio(input)).toBeNull();
  });

  it('consumes one ratio from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('3/2 4'));

    expect(tryConsumeRatio(c)).toEqual({
      type: 'ratio',
      numerator: 3,
      denominator: 2,
    });
    expect(c.pos()).toBe(3);
  });

  it('defaults an omitted denominator while leaving the next component', () => {
    const c = new ComponentCursor(parseListOfComponentValues('3 4'));

    expect(tryConsumeRatio(c)).toEqual({
      type: 'ratio',
      numerator: 3,
      denominator: 1,
    });
    expect(c.pos()).toBe(1);
  });

  it.each([
    [{ type: 'ratio', numerator: 0, denominator: 1 }, true],
    [{ type: 'ratio', numerator: 1, denominator: 0 }, true],
    [{ type: 'ratio', numerator: Infinity, denominator: 1 }, true],
    [{ type: 'ratio', numerator: 1, denominator: Infinity }, true],
    [{ type: 'ratio', numerator: 16, denominator: 9 }, false],
  ] as const)('identifies whether %j is degenerate', (value, expected) => {
    expect(isDegenerateRatio(value)).toBe(expected);
  });

  it.each([
    [{ type: 'ratio', numerator: 3, denominator: 2 }, '3 / 2'],
    [{ type: 'ratio', numerator: 3, denominator: 1 }, '3 / 1'],
    [{ type: 'ratio', numerator: 1.5, denominator: 2.25 }, '1.5 / 2.25'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeRatio(value)).toBe(expected);
  });

  it('interpolates the logarithms of the resolved ratios', () => {
    const result = interpolateRatios(
      { type: 'ratio', numerator: 5, denominator: 1 },
      { type: 'ratio', numerator: 3, denominator: 2 },
      0.5,
    );

    expect(result.type).toBe('ratio');
    expect(result.numerator).toBeCloseTo(Math.sqrt(7.5));
    expect(result.denominator).toBe(1);
  });

  it.each([
    [
      { type: 'ratio', numerator: 0, denominator: 1 },
      { type: 'ratio', numerator: 1, denominator: 1 },
    ],
    [
      { type: 'ratio', numerator: 1, denominator: 1 },
      { type: 'ratio', numerator: 1, denominator: Infinity },
    ],
  ] as const)('does not interpolate a degenerate ratio', (a, b) => {
    expect(() => interpolateRatios(a, b, 0.5)).toThrow(
      'Degenerate ratios cannot be interpolated',
    );
  });

  it.each([
    { type: 'ratio', numerator: 3, denominator: 2 },
    { type: 'ratio', numerator: 1.5, denominator: 1 },
    { type: 'ratio', numerator: 0, denominator: 4 },
  ] as const)('round-trips the semantic ratio %j', (value) => {
    expect(parseRatio(serializeRatio(value))).toEqual(value);
  });
});

// Distance units

describe('length', () => {
  const resolve = (
    input: string,
    context: LengthResolutionContext = {},
  ) => {
    const value = parseLength(input);

    if (value === null) {
      throw new Error(`Invalid length test input: ${input}`);
    }

    return tryResolveLength(value, context);
  };

  it.each(LENGTH_UNITS)('parses the %s length unit', (unit) => {
    expect(parseLength(`1${unit}`)).toEqual({
      type: 'length',
      value: 1,
      unit,
    });
  });

  it.each([
    ['+1.25PX', 1.25, 'px'],
    ['-2Q', -2, 'q'],
    ['1\\72 cap', 1, 'rcap'],
    ['1CQMAX', 1, 'cqmax'],
  ] as const)('normalizes the unit in %j to %j', (input, value, unit) => {
    expect(parseLength(input)).toEqual({
      type: 'length',
      value,
      unit,
    });
  });

  it.each([
    '0',
    '+0',
    '-0',
    '0.0',
    '.0',
    '0e0',
  ])('parses unitless zero %j as a length', (input) => {
    expect(parseLength(input)).toEqual({
      type: 'length',
      value: 0,
      unit: '',
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parseLength(' /* before */ -1.25rem /* after */ ')).toEqual({
      type: 'length',
      value: -1.25,
      unit: 'rem',
    });
  });

  it.each([
    '',
    '1',
    '1%',
    '1s',
    '1fr',
    '1furlong',
    '1 px',
    '1px 2px',
  ])('rejects %j as a length production', (input) => {
    expect(parseLength(input)).toBeNull();
  });

  it('consumes one length from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1.25em 2px'));

    expect(tryConsumeLength(c)).toEqual({
      type: 'length',
      value: 1.25,
      unit: 'em',
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['1s', '1', '1%'])(
    'returns null without advancing for %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));

      expect(tryConsumeLength(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    ['0', 0, ''],
    ['1em', 1, 'em'],
    ['1vw', 1, 'vw'],
  ] as const)(
    'accepts the nonnegative length %j without resolving it',
    (input, value, unit) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createLengthConsumer({ min: 0 });

      expect(consume(c)).toEqual({
        type: 'length',
        value,
        unit,
      });
    },
  );

  it.each(['-1px', '-1em', '-1vw'])(
    'returns null without advancing for the negative length %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createLengthConsumer({ min: 0 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it('rejects finite nonzero range bounds until they can be deferred', () => {
    expect(() => createLengthConsumer({ min: 96, max: 192 })).toThrow(
      'Length ranges with finite nonzero bounds are not yet supported',
    );
  });

  it.each([
    [{ type: 'length', value: 0, unit: '' }, '0'],
    [{ type: 'length', value: 0, unit: 'px' }, '0px'],
    [{ type: 'length', value: -0, unit: 'em' }, '0em'],
    [{ type: 'length', value: 1.25, unit: 'rem' }, '1.25rem'],
    [{ type: 'length', value: -2, unit: 'q' }, '-2q'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeLength(value)).toBe(expected);
  });

  it.each([
    [{ type: 'length', value: 0, unit: '' }, 0],
    [{ type: 'length', value: 1, unit: 'px' }, 1],
    [{ type: 'length', value: 1, unit: 'in' }, 96],
    [{ type: 'length', value: 2.54, unit: 'cm' }, 96],
    [{ type: 'length', value: 25.4, unit: 'mm' }, 96],
    [{ type: 'length', value: 101.6, unit: 'q' }, 96],
    [{ type: 'length', value: 72, unit: 'pt' }, 96],
    [{ type: 'length', value: 6, unit: 'pc' }, 96],
  ] as const)('resolves the absolute length %j to %dpx', (value, expected) => {
    expect(tryResolveLength(value)).toEqual({
      type: 'length',
      value: expected,
      unit: 'px',
    });
  });

  it('resolves font-relative lengths from their effective reference lengths', () => {
    const context = {
      em: 10,
      rem: 11,
      ex: 12,
      rex: 13,
      cap: 14,
      rcap: 15,
      ch: 16,
      rch: 17,
      ic: 18,
      ric: 19,
      lh: 20,
      rlh: 21,
    } satisfies LengthResolutionContext;

    for (const [unit, pixelsPerUnit] of Object.entries(context)) {
      expect(resolve(`2${unit}`, context)).toEqual({
        type: 'length',
        value: 2 * pixelsPerUnit,
        unit: 'px',
      });
    }
  });

  it('resolves physical and logical viewport-relative lengths', () => {
    const context = {
      smallViewportWidth: 300,
      smallViewportHeight: 600,
      largeViewportWidth: 400,
      largeViewportHeight: 800,
      dynamicViewportWidth: 350,
      dynamicViewportHeight: 700,
      viewportInlineAxis: 'vertical',
    } satisfies LengthResolutionContext;
    const expected = {
      '2vw': 8,
      '2lvh': 16,
      '2svmin': 6,
      '2svmax': 12,
      '2dvi': 14,
      '2dvb': 7,
    };

    for (const [input, value] of Object.entries(expected)) {
      expect(resolve(input, context)).toEqual({
        type: 'length',
        value,
        unit: 'px',
      });
    }
  });

  it('resolves physical and logical container-relative lengths', () => {
    const context = {
      containerWidth: 500,
      containerHeight: 200,
      containerInlineSize: 300,
      containerBlockSize: 700,
    } satisfies LengthResolutionContext;
    const expected = {
      '2cqw': 10,
      '2cqh': 4,
      '2cqi': 6,
      '2cqb': 14,
      '2cqmin': 6,
      '2cqmax': 14,
    };

    for (const [input, value] of Object.entries(expected)) {
      expect(resolve(input, context)).toEqual({
        type: 'length',
        value,
        unit: 'px',
      });
    }
  });

  it('returns null when contextual resolution data is missing', () => {
    expect(resolve('1em')).toBeNull();
    expect(resolve('1vi', {
      largeViewportWidth: 400,
      largeViewportHeight: 800,
    })).toBeNull();
    expect(resolve('1cqw')).toBeNull();
  });

  it('serializes a canonical length in pixels', () => {
    expect(serializeCanonicalLength({
      type: 'length',
      value: 12.5,
      unit: 'px',
    })).toBe('12.5px');
  });

  it.each([
    [0, 0],
    [0.5, 0.5],
    [0.25, 0.5],
    [-0.25, -0.5],
    [0.75, 0.5],
    [-0.75, -0.5],
    [1.25, 1],
  ])('snaps %dpx as a line width to %dpx', (input, expected) => {
    expect(snapLengthAsLineWidth(
      { type: 'length', value: input, unit: 'px' },
      2,
    )).toEqual({
      type: 'length',
      value: expected,
      unit: 'px',
    });
  });

  it.each([
    { type: 'length', value: 0, unit: '' },
    { type: 'length', value: 0, unit: 'px' },
    { type: 'length', value: 1.25, unit: 'em' },
    { type: 'length', value: -2.5, unit: 'cqmax' },
  ] as const)('round-trips the semantic length %j', (value) => {
    expect(parseLength(serializeLength(value))).toEqual(value);
  });
});

// Other quantities

describe('angle', () => {
  it.each(ANGLE_UNITS)('parses the %s angle unit', (unit) => {
    expect(parseAngle(`1${unit}`)).toEqual({
      type: 'angle',
      value: 1,
      unit,
    });
  });

  it('normalizes angle units to ASCII lowercase', () => {
    expect(parseAngle('-1.25TuRn')).toEqual({
      type: 'angle',
      value: -1.25,
      unit: 'turn',
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parseAngle(' /* before */ 100grad /* after */ ')).toEqual({
      type: 'angle',
      value: 100,
      unit: 'grad',
    });
  });

  it.each([
    '',
    '0',
    '1',
    '1%',
    '1px',
    '1deg 2deg',
  ])('rejects %j as an angle production', (input) => {
    expect(parseAngle(input)).toBeNull();
  });

  it('consumes one angle from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('0.25turn 90deg'));

    expect(tryConsumeAngle(c)).toEqual({
      type: 'angle',
      value: 0.25,
      unit: 'turn',
    });
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-angle dimension', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1px'));

    expect(tryConsumeAngle(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([
    '100grad',
    `${Math.PI}rad`,
    '0.5turn',
  ])('accepts the angle %j within a canonical range', (input) => {
    const c = new ComponentCursor(parseListOfComponentValues(input));
    const consume = createAngleConsumer({ min: 90, max: 180 });

    expect(consume(c)).not.toBeNull();
    expect(c.pos()).toBe(1);
  });

  it.each(['0.2turn', '4rad'])(
    'returns null without advancing for the out-of-range angle %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createAngleConsumer({ min: 90, max: 180 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    [{ type: 'angle', value: 90, unit: 'deg' }, 90],
    [{ type: 'angle', value: 100, unit: 'grad' }, 90],
    [{ type: 'angle', value: Math.PI, unit: 'rad' }, 180],
    [{ type: 'angle', value: 0.5, unit: 'turn' }, 180],
  ] as const)('canonicalizes %j as %ddeg', (value, expected) => {
    expect(canonicalizeAngle(value)).toEqual({
      type: 'angle',
      value: expected,
      unit: 'deg',
    });
  });

  it.each([
    [{ type: 'angle', value: 0, unit: 'deg' }, '0deg'],
    [{ type: 'angle', value: -1.25, unit: 'rad' }, '-1.25rad'],
    [{ type: 'angle', value: 0.5, unit: 'turn' }, '0.5turn'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeAngle(value)).toBe(expected);
  });

  it('serializes a canonical angle in degrees', () => {
    expect(serializeCanonicalAngle({
      type: 'angle',
      value: 90,
      unit: 'deg',
    })).toBe('90deg');
  });

  it.each([
    { type: 'angle', value: 90, unit: 'deg' },
    { type: 'angle', value: -100, unit: 'grad' },
    { type: 'angle', value: 0.5, unit: 'turn' },
  ] as const)('round-trips the semantic angle %j', (value) => {
    expect(parseAngle(serializeAngle(value))).toEqual(value);
  });
});

describe('time', () => {
  it.each(TIME_UNITS)('parses the %s time unit', (unit) => {
    expect(parseTime(`1${unit}`)).toEqual({
      type: 'time',
      value: 1,
      unit,
    });
  });

  it('normalizes time units to ASCII lowercase', () => {
    expect(parseTime('-250MS')).toEqual({
      type: 'time',
      value: -250,
      unit: 'ms',
    });
  });

  it('accepts surrounding trivia', () => {
    expect(parseTime(' /* before */ 1.5s /* after */ ')).toEqual({
      type: 'time',
      value: 1.5,
      unit: 's',
    });
  });

  it.each(['', '0', '1', '1%', '1deg', '1s 2s'])(
    'rejects %j as a time production',
    (input) => {
      expect(parseTime(input)).toBeNull();
    },
  );

  it('consumes one time from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('250ms 1s'));

    expect(tryConsumeTime(c)).toEqual({
      type: 'time',
      value: 250,
      unit: 'ms',
    });
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for a non-time dimension', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1deg'));

    expect(tryConsumeTime(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each(['500ms', '2s'])(
    'accepts the time %j within a canonical range',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createTimeConsumer({ min: 0.5, max: 2 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['499ms', '2.001s'])(
    'returns null without advancing for the out-of-range time %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createTimeConsumer({ min: 0.5, max: 2 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    [{ type: 'time', value: 2, unit: 's' }, 2],
    [{ type: 'time', value: 250, unit: 'ms' }, 0.25],
  ] as const)('canonicalizes %j as %ds', (value, expected) => {
    expect(canonicalizeTime(value)).toEqual({
      type: 'time',
      value: expected,
      unit: 's',
    });
  });

  it.each([
    [{ type: 'time', value: 0, unit: 's' }, '0s'],
    [{ type: 'time', value: -250, unit: 'ms' }, '-250ms'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeTime(value)).toBe(expected);
  });

  it('serializes a canonical time in seconds', () => {
    expect(serializeCanonicalTime({
      type: 'time',
      value: 1.5,
      unit: 's',
    })).toBe('1.5s');
  });

  it.each([
    { type: 'time', value: 1.5, unit: 's' },
    { type: 'time', value: -250, unit: 'ms' },
  ] as const)('round-trips the semantic time %j', (value) => {
    expect(parseTime(serializeTime(value))).toEqual(value);
  });
});

describe('frequency', () => {
  it.each(FREQUENCY_UNITS)('parses the %s frequency unit', (unit) => {
    expect(parseFrequency(`1${unit}`)).toEqual({
      type: 'frequency',
      value: 1,
      unit,
    });
  });

  it('normalizes frequency units to ASCII lowercase', () => {
    expect(parseFrequency('6kHz')).toEqual({
      type: 'frequency',
      value: 6,
      unit: 'khz',
    });
  });

  it.each(['', '0', '1', '1%', '1s', '1hz 2hz'])(
    'rejects %j as a frequency production',
    (input) => {
      expect(parseFrequency(input)).toBeNull();
    },
  );

  it('consumes one frequency from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('1khz 500hz'));

    expect(tryConsumeFrequency(c)).toEqual({
      type: 'frequency',
      value: 1,
      unit: 'khz',
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['1000hz', '2khz'])(
    'accepts the frequency %j within a canonical range',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createFrequencyConsumer({ min: 1000, max: 2000 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it('returns null without advancing for an out-of-range frequency', () => {
    const c = new ComponentCursor(parseListOfComponentValues('0.5khz'));
    const consume = createFrequencyConsumer({ min: 1000 });

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it.each([
    [{ type: 'frequency', value: 500, unit: 'hz' }, 500],
    [{ type: 'frequency', value: 1.5, unit: 'khz' }, 1500],
  ] as const)('canonicalizes %j as %dhz', (value, expected) => {
    expect(canonicalizeFrequency(value)).toEqual({
      type: 'frequency',
      value: expected,
      unit: 'hz',
    });
  });

  it.each([
    [{ type: 'frequency', value: 200, unit: 'hz' }, '200hz'],
    [{ type: 'frequency', value: 6, unit: 'khz' }, '6khz'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeFrequency(value)).toBe(expected);
  });

  it('serializes a canonical frequency in hertz', () => {
    expect(serializeCanonicalFrequency({
      type: 'frequency',
      value: 500,
      unit: 'hz',
    })).toBe('500hz');
  });

  it.each([
    { type: 'frequency', value: 200, unit: 'hz' },
    { type: 'frequency', value: 6, unit: 'khz' },
  ] as const)('round-trips the semantic frequency %j', (value) => {
    expect(parseFrequency(serializeFrequency(value))).toEqual(value);
  });
});

describe('resolution', () => {
  it.each(RESOLUTION_UNITS)('parses the %s resolution unit', (unit) => {
    expect(parseResolution(`1${unit}`)).toEqual({
      type: 'resolution',
      value: 1,
      unit,
    });
  });

  it('normalizes resolution units to ASCII lowercase', () => {
    expect(parseResolution('96DPI')).toEqual({
      type: 'resolution',
      value: 96,
      unit: 'dpi',
    });
  });

  it('accepts zero resolution with a unit', () => {
    expect(parseResolution('0x')).toEqual({
      type: 'resolution',
      value: 0,
      unit: 'x',
    });
  });

  it.each(['', '0', '1', '1%', '1hz', '1dpi 2dpi'])(
    'rejects %j as a resolution production',
    (input) => {
      expect(parseResolution(input)).toBeNull();
    },
  );

  it.each(['-1dpi', '-1dpcm', '-1dppx', '-1x'])(
    'rejects the negative resolution %j',
    (input) => {
      expect(parseResolution(input)).toBeNull();
    },
  );

  it('consumes one resolution from the current cursor position', () => {
    const c = new ComponentCursor(parseListOfComponentValues('2dppx 96dpi'));

    expect(tryConsumeResolution(c)).toEqual({
      type: 'resolution',
      value: 2,
      unit: 'dppx',
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['96dpi', '1dppx', '2x'])(
    'accepts the resolution %j within a canonical range',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createResolutionConsumer({ min: 1, max: 2 });

      expect(consume(c)).not.toBeNull();
      expect(c.pos()).toBe(1);
    },
  );

  it.each(['95dpi', '2.1x'])(
    'returns null without advancing for the out-of-range resolution %j',
    (input) => {
      const c = new ComponentCursor(parseListOfComponentValues(input));
      const consume = createResolutionConsumer({ min: 1, max: 2 });

      expect(consume(c)).toBeNull();
      expect(c.pos()).toBe(0);
    },
  );

  it.each([
    [{ type: 'resolution', value: 96, unit: 'dpi' }, 1],
    [{ type: 'resolution', value: 96 / 2.54, unit: 'dpcm' }, 1],
    [{ type: 'resolution', value: 2, unit: 'dppx' }, 2],
    [{ type: 'resolution', value: 2, unit: 'x' }, 2],
  ] as const)('canonicalizes %j as %ddppx', (value, expected) => {
    expect(canonicalizeResolution(value)).toEqual({
      type: 'resolution',
      value: expected,
      unit: 'dppx',
    });
  });

  it.each([
    [{ type: 'resolution', value: 96, unit: 'dpi' }, '96dpi'],
    [{ type: 'resolution', value: 2, unit: 'x' }, '2x'],
  ] as const)('serializes %j as %j', (value, expected) => {
    expect(serializeResolution(value)).toBe(expected);
  });

  it('serializes a canonical resolution in dots per CSS pixel', () => {
    expect(serializeCanonicalResolution({
      type: 'resolution',
      value: 2,
      unit: 'dppx',
    })).toBe('2dppx');
  });

  it.each([
    { type: 'resolution', value: 96, unit: 'dpi' },
    { type: 'resolution', value: 37.5, unit: 'dpcm' },
    { type: 'resolution', value: 2, unit: 'dppx' },
    { type: 'resolution', value: 2, unit: 'x' },
  ] as const)('round-trips the semantic resolution %j', (value) => {
    expect(parseResolution(serializeResolution(value))).toEqual(value);
  });
});

// Data types defined elsewhere

// Functional notations

// Mathematical expressions

// Selector microsyntaxes

describe('An+B', () => {
  it.each([
    [{ a: 0, b: 3 }, '3'],
    [{ a: 1, b: 0 }, 'n'],
    [{ a: -1, b: 3 }, '-n+3'],
    [{ a: 2, b: -1 }, '2n-1'],
    [{ a: -2, b: 0 }, '-2n'],
    [{ a: 0, b: -0 }, '0'],
  ] as const)('serializes %j as %s', (value, expected) => {
    expect(serializeAnPlusB(value)).toBe(expected);
  });
});

// Property values

// This is unfinished!! we'll come back to it later. promise.
describe.skip('animation-name', () => {
  const animationName = (...values: unknown[]) => ({
    type: 'animation-name',
    values,
  });

  const none = () => ({ type: 'none' });
  const customIdent = (value: string) => ({ type: 'custom-ident', value });
  const stringValue = (value: string) => ({ type: 'string', value });

  function valueOf(css: string): unknown {
    const sheet = parseStylesheet(`.foo { ${css} }`);
    const rule = sheet.rules[0] as StyleRuleAst | undefined;

    const item = rule?.block.items[0];

    if (item?.kind !== BlockItemAstKind.Declaration) {
      return undefined;
    }

    return item.value;
  }

  it('parses none', () => {
    expect(valueOf('animation-name: none;')).toMatchObject(
      animationName(none()),
    );
  });

  it('parses a custom ident keyframes name', () => {
    expect(valueOf('animation-name: fade-in;')).toMatchObject(
      animationName(customIdent('fade-in')),
    );
  });

  it('parses a string keyframes name', () => {
    expect(valueOf('animation-name: "fade-in";')).toMatchObject(
      animationName(stringValue('fade-in')),
    );
  });

  it('parses comma-separated animation names', () => {
    expect(valueOf('animation-name: fade-in, "slide", none;')).toMatchObject(
      animationName(
        customIdent('fade-in'),
        stringValue('slide'),
        none(),
      ),
    );
  });

  it('drops invalid animation-name declarations', () => {
    const cases = [
      'animation-name: ;',
      'animation-name: 1;',
      'animation-name: 1px;',
      'animation-name: var(--x);',
      'animation-name: fade-in,;',
      'animation-name: fade-in,, slide;',
    ];

    for (const css of cases) {
      expect(valueOf(css)).toBeUndefined();
    }
  });
});

describe('opacity values', () => {
  it.each([
    ['0.5', { type: 'number', value: 0.5 }],
    ['50%', { type: 'number', value: 0.5 }],
  ] as const)('parses and normalizes the literal opacity value %s', (input, expected) => {
    expect(parseOpacityValue(input)).toEqual(expected);
  });

  it.each([
    ['calc(0.25 + 0.25)', 'number'],
    ['calc(25% + 25%)', 'percentage'],
  ] as const)('parses the calculated opacity value %s', (input, expectedType) => {
    expect(parseOpacityValue(input)).toMatchObject({
      type: 'math',
      valueType: expectedType,
    });
  });

  it.each([
    'auto',
    '1px',
    'calc(1px)',
    '0.5 1',
  ])('rejects the invalid opacity value %s', (input) => {
    expect(parseOpacityValue(input)).toBeNull();
  });

  it('normalizes literal opacity percentages without early clamping', () => {
    const number = parseOpacityValue('2')!;
    const percentage = { type: 'percentage', value: 200 } as const;

    expect(resolveOpacityValue(number, ValueStage.Specified))
      .toEqual(number);
    expect(resolveOpacityValue(percentage, ValueStage.Specified))
      .toEqual(number);
  });

  it.each([
    ['-1', 0],
    ['0.5', 0.5],
    ['2', 1],
    ['-100%', 0],
    ['50%', 0.5],
    ['200%', 1],
  ] as const)(
    'converts and clamps the computed opacity value %s',
    (input, expected) => {
      expect(resolveOpacityValue(
        parseOpacityValue(input)!,
        ValueStage.Computed,
      )).toEqual({
        type: 'number',
        value: expected,
      });
    },
  );

  it.each([
    ['calc(-1)', 0],
    ['calc(0.25 + 0.25)', 0.5],
    ['calc(2)', 1],
    ['calc(-100%)', 0],
    ['calc(25% + 25%)', 0.5],
    ['calc(200%)', 1],
    ['clamp(50%, 60%, 70%)', 0.6],
    ['max(0, 0.5)', 0.5],
  ] as const)(
    'resolves and clamps the computed opacity value %s',
    (input, expected) => {
      expect(resolveOpacityValue(
        parseOpacityValue(input)!,
        ValueStage.Computed,
      )).toEqual({
        type: 'number',
        value: expected,
      });
    },
  );

  it('uses the caller math-unwrapping policy', () => {
    const value = parseOpacityValue('calc(0.25 + 0.25)')!;

    expect(resolveOpacityValue(value, ValueStage.Computed, {
      unwrapMathAt: ValueStage.Used,
    })).toMatchObject({
      type: 'math',
    });
    expect(resolveOpacityValue(value, ValueStage.Computed, {
      unwrapMathAt: ValueStage.Computed,
    })).toEqual({
      type: 'number',
      value: 0.5,
    });
  });

  it.each([
    ['0', '0'],
    ['0.5', '0.5'],
    ['-1', '-1'],
    ['2', '2'],
    ['0%', '0'],
    ['1%', '0.01'],
    ['50%', '0.5'],
    ['100%', '1'],
    ['-100%', '-1'],
    ['200%', '2'],
    ['0.00005%', '0.000001'],
    ['-0.00005%', '0'],
  ] as const)('serializes the specified opacity value %s as %s', (
    input,
    expected,
  ) => {
    expect(serializeOpacityValue(parseOpacityValue(input)!))
      .toBe(expected);
  });

  it.each([
    ['calc(0.25 + 0.25)', 'calc(0.5)'],
    ['calc(25% + 25%)', 'calc(50%)'],
  ] as const)('serializes the calculated opacity value %s as %s', (
    input,
    expected,
  ) => {
    expect(serializeOpacityValue(parseOpacityValue(input)!))
      .toBe(expected);
  });

  it.each([
    ['200%', '2', '1'],
    ['calc(200%)', 'calc(200%)', '1'],
  ] as const)(
    'serializes %s according to its resolved stage',
    (input, specified, computed) => {
      const value = parseOpacityValue(input)!;

      expect(serializeOpacityValue(value)).toBe(specified);
      expect(serializeOpacityValue(resolveOpacityValue(value, ValueStage.Computed))).toBe(computed);
    },
  );

  it.each([
    ['addition', addOpacities, 0.8, 0.8, 1.6],
    ['accumulation', accumulateOpacities, 0.8, 0.8, 1.6],
  ] as const)(
    'combines computed opacity values by numeric %s without clamping',
    (_name, combine, a, b, expected) => {
      expect(combine(
        { type: 'number', value: a },
        { type: 'number', value: b },
      )).toEqual({
        type: 'number',
        value: expected,
      });
    },
  );

  it('interpolates opacity values without clamping', () => {
    expect(interpolateOpacities(
      { type: 'number', value: 0 },
      { type: 'number', value: 1 },
      -0.25,
    )).toEqual({
      type: 'number',
      value: -0.25,
    });
  });
});
