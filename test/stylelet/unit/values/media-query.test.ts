import { styleletEnv } from '../../environment-fixture';
import { describe, expect, it } from 'vitest';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { MediaQuery } from '../../../../src/stylelet/values/media-query';
import { LengthValue } from '../../../../src/stylelet/values/length';
import { LengthLiteral, NumberLiteral } from '../../../../src/stylelet/values/numeric-literal/index';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { RatioValue } from '../../../../src/stylelet/values/ratio';
import { IdentValue } from '../../../../src/stylelet/values/ident';

describe('<media-query>', () => {
  it.each([
    ['screen', undefined, 'screen'],
    ['ONLY Screen', 'only', 'screen'],
    ['not print', 'not', 'print'],
  ] as const)('parses the media type query %s', (input, modifier, mediaType) => {
    expect(MediaQuery.parse(input, { env: styleletEnv })?.repr).toEqual({
      type: 'media-type-query',
      ...(modifier === undefined ? {} : { modifier }),
      mediaType,
    });
  });

  it('parses a media type followed by a condition without or', () => {
    expect(MediaQuery.parse('screen and (color)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-type-query',
      mediaType: 'screen',
      condition: {
        repr: {
          name: 'color',
        },
      },
    });
  });

  it('parses not as a media condition when followed by parentheses', () => {
    expect(MediaQuery.parse('not (color)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          repr: { name: 'color' },
        },
      },
    });
  });

  it('parses a plain media feature', () => {
    expect(MediaQuery.parse('(width: 10px)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          name: 'width',
          repr: new LengthValue(new LengthLiteral(10, 'px')),
        },
      },
    });
  });

  it.each([
    ['ORIENTATION', 'LANDSCAPE', 'landscape'],
    ['orientation', 'PORTRAIT', 'portrait'],
    ['SCAN', 'INTERLACE', 'interlace'],
    ['scan', 'PROGRESSIVE', 'progressive'],
  ])('interprets the keyword in (%s: %s)', (name, keyword, expected) => {
    const query = MediaQuery.parse(`(${name}: ${keyword})`, { env: styleletEnv })!;
    expect(query.repr).toMatchObject({
      condition: { repr: { repr: new IdentValue(expected) } },
    });
    expect(query.serialize()).toBe(`(${name.toLowerCase()}: ${expected})`);
  });

  it('parses a one-sided range with the name first', () => {
    expect(MediaQuery.parse('(width >= 10px)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          name: 'width',
          right: {
            comparison: '>=',
            value: new LengthValue(new LengthLiteral(10, 'px')),
          },
        },
      },
    });
  });

  it('parses a one-sided range with the value first', () => {
    expect(MediaQuery.parse('(10px < width)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          name: 'width',
          left: {
            comparison: '<',
            value: new LengthValue(new LengthLiteral(10, 'px')),
          },
        },
      },
    });
  });

  it.each([
    ['(width < 10px)', '<'],
    ['(width <= 10px)', '<='],
    ['(width > 10px)', '>'],
    ['(width >= 10px)', '>='],
    ['(width = 10px)', '='],
  ] as const)('parses the comparison in %s', (input, comparison) => {
    expect(MediaQuery.parse(input, { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          right: { comparison },
        },
      },
    });
  });

  it('does not let a one-sided range mask a two-sided range', () => {
    expect(MediaQuery.parse('(10px < width < 20px)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          name: 'width',
          left: {
            comparison: '<',
            value: new LengthValue(new LengthLiteral(10, 'px')),
          },
          right: {
            comparison: '<',
            value: new LengthValue(new LengthLiteral(20, 'px')),
          },
        },
      },
    });
  });

  it('parses a descending two-sided range', () => {
    expect(MediaQuery.parse('(20px >= width > 10px)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          name: 'width',
          left: { comparison: '>=' },
          right: { comparison: '>' },
        },
      },
    });
  });

  it('does not let the number alternative mask a ratio value', () => {
    expect(MediaQuery.parse('(aspect-ratio: 16/9)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          name: 'aspect-ratio',
          repr: new RatioValue({ numerator: 16, denominator: 9 }),
        },
      },
    });
    expect(MediaQuery.parse('(aspect-ratio: 3/1)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          repr: new RatioValue({ numerator: 3, denominator: 1 }),
        },
      },
    });
  });

  it('does not reinterpret a standalone number as a ratio', () => {
    expect(MediaQuery.parse('(color: 2)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          repr: new NumberValue(new NumberLiteral(2)),
        },
      },
    });
  });

  it('does not let the nullable and tail mask an or condition', () => {
    expect(MediaQuery.parse('(color) or (monochrome)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        operator: 'or',
        values: [
          { repr: { name: 'color' } },
          { repr: { name: 'monochrome' } },
        ],
      },
    });
  });

  it('keeps and operands in one flat condition', () => {
    expect(MediaQuery.parse('(color) and (monochrome) and (grid)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        operator: 'and',
        values: [
          { repr: { name: 'color' } },
          { repr: { name: 'monochrome' } },
          { repr: { name: 'grid' } },
        ],
      },
    });
  });

  it('folds unknown media feature names without changing their ident values', () => {
    expect(MediaQuery.parse('(FUTURE-FEATURE: CUSTOM)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          name: 'future-feature',
          repr: new IdentValue('CUSTOM'),
        },
      },
    });
  });

  it('accepts an unknown function as general-enclosed', () => {
    expect(MediaQuery.parse('future-query(value)', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          type: TokenKind.FunctionBlock,
          name: 'future-query',
        },
      },
    });
  });

  it('parses nested conditions before the general-enclosed fallback', () => {
    expect(MediaQuery.parse('((color) and (monochrome))', { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: {
          operator: 'and',
        },
      },
    });
  });

  it.each([
    'only',
    'and',
    'or',
    'layer',
    'screen or (color)',
    'screen and (color) or (monochrome)',
    '(color) and (monochrome) or (grid)',
    '(color) or (monochrome) and (grid)',
    'not not (color)',
  ])('rejects %j', (input) => {
    expect(MediaQuery.parse(input, { env: styleletEnv })).toBeNull();
  });

  it.each([
    '(width < = 10px)',
    '(10px < width > 20px)',
  ])('preserves the unrecognized parenthetical %s as general-enclosed', (input) => {
    expect(MediaQuery.parse(input, { env: styleletEnv })?.repr).toMatchObject({
      type: 'media-condition-query',
      condition: {
        repr: { type: TokenKind.ParensBlock },
      },
    });
  });
});

