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
    const from = WholeValue.parse('2', {}, parse)!;
    const to = WholeValue.parse('6', {}, parse)!;
    parse.mockClear();
    const resolveFrom = vi.spyOn(from.ordinaryValue(), 'resolve');
    const resolveTo = vi.spyOn(to.ordinaryValue(), 'resolve');

    const result = from.interpolate(to, 0.25, {});
    expectTypeOf(result).toMatchTypeOf<WholeValue<NumberValue> | null>();
    expect(result).toBeInstanceOf(WholeValue);
    expect(result!.serialize()).toBe('3');
    expect(result!.add(to, {})!.accumulate(from, {})!.serialize()).toBe('11');
    expect(from.serialize()).toBe('2');
    expect(to.serialize()).toBe('6');
    expect(parse).not.toHaveBeenCalled();
    expect(resolveFrom).not.toHaveBeenCalled();
    expect(resolveTo).not.toHaveBeenCalled();
  });

  it('retains the interpolation result type independently of the resolver result', () => {
    const parse = (input: ParserInput, context: PropertyContext) =>
      ColorValue.parse(input, context)?.tryResolveAbsolute(ValueStage.Computed, context) ?? null;
    const from = WholeValue.parse('red', {}, parse)!;
    const to = WholeValue.parse('blue', {}, parse)!;
    const result = from.interpolate(to, 0.5, {});

    expectTypeOf(result).toMatchTypeOf<WholeValue<ColorValue<AbsoluteColor>> | null>();
    expectTypeOf(from.resolve(ValueStage.Computed, {})).toMatchTypeOf<WholeValue<ColorValue>>();
    expectTypeOf<WholeValue<NumberValue>>().not.toExtend<Parameters<typeof from.interpolate>[0]>();
    expect(result!.ordinaryValue().repr).toMatchObject({ components: [0.5, 0, 0.5], alpha: 1 });
  });

  it('checks color representations at runtime without restricting color replacement', () => {
    expectTypeOf<ColorValue>().toExtend<ThisParameterType<ColorValue['interpolate']>>();
    expectTypeOf<ColorValue>().toExtend<Parameters<ColorValue['interpolate']>[0]>();
    expectTypeOf<WholeValue<ColorValue>>().toExtend<ThisParameterType<WholeValue<ColorValue>['interpolate']>>();

    const current = WholeValue.parse('currentcolor', {}, ColorValue.parse)!;
    const relative = WholeValue.parse('rgb(from currentcolor r g b)', {}, ColorValue.parse)!;
    const red = WholeValue.parse('red', {}, ColorValue.parse)!.resolve(ValueStage.Computed, {});
    expect(() => current.interpolate(red, 0.5, {})).toThrow('Color interpolation requires resolved absolute colors');
    expect(() => red.interpolate(current, 0.5, {})).toThrow('Color interpolation requires resolved absolute colors');
    expect(current.add(relative, {})).toBe(relative);
    expect(current.accumulate(relative, {})).toBe(relative);
  });

  it('preserves a contained value\'s request for discrete fallback', () => {
    const parse = (input: ParserInput, context: PropertyContext) => AutoValue.parse(input, context);
    const from = WholeValue.parse('auto', {}, parse)!;
    const to = WholeValue.parse('auto', {}, parse)!;

    expect(from.interpolate(to, 0.5, {})).toBeNull();
    expect(from.add(to, {})).toBeNull();
    expect(from.accumulate(to, {})).toBeNull();
  });

  it('retains color operands selected by addition', () => {
    const property = builtInRegistry.color;
    const red = property.resolve(property.parse('red', {})!, ValueStage.Computed, {});
    const blue = property.resolve(property.parse('blue', {})!, ValueStage.Computed, {});

    expect(red.add(blue, {})).toBe(blue);
    expect(red.accumulate(blue, {})).toBe(blue);
    expect(red.add(red, {})).toBe(red);
  });
});
