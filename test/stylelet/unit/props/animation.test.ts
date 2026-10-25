import { styleletEnv } from '../../environment-fixture';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { PropertyContext } from '../../../../src/stylelet/props/base-property';
import { BuiltInProperty } from '../../../../src/stylelet/props/builtin-property';
import { CustomProperty } from '../../../../src/stylelet/props/custom-property';
import { builtInRegistry, type CustomPropertyRegistration } from '../../../../src/stylelet/props/registry';
import type { ParserInput } from '../../../../src/stylelet/syntax/parser';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { LengthPercentageValue } from '../../../../src/stylelet/values/length-percentage';
import type { OpacityValue } from '../../../../src/stylelet/values/opacity-value';
import { absoluteColorFromRgba, ColorRgba, ColorValue } from '../../../../src/stylelet/values/color';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';
import { SyntaxValue } from '../../../../src/stylelet/values/syntax-value';
import type { Value } from '../../../../src/stylelet/values/value';
import { LengthLiteral, NumberLiteral } from '../../../../src/stylelet/values/numeric-literal/index';

describe('property animation operations', () => {
  it.each([
    [0, '0.25'], [0.25, '0.375'], [0.5, '0.5'], [1, '0.75'], [-1, '-0.25'], [2, '1.25'],
  ] as const)('interpolates opacity at progress %s without clamping', (progress, expected) => {
    const property = builtInRegistry.opacity;
    const from = property.resolve(property.parse('25%', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const to = property.resolve(property.parse('0.75', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const result = property.interpolate(from, to, progress, { env: styleletEnv });

    expectTypeOf(result).toMatchTypeOf<WholeValue<OpacityValue> | null>();
    expect(result!.serialize()).toBe(expected);
    expect(from.serialize()).toBe('0.25');
    expect(to.serialize()).toBe('0.75');
  });

  it('clamps opacity only after the complete combination sequence', () => {
    const property = builtInRegistry.opacity;
    const low = property.resolve(property.parse('0.25', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const high = property.resolve(property.parse('0.75', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const sum = property.add(high, high, { env: styleletEnv })!;
    const delta = property.interpolate(low, high, -2, { env: styleletEnv })!;
    const corrected = property.accumulate(sum, delta, { env: styleletEnv })!;

    expect(sum.serialize()).toBe('1.5');
    expect(delta.serialize()).toBe('-0.75');
    expect(corrected.serialize()).toBe('0.75');
    expect(property.resolve(corrected, ValueStage.Computed, { env: styleletEnv }).serialize()).toBe('0.75');
    expect(property.resolve(sum, ValueStage.Computed, { env: styleletEnv }).serialize()).toBe('1');
    expect(property.resolve(delta, ValueStage.Computed, { env: styleletEnv }).serialize()).toBe('0');
    expect(sum.serialize()).toBe('1.5');
  });

  it.each(['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const)(
    'combines %s lengths and percentages before layout supplies their reference', (name) => {
      const property = builtInRegistry[name];
      const from = property.resolve(property.parse('10px', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
      const to = property.resolve(property.parse('20%', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
      const context = { env: styleletEnv, containingBlockInlineSize: 200, percentageReferenceValue: new LengthLiteral(1000, 'px') };
      const interpolated = property.interpolate(from, to, 0.5, context)!;
      const added = property.add(from, to, context)!;
      const accumulated = property.accumulate(from, to, context)!;

      expect(interpolated.serialize()).toContain('10%');
      expect(property.resolve(interpolated, ValueStage.Used, context).serialize()).toBe('25px');
      expect(property.resolve(interpolated, ValueStage.Used, { env: styleletEnv, containingBlockInlineSize: 400 }).serialize()).toBe('45px');
      expect(property.resolve(added, ValueStage.Used, context).serialize()).toBe('50px');
      expect(property.resolve(accumulated, ValueStage.Used, context).serialize()).toBe('50px');
      expect(context.percentageReferenceValue.value).toBe(1000);
      expect(to.serialize()).toBe('20%');
    },
  );

  it('lets a value accept a compatible subclass without matching constructors', () => {
    class DerivedLengthPercentageValue extends LengthPercentageValue {}
    const property = builtInRegistry['margin-left'];
    const from = property.createValue(new DerivedLengthPercentageValue(new LengthLiteral(10, 'px')));
    const to = property.parse('20px', { env: styleletEnv })!;

    for (const [a, b] of [[from, to], [to, from]] as const) {
      expect(property.interpolate(a, b, 0.5, { env: styleletEnv })!.serialize()).toBe('15px');
      expect(property.add(a, b, { env: styleletEnv })!.serialize()).toBe('30px');
      expect(property.accumulate(a, b, { env: styleletEnv })!.serialize()).toBe('30px');
    }
  });

  it.each(['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const)(
    'uses discrete fallback for %s auto in either operand position', (name) => {
      const property = builtInRegistry[name];
      const auto = property.resolve(property.parse('auto', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
      const length = property.resolve(property.parse('20px', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });

      for (const [from, to] of [[auto, length], [length, auto]] as const) {
        expect(property.interpolate(from, to, 0.499, { env: styleletEnv })).toBe(from);
        expect(property.interpolate(from, to, 0.5, { env: styleletEnv })).toBe(to);
        expect(property.add(from, to, { env: styleletEnv })).toBe(to);
        expect(property.accumulate(from, to, { env: styleletEnv })).toBe(to);
      }
      expect(property.interpolate(auto, auto, 0.5, { env: styleletEnv })).toBe(auto);
    },
  );

  it.each(['color', 'background-color'] as const)('uses premultiplied color interpolation for %s', (name) => {
    const property = builtInRegistry[name];
    const from = property.resolve(property.parse('transparent', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const to = property.resolve(property.parse('red', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const result = property.interpolate(from, to, 0.5, { env: styleletEnv })!;

    expect(result.inner).toMatchObject({ repr: { space: { name: 'srgb' }, components: [1, 0, 0], alpha: 0.5 } });
    expect(property.add(from, to, { env: styleletEnv })).toBe(to);
    expect(property.add(to, from, { env: styleletEnv })).toBe(from);
    expect(property.accumulate(from, to, { env: styleletEnv })).toBe(to);
    expect(from.serialize()).toBe('rgba(0, 0, 0, 0)');
  });

  it('uses the color value interpolation space rule for modern colors', () => {
    const property = builtInRegistry.color;
    const from = property.resolve(property.parse('oklab(0.2 0 0)', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const to = property.resolve(property.parse('oklab(0.8 0 0)', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });

    expect(property.interpolate(from, to, 0.5, { env: styleletEnv })!.serialize()).toBe('oklab(0.5 0 0)');
  });

  it('keeps missing contextual color computation explicit', () => {
    const property = builtInRegistry.color;
    const from = property.resolve(property.parse('currentcolor', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const to = property.resolve(property.parse('red', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });

    expect(() => property.interpolate(from, to, 0.5, { env: styleletEnv })).toThrow('Color interpolation requires resolved absolute colors');
    const context = { env: styleletEnv, currentColor: absoluteColorFromRgba(ColorRgba.blue) };
    const resolved = property.resolve(from, ValueStage.Used, context);
    expect(resolved.inner).toBeInstanceOf(ColorValue);
    expect(property.interpolate(resolved, to, 0.5, context)!.inner)
      .toMatchObject({ repr: { space: { name: 'srgb' }, components: [0.5, 0, 0.5], alpha: 1 } });
  });

  it.each(['initial', 'var(--alpha)', 'first-valid(0.5)'])('requires defaulting and substitution before animating %s', (text) => {
    const property = builtInRegistry.opacity;
    const unresolved = property.parse(text, { env: styleletEnv })!;
    const computed = property.resolve(property.initialValue, ValueStage.Computed, { env: styleletEnv });

    expect(() => property.interpolate(unresolved, computed, 0.5, { env: styleletEnv })).toThrow('Expected an ordinary value after substitution and defaulting');
    expect(() => property.add(computed, unresolved, { env: styleletEnv })).toThrow('Expected an ordinary value after substitution and defaulting');
  });

  it('passes whole values through property-specific animation rules', () => {
    type W = WholeValue<NumberValue>;
    const parse = vi.fn((input: ParserInput, context: PropertyContext) => NumberValue.parse(input, context));
    const interpolate = vi.fn((from: W, to: W, progress: number, context: PropertyContext) => from.interpolate(to, progress, context));
    const add = vi.fn((from: W, to: W, context: PropertyContext) => from.add(to, context));
    const accumulate = vi.fn((from: W, to: W, context: PropertyContext) => from.add(to, context)!.add(to, context));
    const property = new BuiltInProperty({
      name: 'sample', parse, initialValue: new NumberValue(new NumberLiteral(0)),
      inherits: false, percentages: 'not-applicable', animationType: { interpolate, add, accumulate },
      appliesTo: () => true,
      resolvedValueStage: ValueStage.Computed,
    });
    const from = property.resolve(property.parse('2', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const to = property.resolve(property.parse('6', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    parse.mockClear();

    const context = { env: styleletEnv };
    const interpolated = property.interpolate(from, to, 0.25, context);
    const added = property.add(from, to, context);
    const accumulated = property.accumulate(from, to, context);
    expect(interpolated!.serialize()).toBe('3');
    expect(added!.serialize()).toBe('8');
    expect(accumulated!.serialize()).toBe('14');
    expect(parse).not.toHaveBeenCalled();
    expect(interpolate).toHaveBeenCalledExactlyOnceWith(from, to, 0.25, context);
    expect(add).toHaveBeenCalledExactlyOnceWith(from, to, context);
    expect(accumulate).toHaveBeenCalledExactlyOnceWith(from, to, context);
    expect(interpolated).toBe(interpolate.mock.results[0]!.value);
    expect(added).toBe(add.mock.results[0]!.value);
    expect(accumulated).toBe(accumulate.mock.results[0]!.value);

    property.animationType = { interpolate: () => null, add: () => null, accumulate: () => null };
    expect(property.interpolate(from, to, 0.25, { env: styleletEnv })).toBe(from);
    expect(property.interpolate(from, to, 0.5, { env: styleletEnv })).toBe(to);
    expect(property.add(from, to, { env: styleletEnv })).toBe(to);
    expect(property.accumulate(from, to, { env: styleletEnv })).toBe(to);
  });

  it('uses existing numeric methods without a value dispatcher', () => {
    const property = new BuiltInProperty({
      name: 'sample', parse: (input, context) => NumberValue.parse(input, context), initialValue: new NumberValue(new NumberLiteral(0)),
      inherits: false, percentages: 'not-applicable', animationType: 'by-computed-value',
      appliesTo: () => true,
      resolvedValueStage: ValueStage.Computed,
    });
    const from = property.parse('2', { env: styleletEnv })!;
    const to = property.parse('6', { env: styleletEnv })!;
    expect(property.interpolate(from, to, 0.25, { env: styleletEnv })!.serialize()).toBe('3');
    expect(property.add(from, to, { env: styleletEnv })!.serialize()).toBe('8');
    expect(property.accumulate(from, to, { env: styleletEnv })!.serialize()).toBe('8');
  });

  it('distinguishes discrete, non-animatable, and unfinished combination behavior', () => {
    const property = new BuiltInProperty({
      name: 'sample', parse: (input, context) => NumberValue.parse(input, context), initialValue: new NumberValue(new NumberLiteral(0)),
      inherits: false, percentages: 'not-applicable', animationType: 'discrete',
      appliesTo: () => true,
      resolvedValueStage: ValueStage.Computed,
    });
    const from = property.resolve(property.parse('2', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const to = property.resolve(property.parse('6', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    expect(property.interpolate(from, to, 0.25, { env: styleletEnv })).toBe(from);
    expect(property.interpolate(from, to, 0.5, { env: styleletEnv })).toBe(to);
    expect(property.add(from, to, { env: styleletEnv })).toBe(to);
    expect(property.accumulate(from, to, { env: styleletEnv })).toBe(to);

    property.animationType = 'not-animatable';
    expect(property.interpolate(from, to, 0.5, { env: styleletEnv })).toBeNull();
    expect(property.add(from, to, { env: styleletEnv })).toBeNull();
    expect(property.accumulate(from, to, { env: styleletEnv })).toBeNull();

    property.animationType = 'repeatable-list';
    expect(() => property.interpolate(from, to, 0.5, { env: styleletEnv })).toThrow('Repeatable-list property animation is not implemented');
    expect(() => property.add(from, to, { env: styleletEnv })).toThrow('Repeatable-list property animation is not implemented');
    expect(() => property.accumulate(from, to, { env: styleletEnv })).toThrow('Repeatable-list property animation is not implemented');
  });

  it('does not mistake a missing value operation for specified discrete behavior', () => {
    const value: Value = { resolve() { return this; }, serialize() { return 'sample'; } };
    const property = new BuiltInProperty({
      name: 'sample', parse: () => value, initialValue: value,
      inherits: false, percentages: 'not-applicable', animationType: 'by-computed-value',
      appliesTo: () => true,
      resolvedValueStage: ValueStage.Computed,
    });
    expect(() => property.interpolate(property.initialValue, property.initialValue, 0.5, { env: styleletEnv }))
      .toThrow('Computed value interpolation is not implemented for this value type');
    expect(() => property.add(property.initialValue, property.initialValue, { env: styleletEnv }))
      .toThrow('Computed value addition is not implemented for this value type');
    expect(() => property.accumulate(property.initialValue, property.initialValue, { env: styleletEnv }))
      .toThrow('Computed value accumulation is not implemented for this value type');
  });
});

describe('custom-property animation', () => {
  it('selects retained values discretely, preserving source spelling and the invalid value', () => {
    const property = new CustomProperty('--color');
    const from = property.resolve(property.parse('r\\65 d/**/', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    const to = property.resolve(property.parse('blue', { env: styleletEnv })!, ValueStage.Computed, { env: styleletEnv });
    expect(property.interpolate(from, to, 0.499, { env: styleletEnv })).toBe(from);
    expect(property.interpolate(from, to, 0.5, { env: styleletEnv })).toBe(to);
    expect(property.serialize(property.interpolate(from, to, 0.25, { env: styleletEnv }))).toBe('r\\65 d/**/');
    expect(property.add(from, to, { env: styleletEnv })).toBe(to);
    expect(property.accumulate(from, to, { env: styleletEnv })).toBe(to);
    expect(property.interpolate(from, property.initialValue, 0.5, { env: styleletEnv })).toBe(property.initialValue);
  });

  it('does not silently treat a newly registered custom property as unregistered', () => {
    const property = new CustomProperty('--size');
    const from = property.parse('2px', { env: styleletEnv })!;
    const to = property.parse('6px', { env: styleletEnv })!;
    const syntax = SyntaxValue.parse('<length>', {})!;
    const parseOrdinary = syntax.createParser();
    const registration: CustomPropertyRegistration = {
      name: '--size', syntax, inherits: false,
      parse: (input, context) => WholeValue.parse(input, context, parseOrdinary, true),
      initialValue: WholeValue.parse('0px', { env: styleletEnv }, parseOrdinary, true)!,
    };
    const customPropertyRegistry = new Map([['--size' as const, registration]]);
    const context = { env: styleletEnv, customPropertyRegistry };
    expect(() => property.interpolate(from, to, 0.5, context)).toThrow('Registered custom-property animation is not implemented');
    expect(() => property.add(from, to, context)).toThrow('Registered custom-property animation is not implemented');
    expect(() => property.accumulate(from, to, context)).toThrow('Registered custom-property animation is not implemented');
    customPropertyRegistry.clear();
    expect(property.interpolate(from, to, 0.5, context)).toBe(to);
  });
});