describe('<media-query-list>', () => {
  it('accepts an empty list', () => {
    expect(MediaQuery.parseList('', { env: styleletEnv })).toEqual([]);
  });

  it('parses entries independently in source order', () => {
    expect(MediaQuery.parseList('screen, (color)', { env: styleletEnv }).map((query) => query.repr)).toMatchObject([
      { type: 'media-type-query', mediaType: 'screen' },
      { type: 'media-condition-query' },
    ]);
  });

  it('replaces only an invalid entry with not all', () => {
    expect(MediaQuery.parseList('screen, &, print', { env: styleletEnv }).map((query) => query.repr)).toMatchObject([
      { type: 'media-type-query', mediaType: 'screen' },
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
      { type: 'media-type-query', mediaType: 'print' },
    ]);
  });

  it('replaces both empty entries around a lone comma with not all', () => {
    expect(MediaQuery.parseList(',', { env: styleletEnv }).map((query) => query.repr)).toMatchObject([
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
    ]);
  });

  it('recovers independently across leading, consecutive, and trailing empty entries', () => {
    expect(MediaQuery.parseList(', screen,, print,', { env: styleletEnv }).map((query) => query.repr)).toMatchObject([
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
      { type: 'media-type-query', mediaType: 'screen' },
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
      { type: 'media-type-query', mediaType: 'print' },
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
    ]);
  });

  it.each(['screen,', 'screen,/**/', 'screen, '])('retains a final empty query in %j', (input) => {
    expect(MediaQuery.serializeList(MediaQuery.parseList(input, { env: styleletEnv }))).toBe('screen, not all');
  });

  it('does not mistake a comma inside an unclosed function for a list separator', () => {
    expect(MediaQuery.serializeList(MediaQuery.parseList('future(a,', { env: styleletEnv }))).toBe('future(a,)');
  });
});

