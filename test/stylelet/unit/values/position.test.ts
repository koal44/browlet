import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { PositionValue, type PositionContext, type PositionFour, type PositionOffsets, type PositionOffsetTuple, type PositionOne, type PositionTwo } from '../../../../src/stylelet/values/position';
import { LengthPercentageValue } from '../../../../src/stylelet/values/length-percentage';
import { LengthLiteral, PercentageLiteral } from '../../../../src/stylelet/values/numeric-literal/index';

const length = (value: number, unit: 'px' | 'em' = 'px') => new LengthPercentageValue(new LengthLiteral(value, unit));

const percentage = (value: number) => new LengthPercentageValue(new PercentageLiteral(value));

function position(
  components:
    | PositionOne['components']
    | PositionTwo['components']
    | PositionFour['components'],
): PositionValue {
  return PositionValue.fromComponents(...components);
}

function offsets(...offsets: PositionOffsetTuple): PositionValue<PositionOffsets> {
  return new PositionValue({ offsets });
}

describe('position values', () => {
  describe('<position-one>', () => {
    it.each([
      'left',
      'center',
      'right',
      'top',
      'bottom',
      'x-start',
      'x-end',
      'y-start',
      'y-end',
      'block-start',
      'block-end',
      'inline-start',
      'inline-end',
    ] as const)('parses the %s keyword', (keyword) => {
      expect(PositionValue.parse(keyword, {})).toEqual(position([keyword]));
    });

    it('parses a length-percentage', () => {
      expect(PositionValue.parse('25%', {})).toEqual(position([percentage(25)]));
      expect(PositionValue.parse('10px', {})).toEqual(position([length(10)]));
    });

    it('parses keywords case-insensitively', () => {
      expect(PositionValue.parse('InLiNe-EnD', {})).toEqual(position(['inline-end']));
    });
  });

  describe('<position-two>', () => {
    it.each([
      ['left top', ['left', 'top']],
      ['top left', ['left', 'top']],
      ['center left', ['left', 'center']],
      ['left center', ['left', 'center']],
      ['center top', ['center', 'top']],
      ['top center', ['center', 'top']],
      ['x-end y-start', ['x-end', 'y-start']],
      ['y-start x-end', ['x-end', 'y-start']],
    ] as const)('parses and axis-orders %s', (input, components) => {
      expect(PositionValue.parse(input, {})).toEqual(position([...components]));
    });

    it.each([
      ['10px 20%', [length(10), percentage(20)]],
      ['-20% -30px', [percentage(-20), length(-30)]],
      ['left 20%', ['left', percentage(20)]],
      ['10px bottom', [length(10), 'bottom']],
      ['x-start 10px', ['x-start', length(10)]],
      ['10px y-start', [length(10), 'y-start']],
    ] as const)('parses the ordered form %s', (input, components) => {
      expect(PositionValue.parse(input, {})).toEqual(position([...components]));
    });

    it.each([
      ['block-end inline-start', ['block-end', 'inline-start']],
      ['inline-start block-end', ['block-end', 'inline-start']],
      ['center block-start', ['block-start', 'center']],
      ['center inline-end', ['center', 'inline-end']],
      ['start end', ['start', 'end']],
      ['end start', ['end', 'start']],
    ] as const)('parses and axis-orders %s', (input, components) => {
      expect(PositionValue.parse(input, {})).toEqual(position([...components]));
    });
  });

  describe('<position-four>', () => {
    it.each([
      [
        'left 10px top 20%',
        ['left', length(10), 'top', percentage(20)],
      ],
      [
        'top 20% left 10px',
        ['left', length(10), 'top', percentage(20)],
      ],
      [
        'x-end 10% y-start 2em',
        ['x-end', percentage(10), 'y-start', length(2, 'em')],
      ],
      [
        'block-end 1px inline-start 2px',
        ['block-end', length(1), 'inline-start', length(2)],
      ],
      [
        'inline-start 2px block-end 1px',
        ['block-end', length(1), 'inline-start', length(2)],
      ],
      [
        'start 1px end 25%',
        ['start', length(1), 'end', percentage(25)],
      ],
    ] as const)('parses and axis-orders %s', (input, components) => {
      expect(PositionValue.parse(input, {})).toEqual(position([...components]));
    });
  });

  it.each([
    '',
    'auto',
    '50% left',
    'top 10px',
    'left top 10px',
    'left 10px top',
    'left 10px top 20px center',
    '1px 2px 3px',
    'left right',
    'bottom 10%',
    'bottom 10% top 20%',
    'center left 1px',
    'right 3% center',
    'bottom 7% left',
    'left block-start',
    'start inline-end',
    'start 10px end',
  ])('rejects %j as a complete position', (input) => {
    expect(PositionValue.parse(input, {})).toBeNull();
  });

  it('prefers the longest viable position production', () => {
    expect(PositionValue.parse('left 10px', {})).toEqual(position([
      'left',
      length(10),
    ]));
    expect(PositionValue.parse('left 10px top 20px', {})).toEqual(position([
      'left',
      length(10),
      'top',
      length(20),
    ]));
  });

  it('greedily consumes a position while leaving following components', () => {
    const four = new TokenCursor(parseListOfComponentValues(
      'left 10px top 20px red', {},
    ), {});
    const one = new TokenCursor(parseListOfComponentValues('top 50px', {}), {});

    expect(PositionValue.consume(four))
      .toEqual(position(['left', length(10), 'top', length(20)]));
    expect(four.pos()).toBe(7);

    expect(PositionValue.consume(one)).toEqual(position(['top']));
    expect(one.pos()).toBe(1);
  });
});

