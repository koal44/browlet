import { styleletEnv } from '../../environment-fixture';
import { describe, expect, it } from 'vitest';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { OpacityValue } from '../../../../src/stylelet/values/opacity-value';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { PercentageValue } from '../../../../src/stylelet/values/percentage';
import { NumberLiteral, PercentageLiteral } from '../../../../src/stylelet/values/numeric-literal/index';
import { MathExpression, MathValue } from '../../../../src/stylelet/values/math-value';

describe('opacity values', () => {
  it('uses the supplied normalization context during consumption', () => {
    expect(OpacityValue.parse('calc(150%)', { env: styleletEnv, unwrapMathAt: ValueStage.Declared }))
      .toEqual(new OpacityValue(new NumberValue(new NumberLiteral(1.5))));
  });

  it.each([
    ['0.5', new OpacityValue(new NumberValue(new NumberLiteral(0.5)))],
    ['50%', new OpacityValue(new NumberValue(new NumberLiteral(0.5)))],
  ])('parses and normalizes the literal opacity value %s', (input, expected) => {
    expect(OpacityValue.parse(input, { env: styleletEnv })).toEqual(expected);
  });

  it.each([
    ['calc(0.25 + 0.25)', 'number'],
    ['calc(25% + 25%)', 'percentage'],
  ])('parses the calculated opacity value %s', (input, expectedType) => {
    expect(OpacityValue.parse(input, { env: styleletEnv })).toMatchObject({
      repr: { repr: { valueType: expectedType } },
    });
  });

  it.each([
    'auto',
    '1px',
    'calc(1px)',
    '0.5 1',
  ])('rejects the invalid opacity value %s', (input) => {
    expect(OpacityValue.parse(input, { env: styleletEnv })).toBeNull();
  });

  it('normalizes literal opacity percentages without early clamping', () => {
    const number = OpacityValue.parse('2', { env: styleletEnv })!;
    const percentage = new OpacityValue(new PercentageValue(new PercentageLiteral(200)));

    expect(number.resolve(ValueStage.Specified, { env: styleletEnv }))
      .toEqual(number);
    expect(percentage.resolve(ValueStage.Specified, { env: styleletEnv }))
      .toEqual(number);
  });

  it('resolves a raw percentage through the opacity facade', () => {
    const percentage = new OpacityValue(new PercentageValue(new PercentageLiteral(25)));

    expect(percentage.resolve(ValueStage.Specified, { env: styleletEnv }))
      .toEqual(new OpacityValue(new NumberValue(new NumberLiteral(0.25))));
    expect(percentage.resolve(ValueStage.Computed, { env: styleletEnv }))
      .toEqual(new OpacityValue(new NumberValue(new NumberLiteral(0.25))));
  });

  it.each([
    ['-1', 0],
    ['0.5', 0.5],
    ['2', 1],
    ['-100%', 0],
    ['50%', 0.5],
    ['200%', 1],
  ])(
    'converts and clamps the computed opacity value %s',
    (input, expected) => {
      expect(OpacityValue.parse(input, { env: styleletEnv })!.resolve(ValueStage.Computed, { env: styleletEnv })).toEqual(new OpacityValue(new NumberValue(new NumberLiteral(expected))));
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
  ])(
    'resolves and clamps the computed opacity value %s',
    (input, expected) => {
      expect(OpacityValue.parse(input, { env: styleletEnv })!.resolve(ValueStage.Computed, { env: styleletEnv })).toEqual(new OpacityValue(new NumberValue(new NumberLiteral(expected))));
    },
  );

  it('uses the caller math-unwrapping policy', () => {
    const value = OpacityValue.parse('calc(0.25 + 0.25)', { env: styleletEnv })!;

    const deferred = value.resolve(ValueStage.Computed, { env: styleletEnv, unwrapMathAt: ValueStage.Used }).repr;
    const math = deferred.repr;
    expect(math).toBeInstanceOf(MathValue);
    if (!(math instanceof MathValue)) throw new Error('Expected a retained math value');
    expect(math.repr).toBeInstanceOf(MathExpression);
    expect(value.resolve(ValueStage.Computed, {
      env: styleletEnv,
      unwrapMathAt: ValueStage.Computed,
    })).toEqual(new OpacityValue(new NumberValue(new NumberLiteral(0.5))));
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
  ])('serializes the specified opacity value %s as %s', (
    input,
    expected,
  ) => {
    expect(OpacityValue.parse(input, { env: styleletEnv })!.serialize())
      .toBe(expected);
  });

  it.each([
    ['calc(0.25 + 0.25)', 'calc(0.5)'],
    ['calc(25% + 25%)', 'calc(50%)'],
  ])('serializes the calculated opacity value %s as %s', (
    input,
    expected,
  ) => {
    expect(OpacityValue.parse(input, { env: styleletEnv })!.serialize())
      .toBe(expected);
  });

  it.each([
    ['200%', '2', '1'],
    ['calc(200%)', 'calc(200%)', '1'],
  ])(
    'serializes %s according to its resolved stage',
    (input, specified, computed) => {
      const value = OpacityValue.parse(input, { env: styleletEnv })!;

      expect(value.serialize()).toBe(specified);
      expect(value.resolve(ValueStage.Computed, { env: styleletEnv }).serialize()).toBe(computed);
    },
  );

  it.each([
    ['addition', 'add', 0.8, 0.8, 1.6],
    ['accumulation', 'accumulate', 0.8, 0.8, 1.6],
  ] as const)(
    'combines computed opacity values by numeric %s without clamping',
    (_name, combine, a, b, expected) => {
      expect(new OpacityValue(new NumberValue(new NumberLiteral(a)))[combine](new OpacityValue(new NumberValue(new NumberLiteral(b))), { env: styleletEnv })).toEqual(new OpacityValue(new NumberValue(new NumberLiteral(expected))));
    },
  );

  it('combines percentage calculations on the same scale as number opacities', () => {
    const percentage = OpacityValue.parse('calc(25%)', { env: styleletEnv })!;
    const number = OpacityValue.parse('0.5', { env: styleletEnv })!;

    expect(percentage.add(number, { env: styleletEnv }).resolve(ValueStage.Computed, { env: styleletEnv }).serialize()).toBe('0.75');
    expect(percentage.interpolate(number, 0.5, { env: styleletEnv }).resolve(ValueStage.Computed, { env: styleletEnv }).serialize()).toBe('0.375');
    expect(percentage.accumulate(number, { env: styleletEnv }).resolve(ValueStage.Computed, { env: styleletEnv }).serialize()).toBe('0.75');
    expect(percentage.serialize()).toBe('calc(25%)');
  });

  it('interpolates opacity values without clamping', () => {
    expect(new OpacityValue(new NumberValue(new NumberLiteral(0))).interpolate(new OpacityValue(new NumberValue(new NumberLiteral(1))), -0.25, { env: styleletEnv })).toEqual(new OpacityValue(new NumberValue(new NumberLiteral(-0.25))));
  });
});