describe('media query resolution', () => {
  it('resolves nested conditions repeatedly with fresh context and retains unknown syntax', () => {
    const source = 'screen and (color) and ((width: 2em) or (not (1em < width <= 3em))) and future(foo)';
    const query = MediaQuery.parse(source, { env: styleletEnv })!;
    const deferred = query.resolve(ValueStage.Computed, { env: styleletEnv });

    expect(deferred.resolve(ValueStage.Computed, { env: styleletEnv, length: { em: 10 } }).serialize())
      .toBe('screen and (color) and ((width: 20px) or (not (10px < width <= 30px))) and future(foo)');
    expect(deferred.resolve(ValueStage.Computed, { env: styleletEnv, length: { em: 20 } }).serialize())
      .toBe('screen and (color) and ((width: 40px) or (not (20px < width <= 60px))) and future(foo)');
    expect(deferred.serialize()).toBe(source);
    expect(query.serialize()).toBe(source);
  });

  it('retains interpreted keywords through value resolution', () => {
    const query = MediaQuery.parse('(ORIENTATION: LANDSCAPE)', { env: styleletEnv })!;

    expect(query.resolve(ValueStage.Declared, { env: styleletEnv })).toEqual(query);
    expect(query.resolve(ValueStage.Computed, { env: styleletEnv }).serialize())
      .toBe('(orientation: landscape)');
  });

  it('delegates known dimensions to their value resolvers', () => {
    const absolute = MediaQuery.parse('(width >= 1in)', { env: styleletEnv })!;
    const relative = MediaQuery.parse('(width >= 50em)', { env: styleletEnv })!;
    const resolution = MediaQuery.parse('(resolution: 96dpi)', { env: styleletEnv })!;

    expect(absolute.resolve(ValueStage.Computed, { env: styleletEnv }).serialize())
      .toBe('(width >= 96px)');
    expect(relative.resolve(ValueStage.Computed, { env: styleletEnv }).serialize())
      .toBe('(width >= 50em)');
    expect(relative.resolve(ValueStage.Computed, {
      env: styleletEnv,
      length: { em: 16 },
    }).serialize()).toBe('(width >= 800px)');
    expect(resolution.resolve(ValueStage.Computed, { env: styleletEnv }).serialize())
      .toBe('(resolution: 1dppx)');
  });

  it('delegates number-valued math to the number resolver', () => {
    const query = MediaQuery.parse('(color: calc(1 + 2))', { env: styleletEnv })!;

    expect(query.serialize()).toBe('(color: calc(3))');
    expect(query.resolve(ValueStage.Computed, { env: styleletEnv }).serialize())
      .toBe('(color: 3)');
  });
});

describe('media query serialization', () => {
  it.each([
    ['ONLY Screen AND (800PX <= WIDTH)', 'only screen and (800px <= width)'],
    ['all and (COLOR)', '(color)'],
    ['(MIN-WIDTH: 001.500PX)', '(min-width: 1.5px)'],
    ['(ASPECT-RATIO: 1/3)', '(aspect-ratio: 1 / 3)'],
    ['(aspect-ratio: 32 / 18)', '(aspect-ratio: 32 / 18)'],
    ['(400px < width <= 1200px)', '(400px < width <= 1200px)'],
    ['(1200px >= width > 400px)', '(1200px >= width > 400px)'],
    ['not ((color) or (monochrome))', 'not ((color) or (monochrome))'],
    ['future(foo  bar)', 'future(foo bar)'],
    ['(unknown-feature: FOO)', '(unknown-feature: FOO)'],
  ])('serializes %j as %j', (input, expected) => {
    expect(MediaQuery.parse(input, { env: styleletEnv })!.serialize()).toBe(expected);
  });

  it('serializes lists and recovered invalid entries', () => {
    expect(MediaQuery.serializeList(MediaQuery.parseList('screen, &, print', { env: styleletEnv })))
      .toBe('screen, not all, print');
  });
});
