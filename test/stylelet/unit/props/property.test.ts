import { styleletEnv } from '../../environment-fixture';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { GuaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { CssWideValue } from '../../../../src/stylelet/values/css-wide';
import { SubstitutionValue } from '../../../../src/stylelet/values/substitution-value';
import { FirstValidValue } from '../../../../src/stylelet/values/substitution/first-valid';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { colorProperty } from '../../../../src/stylelet/props/built-in/color';
import type { BaseProperty, PropertyContext } from '../../../../src/stylelet/props/base-property';
import { BuiltInProperty, type BuiltInPropertyDefinition } from '../../../../src/stylelet/props/builtin-property';
import { Shorthand } from '../../../../src/stylelet/props/shorthand';
import { builtInRegistry, type BuiltInPropertyName } from '../../../../src/stylelet/props/registry';
import { InterpretedDeclaration } from '../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import {
  absoluteColorFromRgba, ColorValue, ColorKind, ColorRgba,
} from '../../../../src/stylelet/values/color';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';
import type { Value } from '../../../../src/stylelet/values/value';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { LengthLiteral, NumberLiteral } from '../../../../src/stylelet/values/numeric-literal/index';

describe('property records', () => {
  it.each([
    ['color', true, 'CanvasText'],
    ['background-color', false, 'transparent'],
    ['opacity', false, '1'],
    ['margin-top', false, '0'],
    ['margin-right', false, '0'],
    ['margin-bottom', false, '0'],
    ['margin-left', false, '0'],
  ] as const)('stores the parsed initial value and inheritance for %s', (name, inherits, text) => {
    const property = builtInRegistry[name];
    expect(property.inherits).toBe(inherits);
    expect(property.name).toBe(name);
    const declarations = InterpretedDeclaration.parseBlock(`${name}: ${text}`, { env: styleletEnv });
    expect(declarations[0]!.property).toBe(property);
    expect(declarations).toMatchObject([{
      custom: false,
      name,
      value: property.initialValue,
      important: false,
    }]);
  });

  it('shares color value behavior between distinct property records', () => {
    expect(builtInRegistry.color).not.toBe(builtInRegistry['background-color']);
    expect(builtInRegistry.color.parse('red', { env: styleletEnv }))
      .toEqual(builtInRegistry['background-color'].parse('red', { env: styleletEnv }));
  });

  it('serializes one whole value or the complete longhand values of a shorthand', () => {
    const side = builtInRegistry['margin-top'].parse('2em', { env: styleletEnv })!;
    expect(builtInRegistry['margin-top'].serialize(side)).toBe('2em');

    const margin = builtInRegistry.margin;
    const sides = margin.shorthand!.parse('1em 2em', { env: styleletEnv }, margin.name)!;
    expect(margin.serialize(sides)).toBe('1em 2em');
    expect(margin.serialize(sides.slice(0, 3))).toBe('');
    expect(builtInRegistry['margin-top'].serialize(sides)).toBe('');
  });

  it('links constructed shorthand properties in preferred order without registry setup', () => {
    class TestShorthand extends Shorthand<NumberValue> {
      serialize(text: string[]): string { return text.join(' '); }
      protected parseLonghands(): null { return null; }
    }
    const definition: Omit<BuiltInPropertyDefinition<NumberValue>, 'name'> = {
      parse: (input, context) => NumberValue.parse(input, context), initialValue: new NumberValue(new NumberLiteral(0)),
      inherits: false, appliesTo: () => true, percentages: 'not-applicable', animationType: 'by-computed-value',
      resolvedValueStage: ValueStage.Computed,
    };
    const first = new BuiltInProperty({ ...definition, name: 'first' });
    const second = new BuiltInProperty({ ...definition, name: 'second' });
    for (const name of ['-other-z', '-webkit-z', 'beta', 'alpha', '-webkit-a', '-other-a']) {
      new BuiltInProperty({ ...definition, name, shorthand: new TestShorthand([first]) });
    }
    const broad = new BuiltInProperty({
      ...definition, name: '-other-broad', shorthand: new TestShorthand([first, second]),
    });

    expect(first.containingShorthands.map(({ name }) => name)).toEqual([
      '-other-broad', 'alpha', 'beta', '-webkit-a', '-webkit-z', '-other-a', '-other-z',
    ]);
    expect(second.containingShorthands).toEqual([broad]);
  });

  it.each(['color', 'background-color', 'opacity'] as const)('records all-element applicability for %s', (name) => {
    expect(builtInRegistry[name].appliesTo({ env: styleletEnv })).toBe(true);
  });

  it.each(['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const)(
    'requires box classification to determine %s applicability', (name) => {
      expect(() => builtInRegistry[name].appliesTo({ env: styleletEnv })).toThrow('Margin applicability requires box classification');
    },
  );

  it('keeps a computed value even when the property does not apply', () => {
    const appliesTo = vi.fn((_context: PropertyContext) => false);
    const property = new BuiltInProperty({
      name: 'sample', parse: (input, context) => NumberValue.parse(input, context), initialValue: new NumberValue(new NumberLiteral(0)),
      inherits: false, appliesTo, percentages: 'not-applicable', animationType: 'by-computed-value',
      resolvedValueStage: ValueStage.Computed,
    });
    const context: PropertyContext = { env: styleletEnv };
    const declared = property.parse('2', context)!;
    expect(property.resolve(declared, ValueStage.Computed, context).serialize()).toBe('2');
    expect(appliesTo).not.toHaveBeenCalled();
    expect(property.appliesTo(context)).toBe(false);
    expect(appliesTo).toHaveBeenCalledWith(context);
  });

  it('retains the property grammar when constructing a deferred value directly', () => {
    const declared = builtInRegistry.opacity.createValue(
      new SubstitutionValue(OptionalDeclarationValue.parse('var(--alpha)', {})!),
    );

    expect(builtInRegistry.opacity.resolve(declared, ValueStage.Computed, {
      env: styleletEnv,
      getCustomProperty: () => OptionalDeclarationValue.parse('150%', {})!,
    }).serialize()).toBe('1');
    expect(builtInRegistry.opacity.resolve(declared, ValueStage.Computed, {
      env: styleletEnv,
      getCustomProperty: () => OptionalDeclarationValue.parse('red', {})!,
    }).inner).toBeInstanceOf(GuaranteedInvalidValue);
    expect(declared.serialize()).toBe('var(--alpha)');
  });

  it('resolves CanvasText with each palette without changing the shared initial value', () => {
    const { initialValue } = builtInRegistry.color;
    const light = absoluteColorFromRgba(ColorRgba.black);
    const dark = absoluteColorFromRgba(ColorRgba.white);

    expect(initialValue.serialize()).toBe('canvastext');
    expect(builtInRegistry.color.resolve(initialValue, ValueStage.Computed, {
      env: styleletEnv,
      systemColors: new Map([['canvastext', light]]),
    })).toMatchObject({ inner: { repr: light } });
    expect(builtInRegistry.color.resolve(initialValue, ValueStage.Computed, {
      env: styleletEnv,
      systemColors: new Map([['canvastext', dark]]),
    })).toMatchObject({ inner: { repr: dark } });
    expect(initialValue).toMatchObject({ inner: { repr: { kind: ColorKind.System, name: 'canvastext' } } });
  });

  it.each(['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const)(
    'uses the containing block inline size for %s percentages only at used time', (name) => {
      const property = builtInRegistry[name];
      const declared = property.parse('calc(10% + 2px)', { env: styleletEnv })!;
      const unrelatedReference = new LengthLiteral(50, 'px');
      const context = { env: styleletEnv, containingBlockInlineSize: 200, percentageReferenceValue: unrelatedReference };

      const computed = property.resolve(declared, ValueStage.Computed, context);
      expect(computed.serialize()).toContain('10%');

      expect(property.resolve(computed, ValueStage.Used, context).serialize()).toBe('22px');
      expect(property.resolve(computed, ValueStage.Used, {
        env: styleletEnv,
        containingBlockInlineSize: 400,
      }).serialize()).toBe('42px');
      expect(computed.serialize()).toContain('10%');
      expect(context.percentageReferenceValue).toBe(unrelatedReference);
    },
  );

  it('leaves a margin percentage unresolved while its containing block size is unavailable', () => {
    const property = builtInRegistry['margin-left'];
    const declared = property.parse('25%', { env: styleletEnv })!;

    expect(property.resolve(declared, ValueStage.Used, { env: styleletEnv }).serialize()).toBe('25%');
    expect(property.resolve(declared, ValueStage.Used, {
      env: styleletEnv,
      containingBlockInlineSize: 0,
    }).serialize()).toBe('0px');
  });

  it('uses the property percentage rule on a selected declaration\'s value', () => {
    const [declaration] = InterpretedDeclaration.parseBlock('margin-left: 25%', { env: styleletEnv });
    if (declaration?.name !== 'margin-left') throw new Error('Expected a margin-left declaration');
    const resolved = declaration.property.resolve(declaration.value, ValueStage.Used, { env: styleletEnv, containingBlockInlineSize: 200 });

    expect(resolved.serialize()).toBe('50px');
    expect(declaration.serializeValue()).toBe('25%');
  });

  it('accepts typed property animation methods', () => {
    const property = new BuiltInProperty({
      name: 'sample',
      parse: (input, context) => NumberValue.parse(input, context),
      initialValue: new NumberValue(new NumberLiteral(0)),
      inherits: false,
      appliesTo: () => true,
      percentages: 'not-applicable',
      resolvedValueStage: ValueStage.Computed,
      animationType: {
        interpolate(from, to, progress, context) {
          expectTypeOf(from).toEqualTypeOf<WholeValue<NumberValue>>();
          expectTypeOf(to).toEqualTypeOf<WholeValue<NumberValue>>();
          expectTypeOf(context).toEqualTypeOf<PropertyContext>();
          return from.interpolate(to, progress, context);
        },
        add(from, to, context) {
          expectTypeOf(from).toEqualTypeOf<WholeValue<NumberValue>>();
          expectTypeOf(to).toEqualTypeOf<WholeValue<NumberValue>>();
          expectTypeOf(context).toEqualTypeOf<PropertyContext>();
          return null;
        },
        accumulate(from, to, context) {
          expectTypeOf(from).toEqualTypeOf<WholeValue<NumberValue>>();
          expectTypeOf(to).toEqualTypeOf<WholeValue<NumberValue>>();
          expectTypeOf(context).toEqualTypeOf<PropertyContext>();
          return null;
        },
      },
    });
    const from = property.createValue(new NumberValue(new NumberLiteral(2)));
    const to = property.createValue(new NumberValue(new NumberLiteral(6)));
    expect(property.interpolate(from, to, 0.25, { env: styleletEnv })!.serialize()).toBe('3');
    expect(property.add(from, to, { env: styleletEnv })).toBe(to);
    expect(property.accumulate(from, to, { env: styleletEnv })).toBe(to);
  });
});

describe('property value', () => {
  it('resolves whole values through the engine\'s built-in property contract', () => {
    const property: BuiltInProperty<Value, BuiltInPropertyName> = builtInRegistry.opacity;
    const declared = property.parse('150%', { env: styleletEnv })!;
    const computed = property.resolve(declared, ValueStage.Computed, { env: styleletEnv });

    expectTypeOf(property.name).toEqualTypeOf<BuiltInPropertyName>();
    expectTypeOf(computed).toEqualTypeOf<WholeValue>();
    expect(computed.serialize()).toBe('1');
  });

  it('restricts resolution to the property\'s whole-value family', () => {
    type ColorInput = Parameters<typeof builtInRegistry.color.resolve>[0];
    type OpacityInput = Parameters<typeof builtInRegistry.opacity.resolve>[0];
    expectTypeOf<typeof builtInRegistry.opacity.initialValue>().not.toExtend<ColorInput>();
    expectTypeOf<typeof builtInRegistry.color.initialValue>().not.toExtend<OpacityInput>();
    expectTypeOf(() => {
      // @ts-expect-error A color property cannot resolve an opacity whole value.
      builtInRegistry.color.resolve(builtInRegistry.opacity.initialValue, ValueStage.Computed, { env: styleletEnv });
    }).toBeFunction();
  });

  it('preserves the whole-value family through the base property contract', () => {
    const property: BaseProperty<WholeValue<ColorValue>, 'color'> = builtInRegistry.color;
    const declared = property.parse('red', { env: styleletEnv })!;
    const computed = property.resolve(declared, ValueStage.Computed, { env: styleletEnv });
    expectTypeOf(computed).toEqualTypeOf<WholeValue<ColorValue>>();
    expect(computed.serialize()).toBe('rgb(255, 0, 0)');
  });

  it('preserves an exact value type through the property registry', () => {
    const declared = builtInRegistry.color.parse('red', { env: styleletEnv })!;
    const computed = builtInRegistry.color.resolve(declared, ValueStage.Computed, { env: styleletEnv });

    expectTypeOf(declared).toEqualTypeOf<WholeValue<ColorValue>>();
    expectTypeOf(computed).toEqualTypeOf<ReturnType<typeof declared.resolve>>();
    expect(declared.serialize()).toBe('red');
    expect(computed.serialize()).toBe('rgb(255, 0, 0)');

    if (computed.inner instanceof ColorValue) {
      expect(computed.inner.repr.kind).toBe(ColorKind.Absolute);
    }
  });

  describe('ordinary value', () => {
    it('prepares unitless margin zero as a length before serialization', () => {
      const declared = builtInRegistry['margin-top'].parse('0', { env: styleletEnv })!;

      expect(declared.inner).toMatchObject({ repr: { value: 0, unit: 'px' } });
      expect(declared.serialize()).toBe('0px');
    });

    it('returns a parsed color ready to retain in a declaration', () => {
      const declared = colorProperty.parse('red', { env: styleletEnv })!;

      expect(declared).toMatchObject({
        inner: {
          repr: {
            kind: ColorKind.Named,
            name: 'red',
          },
        },
      });
      expect(declared.serialize()).toBe('red');
      expect(declared.resolve(ValueStage.Computed, { env: styleletEnv })).toMatchObject({
        inner: {
          repr: {
            kind: ColorKind.Absolute,
          },
        },
      });
    });

    it('rejects a free-form brace wrapper while parsing the property', () => {
      expect(colorProperty.parse('{red}', { env: styleletEnv })).toBeNull();
    });

    it('retains contextual color dependencies after parsing', () => {
      const declared = colorProperty.parse('currentcolor', { env: styleletEnv })!;

      expect(declared.inner).toBeInstanceOf(ColorValue);
      expect(declared.serialize()).toBe('currentcolor');
      expect(declared.resolve(ValueStage.Specified, { env: styleletEnv }).serialize())
        .toBe('currentcolor');
    });

    it('applies the supplied declared-stage math options while parsing', () => {
      const context = { env: styleletEnv, unwrapMathAt: ValueStage.Declared };
      const opacity = builtInRegistry.opacity.parse('calc(150%)', context)!;
      const margin = builtInRegistry['margin-left'].parse('calc(1px + 2px)', context)!;

      expect(opacity.serialize()).toBe('1.5');
      expect(margin.serialize()).toBe('3px');
      expect(InterpretedDeclaration.parseBlock('opacity: calc(150%); margin-left: calc(1px + 2px)', context))
        .toMatchObject([
          { name: 'opacity', value: opacity },
          { name: 'margin-left', value: margin },
        ]);
    });

    it('retains the specified value when resolving it in different contexts', () => {
      const property = builtInRegistry['margin-top'];
      const declared = property.parse('2em', { env: styleletEnv })!;
      const specified = declared.resolve(ValueStage.Specified, { env: styleletEnv });
      const small = specified.resolve(ValueStage.Computed, { env: styleletEnv, length: { em: 16 } });
      const large = specified.resolve(ValueStage.Computed, { env: styleletEnv, length: { em: 24 } });

      expect(small.serialize()).toBe('32px');
      expect(large.serialize()).toBe('48px');
      expect(specified.serialize()).toBe('2em');
      expect(declared.serialize()).toBe('2em');
    });

    it('keeps serialization at the current stage through the whole-value lifecycle', () => {
      const property = builtInRegistry.opacity;
      const declared = property.parse('150%', { env: styleletEnv })!;
      let value = declared;

      expect(value.serialize()).toBe('1.5');
      for (const stage of [ValueStage.Cascaded, ValueStage.Specified]) {
        value = value.resolve(stage, { env: styleletEnv });
        expect(value.serialize()).toBe('1.5');
      }
      for (const stage of [ValueStage.Computed, ValueStage.Used, ValueStage.Actual]) {
        value = value.resolve(stage, { env: styleletEnv });
        expect(value.serialize()).toBe('1');
      }
      expect(declared.serialize()).toBe('1.5');
    });
  });

  describe('whole-value notation', () => {
    it('retains only the consuming parser and stops before unused alternatives', () => {
      const parseOrdinary = vi.fn(ColorValue.parse);
      const declared = WholeValue.parse('first-valid(10px, red, blue)', { env: styleletEnv }, parseOrdinary)!;

      expect(parseOrdinary).not.toHaveBeenCalled();
      expect(declared.resolve(ValueStage.Specified, { env: styleletEnv })).toBe(declared);
      expect(declared.serialize()).toBe('first-valid(10px, red, blue)');
      expect(parseOrdinary).not.toHaveBeenCalled();

      const computed = declared.resolve(ValueStage.Computed, { env: styleletEnv });
      expect(computed.serialize()).toBe('rgb(255, 0, 0)');
      expect(parseOrdinary).toHaveBeenCalledTimes(2);
      expect(declared.serialize()).toBe('first-valid(10px, red, blue)');
    });

    it('adds whole-value notation to a reusable value parser', () => {
      const parsed = WholeValue.parse('first-valid(10px, red)', { env: styleletEnv }, ColorValue.parse)!;

      expect(parsed.resolve(ValueStage.Computed, { env: styleletEnv })).toMatchObject({
        inner: {
          repr: {
            kind: ColorKind.Absolute,
          },
        },
      });
    });

    it('selects the first argument valid for the property', () => {
      const input = colorProperty.parse('first-valid(10px, red)', { env: styleletEnv })!;
      const specified = input.resolve(ValueStage.Specified, { env: styleletEnv });

      expect(input.inner).toBeInstanceOf(FirstValidValue);
      expect(specified).toBe(input);
      expect(specified.inner).toBeInstanceOf(FirstValidValue);
      expect(specified.serialize()).toBe('first-valid(10px, red)');
      expect(specified.resolve(ValueStage.Specified, { env: styleletEnv })).toBe(specified);
      expect(input.resolve(ValueStage.Computed, { env: styleletEnv })).toMatchObject({
        inner: {
          repr: {
            kind: ColorKind.Absolute,
          },
        },
      });
    });

    it('becomes guaranteed-invalid when no argument is valid', () => {
      const input = colorProperty.parse('first-valid(10px, 20px)', { env: styleletEnv })!;

      expect(input).not.toBeNull();
      expect(input.resolve(ValueStage.Computed, { env: styleletEnv }).inner).toBeInstanceOf(GuaranteedInvalidValue);
    });

    it('resolves each argument through the complete property pipeline', () => {
      const input = colorProperty.parse('first-valid(inherit, red)', { env: styleletEnv })!;

      expect(input.resolve(ValueStage.Computed, { env: styleletEnv })).toMatchObject({ inner: new CssWideValue('inherit') });
    });
  });

  describe('CSS-wide value', () => {
    it('recognizes a CSS-wide keyword as the entire property value', () => {
      const declared = colorProperty.parse(' InHeRiT ', { env: styleletEnv })!;

      expect(declared).toMatchObject({ inner: new CssWideValue('inherit') });
      expect(declared.serialize()).toBe('inherit');
      // The cascade owns defaulting; the value alone retains the keyword.
      expect(declared.resolve(ValueStage.Computed, { env: styleletEnv })).toBe(declared);
    });

    it('does not recognize a CSS-wide keyword as part of another value', () => {
      expect(colorProperty.parse('inherit red', { env: styleletEnv })).toBeNull();
      expect(colorProperty.parse('red inherit', { env: styleletEnv })).toBeNull();
    });
  });

  describe('substitution value', () => {
    it('preserves a top-level arbitrary substitution function', () => {
      const value = colorProperty.parse('var(--color)', { env: styleletEnv })!;

      expect(value).toHaveProperty('inner.repr', expect.any(OptionalDeclarationValue));
      expect(value.serialize()).toBe('var(--color)');
      expect(value.resolve(ValueStage.Specified, { env: styleletEnv })).toBe(value);
      expect(() => value.resolve(ValueStage.Computed, { env: styleletEnv }))
        .toThrow('Property substitution requires computed custom properties');
      expect(value.resolve(ValueStage.Computed, { env: styleletEnv, getCustomProperty: () => OptionalDeclarationValue.parse('red', {})! }).serialize())
        .toBe('rgb(255, 0, 0)');
    });

    it('preserves arbitrary substitution nested inside property syntax', () => {
      const value = colorProperty.parse('rgb(var(--channels))', { env: styleletEnv })!;

      expect(value).toHaveProperty('inner.repr', expect.any(OptionalDeclarationValue));
      expect(value.serialize()).toBe('rgb(var(--channels))');
    });

    it('defers a potentially invalid value containing substitution', () => {
      expect(colorProperty.parse('red var(--extra)', { env: styleletEnv })?.inner).toBeInstanceOf(SubstitutionValue);
    });
  });

  describe('invalid value', () => {
    it('rejects an empty ordinary property value while parsing', () => {
      expect(colorProperty.parse('', { env: styleletEnv })).toBeNull();
    });

    it('rejects invalid property syntax while parsing', () => {
      expect(colorProperty.parse('definitely-not-a-color', { env: styleletEnv })).toBeNull();
      expect(colorProperty.parse('10px', { env: styleletEnv })).toBeNull();
      expect(colorProperty.parse('red blue', { env: styleletEnv })).toBeNull();
    });

    it('rejects an invalid declaration value during input parsing', () => {
      expect(colorProperty.parse('red ! blue', { env: styleletEnv })).toBeNull();
    });
  });
});