describe('position resolution', () => {
  it('represents normalized positions as offsets rather than syntax components', () => {
    expect(PositionValue.parse('center', {})!.resolve(ValueStage.Computed)).toEqual(offsets(percentage(50), percentage(50)));
  });

  it.each([
    ['10% center', '10% 50%'],
    ['right 30% top 60px', '70% 60px'],
    ['30px center', '30px 50%'],
    ['40px top', '40px 0%'],
    ['right 20% bottom 10%', '80% 90%'],
    ['right bottom', '100% 100%'],
    ['center', '50% 50%'],
    ['right 20px bottom 10px', 'calc(100% - 20px) calc(100% - 10px)'],
  ])('resolves %s to top-left offsets', (input, expected) => {
    expect(PositionValue.parse(input, {})!.resolve(ValueStage.Computed).serialize()).toBe(expected);
  });

  it.each<[
    PositionContext,
    string,
    string,
    string,
    string,
  ]>([
    [
      { writingMode: 'horizontal-tb', direction: 'ltr' },
      '0% 50%', '100% 50%', '50% 0%', '50% 100%',
    ],
    [
      { writingMode: 'horizontal-tb', direction: 'rtl' },
      '100% 50%', '0% 50%', '50% 0%', '50% 100%',
    ],
    [
      { writingMode: 'vertical-rl', direction: 'ltr' },
      '100% 50%', '0% 50%', '50% 0%', '50% 100%',
    ],
    [
      { writingMode: 'vertical-rl', direction: 'rtl' },
      '100% 50%', '0% 50%', '50% 100%', '50% 0%',
    ],
    [
      { writingMode: 'vertical-lr', direction: 'ltr' },
      '0% 50%', '100% 50%', '50% 0%', '50% 100%',
    ],
    [
      { writingMode: 'vertical-lr', direction: 'rtl' },
      '0% 50%', '100% 50%', '50% 100%', '50% 0%',
    ],
    [
      { writingMode: 'sideways-rl', direction: 'ltr' },
      '100% 50%', '0% 50%', '50% 0%', '50% 100%',
    ],
    [
      { writingMode: 'sideways-rl', direction: 'rtl' },
      '100% 50%', '0% 50%', '50% 100%', '50% 0%',
    ],
    [
      { writingMode: 'sideways-lr', direction: 'ltr' },
      '0% 50%', '100% 50%', '50% 100%', '50% 0%',
    ],
    [
      { writingMode: 'sideways-lr', direction: 'rtl' },
      '0% 50%', '100% 50%', '50% 0%', '50% 100%',
    ],
  ])('resolves axis-relative keywords in %o', (
    context,
    xStart,
    xEnd,
    yStart,
    yEnd,
  ) => {
    const resolve = (input: string) => PositionValue.parse(input, context)!.resolve(ValueStage.Computed, context).serialize();

    expect(resolve('x-start')).toBe(xStart);
    expect(resolve('x-end')).toBe(xEnd);
    expect(resolve('y-start')).toBe(yStart);
    expect(resolve('y-end')).toBe(yEnd);
  });

  it.each([
    ['x-start 10px', '0% 10px'],
    ['x-end 10px top 20px', 'calc(100% - 10px) 20px'],
    ['left 10px y-end 20%', '10px 80%'],
  ])('resolves %s with the default horizontal writing context', (input, expected) => {
    expect(PositionValue.parse(input, {})!.resolve(ValueStage.Computed, { writingMode: 'horizontal-tb', direction: 'ltr' }).serialize()).toBe(expected);
  });

  it('resolves block and inline positions into physical axis order', () => {
    const context: PositionContext = {
      writingMode: 'vertical-rl',
      direction: 'ltr',
    };

    expect(PositionValue.parse('block-start inline-end', {})!.resolve(ValueStage.Computed, context).serialize()).toBe('100% 100%');
    expect(PositionValue.parse('start end', {})!.resolve(ValueStage.Computed, context).serialize()).toBe('100% 100%');
  });

  it('does not claim offsets when logical context is unavailable', () => {
    const value = PositionValue.parse('block-start inline-end', {})!;

    expect(value.resolve(ValueStage.Computed)).toEqual(value);
    expect(value.tryResolveOffsets(ValueStage.Computed)).toBeNull();
  });
});

describe('position serialization', () => {
  it.each([
    ['10%', '10% center'],
    ['left', 'left center'],
    ['top', 'center top'],
    ['x-start', 'x-start center'],
    ['y-start', 'center y-start'],
    ['block-start', 'block-start center'],
    ['inline-start', 'center inline-start'],
    ['bottom right', 'right bottom'],
    ['bottom 10% right 20%', 'right 20% bottom 10%'],
  ])('serializes %s as %s', (input, expected) => {
    expect(PositionValue.parse(input, {})!.serialize()).toBe(expected);
  });
});

describe('position combination', () => {
  it('adds horizontal and vertical offsets independently', () => {
    expect(offsets(percentage(10), percentage(20)).add(offsets(percentage(30), percentage(40)))).toEqual(offsets(percentage(40), percentage(60)));
  });

  it('interpolates horizontal and vertical offsets independently', () => {
    expect(offsets(percentage(10), percentage(20)).interpolate(offsets(percentage(30), percentage(60)), 0.25)).toEqual(offsets(percentage(15), percentage(30)));
  });

  it('accumulates offsets by addition', () => {
    const a = offsets(percentage(10), percentage(20));
    const b = offsets(percentage(30), percentage(40));

    expect(a.accumulate(b)).toEqual(a.add(b));
  });
});
