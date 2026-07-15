import { describe, expect, it } from 'vitest';
import { parseStylesheet } from '../../../src/stylelet/parser/ast';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { BlockKind, parseListOfComponentValues, type ComponentValue } from '../../../src/stylelet/parser/syntax';
import {
  BadStringToken, BadUrlToken, RightParenToken, WhitespaceToken,
  identToken, stringToken,
} from '../../../src/stylelet/parser/tokens';
import { BlockItemAstKind, type StyleRuleAst } from '../../../src/stylelet/parser/types';
import { serializeAnPlusB } from '../../../src/stylelet/values/an-plus-b';
import { parseAnyValue } from '../../../src/stylelet/values/any-value';
import { parseDeclarationValue } from '../../../src/stylelet/values/declaration-value';
import { parseCustomIdent, serializeCustomIdent } from '../../../src/stylelet/values/custom-ident';
import { parseDashedIdent, serializeDashedIdent } from '../../../src/stylelet/values/dashed-ident';
import { parseIdent, serializeIdent, serializeIdentifier } from '../../../src/stylelet/values/ident';
import { parseString, serializeCssString, serializeString } from '../../../src/stylelet/values/string';
import { parseUrlModifier, tryConsumeUrlModifier } from '../../../src/stylelet/values/url-modifier';
import { parseUrl, tryConsumeUrl } from '../../../src/stylelet/values/url';

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

describe('any-value', () => {
  it('parses a nonempty sequence of arbitrary component values', () => {
    const expected = parseListOfComponentValues('a ! b; fn() []');
    expect(parseAnyValue('a ! b; fn() []')).toEqual(expected);
  });

  it('returns the original component values after validating them', () => {
    const components = parseListOfComponentValues('a fn(b)');
    expect(parseAnyValue(components)).toBe(components);
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
    expect(parseDeclarationValue(components)).toBe(components);
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

    expect(tryConsumeUrlModifier(c)).toMatchObject({
      kind: 'bad',
      reason: 'invalid',
    });
    expect(c.pos()).toBe(1);
  });

  it('rejects unknown functional notation containing a bad token', () => {
    const components: ComponentValue[] = [{
      block: BlockKind.Function,
      name: 'future-modifier',
      value: [BadStringToken],
    }];

    expect(parseUrlModifier(components)).toBeNull();

    const c = new ComponentCursor(components);
    expect(tryConsumeUrlModifier(c)).toMatchObject({
      kind: 'bad',
      reason: 'invalid',
    });
    expect(c.pos()).toBe(1);
  });

  it('consumes a URL modifier through the component grammar', () => {
    const c = new ComponentCursor(parseListOfComponentValues('future-modifier()'));

    expect(tryConsumeUrlModifier(c)).toEqual({
      kind: 'ok',
      value: {
        block: BlockKind.Function,
        name: 'future-modifier',
        value: [],
      },
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
        block: BlockKind.Function,
        name: 'src',
        value: [
          {
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
  ] as const)('parses %j', (input, notation, value) => {
    expect(parseUrl(input)).toEqual({
      type: 'url',
      notation,
      value,
      modifiers: [],
    });
  });

  it('accepts component trivia around and inside functional notation', () => {
    expect(parseUrl(' /* before */ src( /* inner */ "image.png" ) /* after */ '))
      .toEqual({
        type: 'url',
        notation: 'src',
        value: 'image.png',
        modifiers: [],
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
      modifiers: [],
    });
  });

  it('retains recognized request URL modifiers in source order', () => {
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
      modifiers: [
        { type: 'referrer-policy-modifier', value: 'no-referrer' },
        { type: 'integrity-modifier', value: 'sha256-test' },
        { type: 'cross-origin-modifier', value: 'use-credentials' },
      ],
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

    expect(tryConsumeUrl(c)).toEqual({
      kind: 'bad',
      reason: 'invalid',
      message: 'Duplicate referrer-policy URL modifier',
    });
    expect(c.pos()).toBe(1);
  });

  it('rejects an unknown functional modifier containing a bad token', () => {
    expect(parseUrl([{
      block: BlockKind.Function,
      name: 'url',
      value: [
        stringToken('image.png'),
        WhitespaceToken,
        {
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

    expect(result).toMatchObject({
      kind: 'bad',
      reason: 'invalid',
    });
    expect(c.pos()).toBe(1);
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
