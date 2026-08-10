import { describe, expect, it } from 'vitest';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import {
  parseMediaQuery, parseMediaQueryList, resolveMediaQuery,
  serializeMediaQuery, serializeMediaQueryList,
} from '../../../../src/stylelet/values/media-query';

describe('<media-query>', () => {
  it.each([
    ['screen', undefined, 'screen'],
    ['ONLY Screen', 'only', 'screen'],
    ['not print', 'not', 'print'],
  ] as const)('parses the media type query %s', (input, modifier, mediaType) => {
    expect(parseMediaQuery(input)).toEqual({
      type: 'media-type-query',
      ...(modifier === undefined ? {} : { modifier }),
      mediaType,
    });
  });

  it('parses a media type followed by a condition without or', () => {
    expect(parseMediaQuery('screen and (color)')).toMatchObject({
      type: 'media-type-query',
      mediaType: 'screen',
      condition: {
        type: TokenKind.ParensBlock,
        value: {
          type: 'media-feature-boolean',
          name: 'color',
        },
      },
    });
  });

  it('parses not as a media condition when followed by parentheses', () => {
    expect(parseMediaQuery('not (color)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        type: 'media-not',
        value: {
          type: TokenKind.ParensBlock,
          value: { type: 'media-feature-boolean', name: 'color' },
        },
      },
    });
  });

  it('parses a plain media feature', () => {
    expect(parseMediaQuery('(width: 10px)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-plain',
          name: 'width',
          value: { type: 'length', value: 10, unit: 'px' },
        },
      },
    });
  });

  it('parses a one-sided range with the name first', () => {
    expect(parseMediaQuery('(width >= 10px)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-range',
          name: 'width',
          right: {
            comparison: '>=',
            value: { type: 'length', value: 10, unit: 'px' },
          },
        },
      },
    });
  });

  it('parses a one-sided range with the value first', () => {
    expect(parseMediaQuery('(10px < width)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-range',
          name: 'width',
          left: {
            comparison: '<',
            value: { type: 'length', value: 10, unit: 'px' },
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
    expect(parseMediaQuery(input)).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-range',
          right: { comparison },
        },
      },
    });
  });

  it('does not let a one-sided range mask a two-sided range', () => {
    expect(parseMediaQuery('(10px < width < 20px)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-range',
          name: 'width',
          left: {
            comparison: '<',
            value: { type: 'length', value: 10, unit: 'px' },
          },
          right: {
            comparison: '<',
            value: { type: 'length', value: 20, unit: 'px' },
          },
        },
      },
    });
  });

  it('parses a descending two-sided range', () => {
    expect(parseMediaQuery('(20px >= width > 10px)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-range',
          name: 'width',
          left: { comparison: '>=' },
          right: { comparison: '>' },
        },
      },
    });
  });

  it('does not let the number alternative mask a ratio value', () => {
    expect(parseMediaQuery('(aspect-ratio: 16/9)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-plain',
          name: 'aspect-ratio',
          value: { type: 'ratio', numerator: 16, denominator: 9 },
        },
      },
    });
    expect(parseMediaQuery('(aspect-ratio: 3/1)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-plain',
          value: { type: 'ratio', numerator: 3, denominator: 1 },
        },
      },
    });
  });

  it('does not reinterpret a standalone number as a ratio', () => {
    expect(parseMediaQuery('(color: 2)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-plain',
          value: { type: 'number', value: 2 },
        },
      },
    });
  });

  it('does not let the nullable and tail mask an or condition', () => {
    expect(parseMediaQuery('(color) or (monochrome)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        type: 'media-or',
        values: [
          { value: { type: 'media-feature-boolean', name: 'color' } },
          { value: { type: 'media-feature-boolean', name: 'monochrome' } },
        ],
      },
    });
  });

  it('keeps and operands in one flat condition', () => {
    expect(parseMediaQuery('(color) and (monochrome) and (grid)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        type: 'media-and',
        values: [
          { value: { name: 'color' } },
          { value: { name: 'monochrome' } },
          { value: { name: 'grid' } },
        ],
      },
    });
  });

  it('folds media feature names but preserves ident values until resolution', () => {
    expect(parseMediaQuery('(ORIENTATION: LANDSCAPE)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        value: {
          type: 'media-feature-plain',
          name: 'orientation',
          value: {
            type: 'ident',
            value: 'LANDSCAPE',
          },
        },
      },
    });
  });

  it('accepts an unknown function as general-enclosed', () => {
    expect(parseMediaQuery('future-query(value)')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        type: 'general-enclosed',
        value: {
          type: TokenKind.FunctionBlock,
          name: 'future-query',
        },
      },
    });
  });

  it('parses nested conditions before the general-enclosed fallback', () => {
    expect(parseMediaQuery('((color) and (monochrome))')).toMatchObject({
      type: 'media-condition-query',
      condition: {
        type: TokenKind.ParensBlock,
        value: {
          type: 'media-and',
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
    expect(parseMediaQuery(input)).toBeNull();
  });

  it.each([
    '(width < = 10px)',
    '(10px < width > 20px)',
  ])('preserves the unrecognized parenthetical %s as general-enclosed', (input) => {
    expect(parseMediaQuery(input)).toMatchObject({
      type: 'media-condition-query',
      condition: {
        type: 'general-enclosed',
        value: { type: TokenKind.ParensBlock },
      },
    });
  });
});

describe('<media-query-list>', () => {
  it('accepts an empty list', () => {
    expect(parseMediaQueryList('')).toEqual([]);
  });

  it('parses entries independently in source order', () => {
    expect(parseMediaQueryList('screen, (color)')).toMatchObject([
      { type: 'media-type-query', mediaType: 'screen' },
      { type: 'media-condition-query' },
    ]);
  });

  it('replaces only an invalid entry with not all', () => {
    expect(parseMediaQueryList('screen, &, print')).toMatchObject([
      { type: 'media-type-query', mediaType: 'screen' },
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
      { type: 'media-type-query', mediaType: 'print' },
    ]);
  });

  it('replaces the empty entry before a lone comma with not all', () => {
    expect(parseMediaQueryList(',')).toMatchObject([
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
    ]);
  });

  it('recovers independently across leading and consecutive empty entries', () => {
    expect(parseMediaQueryList(', screen,, print,')).toMatchObject([
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
      { type: 'media-type-query', mediaType: 'screen' },
      { type: 'media-type-query', modifier: 'not', mediaType: 'all' },
      { type: 'media-type-query', mediaType: 'print' },
    ]);
  });
});

describe('media query resolution', () => {
  it('delegates ident values without imposing feature policy', () => {
    const query = parseMediaQuery('(ORIENTATION: LANDSCAPE)')!;

    expect(resolveMediaQuery(query, ValueStage.Declared)).toEqual(query);
    expect(serializeMediaQuery(resolveMediaQuery(query, ValueStage.Computed)))
      .toBe('(orientation: LANDSCAPE)');
  });

  it('delegates known dimensions to their value resolvers', () => {
    const absolute = parseMediaQuery('(width >= 1in)')!;
    const relative = parseMediaQuery('(width >= 50em)')!;
    const resolution = parseMediaQuery('(resolution: 96dpi)')!;

    expect(serializeMediaQuery(resolveMediaQuery(absolute, ValueStage.Computed)))
      .toBe('(width >= 96px)');
    expect(serializeMediaQuery(resolveMediaQuery(relative, ValueStage.Computed)))
      .toBe('(width >= 50em)');
    expect(serializeMediaQuery(resolveMediaQuery(relative, ValueStage.Computed, {
      length: { em: 16 },
    }))).toBe('(width >= 800px)');
    expect(serializeMediaQuery(resolveMediaQuery(resolution, ValueStage.Computed)))
      .toBe('(resolution: 1dppx)');
  });

  it('delegates number-valued math to the number resolver', () => {
    const query = parseMediaQuery('(color: calc(1 + 2))')!;

    expect(serializeMediaQuery(query)).toBe('(color: calc(3))');
    expect(serializeMediaQuery(resolveMediaQuery(query, ValueStage.Computed)))
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
    expect(serializeMediaQuery(parseMediaQuery(input)!)).toBe(expected);
  });

  it('serializes lists and recovered invalid entries', () => {
    expect(serializeMediaQueryList(parseMediaQueryList('screen, &, print')))
      .toBe('screen, not all, print');
  });
});
