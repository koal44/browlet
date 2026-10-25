import { styleletEnv } from '../../environment-fixture';
import { describe, expect, it } from 'vitest';
import { AngleLiteral } from '../../../../src/stylelet/values/numeric-literal/index';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { AnglePercentageValue } from '../../../../src/stylelet/values/angle-percentage';

describe('angle-percentage values', () => {
  it('parses literal alternatives without promoting them', () => {
    expect(AnglePercentageValue.parse('10deg', { env: styleletEnv })).toMatchObject({
      repr: {
        type: 'angle',
        value: 10,
        unit: 'deg',
      },
    });
    expect(AnglePercentageValue.parse('25%', { env: styleletEnv })).toMatchObject({
      repr: {
        type: 'percentage',
        value: 25,
      },
    });
  });

  it('parses and serializes mixed math functions', () => {
    const value = AnglePercentageValue.parse('calc(10deg + 25%)', { env: styleletEnv });

    expect(value).toMatchObject({
      repr: {
        repr: {
          calculation: {
            type: 'sum',
          },
        },
      },
    });
    expect((value!).serialize()).toBe('calc(25% + 10deg)');
  });

  it('resolves mixed math when its percentage reference is available', () => {
    const mixed = AnglePercentageValue.parse('calc(10deg + 25%)', { env: styleletEnv })!;
    const percentage = AnglePercentageValue.parse('calc(25%)', { env: styleletEnv })!;

    expect(mixed.resolve(ValueStage.Computed, { env: styleletEnv })).toEqual(mixed);
    expect(mixed.resolve(ValueStage.Computed, {
      env: styleletEnv,
      percentageReferenceValue: new AngleLiteral(200, 'deg'),
    })).toMatchObject({ repr: { type: 'angle', value: 60, unit: 'deg' } });
    expect(percentage.resolve(ValueStage.Computed, { env: styleletEnv }))
      .toMatchObject({ repr: { type: 'percentage', value: 25 } });
  });

  it('canonicalizes literal angles at the computed-value stage', () => {
    const angle = AnglePercentageValue.parse('0.5turn', { env: styleletEnv })!;

    expect(angle.resolve(ValueStage.Specified, { env: styleletEnv })).toBe(angle);
    expect(angle.resolve(ValueStage.Computed, { env: styleletEnv }))
      .toMatchObject({ repr: { type: 'angle', value: 180, unit: 'deg' } });
  });

  it('resolves literal percentages only when their basis is available', () => {
    const percentage = AnglePercentageValue.parse('25%', { env: styleletEnv })!;
    const context = {
      env: styleletEnv,
      percentageReferenceValue: new AngleLiteral(200, 'deg'),
    } as const;

    expect(percentage.resolve(ValueStage.Specified, context))
      .toBe(percentage);
    expect(percentage.resolve(ValueStage.Computed, { env: styleletEnv }))
      .toBe(percentage);
    expect(percentage.resolve(ValueStage.Computed, context))
      .toMatchObject({ repr: { type: 'angle', value: 50, unit: 'deg' } });
  });

  it('rejects calculations from another dimensional category', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10px + 25%)', {}), { env: styleletEnv },
    );

    expect(AnglePercentageValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses the angle percentage type and restores outer context', () => {
    const context = {
      env: styleletEnv,
      percentHint: 'length',
    } as const;
    const c = new TokenCursor(
      parseListOfComponentValues('calc(10deg + 25%)', {}),
      context,
    );

    expect(AnglePercentageValue.consume(c)).not.toBeNull();
    expect(c.context).toBe(context);
  });

  it('keeps directly compatible literal combinations literal', () => {
    const angleA = AnglePercentageValue.parse('10deg', { env: styleletEnv })!;
    const angleB = AnglePercentageValue.parse('20deg', { env: styleletEnv })!;
    const percentageA = AnglePercentageValue.parse('10%', { env: styleletEnv })!;
    const percentageB = AnglePercentageValue.parse('20%', { env: styleletEnv })!;

    expect(angleA.add(angleB, { env: styleletEnv }))
      .toMatchObject({ repr: { type: 'angle', value: 30, unit: 'deg' } });
    expect(percentageA.interpolate(percentageB, 0.5, { env: styleletEnv })).toMatchObject({ repr: { type: 'percentage', value: 15 } });
    expect(percentageA.accumulate(percentageB, { env: styleletEnv }))
      .toMatchObject({ repr: { type: 'percentage', value: 30 } });
  });

  it('promotes incompatible literal alternatives into math', () => {
    const angle = AnglePercentageValue.parse('10deg', { env: styleletEnv })!;
    const percentage = AnglePercentageValue.parse('20%', { env: styleletEnv })!;

    expect(angle.add(percentage, { env: styleletEnv }).serialize())
      .toBe('calc(20% + 10deg)');
    expect(angle.interpolate(percentage, 0.5, { env: styleletEnv }).serialize()).toBe('calc(10% + 5deg)');
    expect(angle.accumulate(percentage, { env: styleletEnv }).serialize()).toBe('calc(20% + 10deg)');
  });

  it('applies ranges to math at the computed-value stage', () => {
    const consume = AnglePercentageValue.createConsumer({ min: 0 });
    const specified = new TokenCursor(
      parseListOfComponentValues('calc(-10deg)', {}), { env: styleletEnv },
    );
    const math = AnglePercentageValue.parse('calc(-10deg)', { env: styleletEnv })!;

    expect(consume(specified)).not.toBeNull();
    expect(math.resolve(ValueStage.Computed, {
      env: styleletEnv,
      range: [0, Infinity],
    })).toMatchObject({
      repr: {
        type: 'angle',
        value: 0,
        unit: 'deg',
      },
    });
  });
});
