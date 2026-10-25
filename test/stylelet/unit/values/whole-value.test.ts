import { styleletEnv } from '../../environment-fixture';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { PropertyContext } from '../../../../src/stylelet/props/base-property';
import { builtInRegistry } from '../../../../src/stylelet/props/registry';
import type { ParserInput } from '../../../../src/stylelet/syntax/parser';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { AutoValue } from '../../../../src/stylelet/values/auto';
import { ColorValue, type AbsoluteColor } from '../../../../src/stylelet/values/color';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';

describe('whole-value animation operations', () => {
  it('returns complete values without reparsing, resolving, or changing its operands', () => {
    const parse = vi.fn((input: ParserInput, context: PropertyContext) => NumberValue.parse(input, context));
    const from = WholeValue.parse('2', { env: styleletEnv }, parse)!;
    const to = WholeValue.parse('6', { env: styleletEnv }, parse)!;
    parse.mockClear();
    const resolveFrom = vi.spyOn(from.ordinaryValue(), 'resolve');
    const resolveTo = vi.spyOn(to.ordinaryValue(), 'resolve');

    const result = from.interpolate(to, 0.25, { env: styleletEnv });
    expectTypeOf(result).toMatchTypeOf<WholeValue<NumberValue> | null>();
    expect(result).toBeInstanceOf(WholeValue);
    expect(result!.serialize()).toBe('3');
    expect(result!.add(to, { env: styleletEnv })!.accumulate(from, { env: styleletEnv })!.serialize()).toBe('11');
    expect(from.serialize()).toBe('2');
    expect(to.serialize()).toBe('6');
    expect(parse).not.toHaveBeenCalled();
    expect(resolveFrom).not.toHaveBeenCalled();
    expect(resolveTo).not.toHaveBeenCalled();
  });

  it('retains the interpolation result type independently of the resolver result', () => {
    const parse = (input: ParserInput, context: PropertyContext) =>
      ColorValue.parse(input, context)?.tryResolveAbsolute(ValueStage.Computed, context) ?? null;
    const from = WholeValue.parse('red', { env: styleletEnv }, parse)!;
    const to = WholeValue.parse('blue', { env: styleletEnv }, parse)!;
    const result = from.interpolate(to, 0.5, { env: styleletEnv });

    expectTypeOf(result).toMatchTypeOf<WholeValue<ColorValue<AbsoluteColor>> | null>();
    expectTypeOf(from.resolve(ValueStage.Computed, { env: styleletEnv })).toMatchTypeOf<WholeValue<ColorValue>>();
    expectTypeOf<WholeValue<NumberValue>>().not.toExtend<Parameters<typeof from.interpolate>[0]>();
    expect(result!.ordinaryValue().repr).toMatchObject({ components: [0.5, 0, 0.5], alpha: 1 });
  });

  it('checks color representations at runtime without restricting color replacement', () => {
    expectTypeOf<ColorValue>().toExtend<ThisParameterType<ColorValue['interpolate']>>();
    expectTypeOf<ColorValue>().toExtend<Parameters<ColorValue['interpolate']>[0]>();
    expectTypeOf<WholeValue<ColorValue>>().toExtend<ThisParameterType<WholeValue<ColorValue>['interpolate']>>();

    const current = WholeValue.parse('currentcolor', { env: styleletEnv }, ColorValue.parse)!;
    const relative = WholeValue.parse('rgb(from currentcolor r g b)', { env: styleletEnv }, ColorValue.parse)!;
    const red = WholeValue.parse('red', { env: styleletEnv }, ColorValue.parse)!.resolve(ValueStage.Computed, { env: styleletEnv });
    expect(() => current.interpolate(red, 0.5, { env: styleletEnv })).toThrow('Color interpolation requires resolved absolute colors');
    expect(() => red.interpolate(current, 0.5, { env: styleletEnv })).toThrow('Color interpolation requires resolved absolute colors');
    expect(current.add(relative, { env: styleletEnv })).toBe(relative);
    expect(current.accumulate(relative, { env: styleletEnv })).toBe(relative);
  });

  it('preserves a contained value\'s request for discrete fallback', () => {
    const parse = (input: ParserInput, context: PropertyContext) => AutoValue.parse(input, context);
    const from = WholeValue.parse('auto', { env: styleletEnv }, parse)!;
    const to = WholeValue.parse('auto', { env: styleletEnv }, parse)!;

    expect(from.interpolate(to, 0.5, { env: styleletEnv })).toBeNull();
    expect(from.add(to, { env: styleletEnv })).toBeNull();
    expect(from.accumulate(to, { env: styleletEnv })).toBeNull();
  });

  it('retains color operands selected by addition', () => {
    const property = builtInRegistry.color;
    const red = property.resolve(property.parse('red', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const blue = property.resolve(property.parse('blue', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });

    expect(red.add(blue, { env: styleletEnv })).toBe(blue);
    expect(red.accumulate(blue, { env: styleletEnv })).toBe(blue);
    expect(red.add(red, { env: styleletEnv })).toBe(red);
  });
});
