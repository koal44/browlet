import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { GuaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { CssWideValue } from '../../../../src/stylelet/values/css-wide';
import { SubstitutionValue } from '../../../../src/stylelet/values/substitution-value';
import { NumberLiteral } from '../../../../src/stylelet/values/numeric-literal/number';
import { FirstValidValue } from '../../../../src/stylelet/values/substitution/first-valid';
import { describe, expect, it, vi } from 'vitest';
import { parseColorProperty } from '../../../../src/stylelet/props/color';
import {
  propertyRegistry, resolveBuiltInPropertyDeclaration, serializePropertyDeclaration,
} from '../../../../src/stylelet/props/property';
import { parseDeclarationBlock } from '../../../../src/stylelet/cssom/declarations/declaration-block';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import {
  absoluteColorFromRgba, ColorValue, ColorKind, ColorRgba,
} from '../../../../src/stylelet/values/color';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';

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
    const property = propertyRegistry[name];
    expect(property.inherits).toBe(inherits);
    expect(parseDeclarationBlock(`${name}: ${text}`, {})).toEqual([{
      type: 'property-declaration',
      custom: false,
      name,
      value: property.initialValue,
      important: false,
    }]);
  });

  it('shares color value behavior between distinct property records', () => {
    expect(propertyRegistry.color).not.toBe(propertyRegistry['background-color']);
    expect(propertyRegistry.color.parse).toBe(parseColorProperty);
    expect(propertyRegistry['background-color'].parse).toBe(parseColorProperty);
  });

  it('resolves CanvasText with each palette without changing the shared initial value', () => {
    const { initialValue } = propertyRegistry.color;
    const light = absoluteColorFromRgba(ColorRgba.black);
    const dark = absoluteColorFromRgba(ColorRgba.white);

    expect(initialValue.serialize()).toBe('canvastext');
    expect(initialValue.resolve(ValueStage.Computed, {
      systemColors: new Map([['canvastext', light]]),
    })).toMatchObject({ value: { value: light } });
    expect(initialValue.resolve(ValueStage.Computed, {
      systemColors: new Map([['canvastext', dark]]),
    })).toMatchObject({ value: { value: dark } });
    expect(initialValue).toMatchObject({ value: { value: { kind: ColorKind.System, name: 'canvastext' } } });
  });
});

describe('property value', () => {
  it('carries property context from declaration parsing into the declared value', () => {
    const context = {
      numericVariables: new Map([['progress', {
        valueType: 'number' as const,
        value: new NumberLiteral(0.5),
      }]]),
    };
    const declarations = parseDeclarationBlock('opacity: calc(progress)', context);

    expect(declarations).toMatchObject([{ name: 'opacity', custom: false }]);
    expect(declarations[0]?.value).toBeInstanceOf(WholeValue);
    expect(parseDeclarationBlock('opacity: calc(progress)', {})).toEqual([]);
  });

  it('preserves an exact value type through the property registry', () => {
    const parseValue: typeof parseColorProperty = propertyRegistry.color.parse;
    const declared = parseValue('red', {})!;
    const computed = declared.resolve(ValueStage.Computed, {});

    expect(declared.serialize()).toBe('red');
    expect(computed.serialize()).toBe('rgb(255, 0, 0)');

    if (computed.value instanceof ColorValue) {
      expect(computed.value.value.kind).toBe(ColorKind.Absolute);
    }
  });

  it('lets each declaration value resolve and serialize itself', () => {
    const declarations = parseDeclarationBlock(
      'color: red; opacity: 150%; margin-left: 2em; --Accent: 10px', {},
    );
    const computed = declarations.map((declaration) => declaration.custom
      ? declaration
      : resolveBuiltInPropertyDeclaration(declaration, ValueStage.Computed, { length: { em: 16 } })
    );

    expect(computed.map(serializePropertyDeclaration)).toEqual([
      { name: 'color', value: 'rgb(255, 0, 0)', important: false },
      { name: 'opacity', value: '1', important: false },
      { name: 'margin-left', value: '32px', important: false },
      { name: '--Accent', value: '10px', important: false },
    ]);
  });

  describe('ordinary value', () => {
    it('returns a parsed color ready to retain in a declaration', () => {
      const declared = parseColorProperty('red', {})!;

      expect(declared).toMatchObject({
        value: {
          value: {
            kind: ColorKind.Named,
            name: 'red',
          },
        },
      });
      expect(declared.serialize()).toBe('red');
      expect(declared.resolve(ValueStage.Computed, {})).toMatchObject({
        value: {
          value: {
            kind: ColorKind.Absolute,
          },
        },
      });
    });

    it('rejects a free-form brace wrapper while parsing the property', () => {
      expect(parseColorProperty('{red}', {})).toBeNull();
    });

    it('retains contextual color dependencies after parsing', () => {
      const declared = parseColorProperty('currentcolor', {})!;

      expect(declared.value).toBeInstanceOf(ColorValue);
      expect(declared.serialize()).toBe('currentcolor');
      expect(declared.resolve(ValueStage.Specified, {}).serialize())
        .toBe('currentcolor');
    });

    it('applies the supplied declared-stage math options while parsing', () => {
      const context = { unwrapMathAt: ValueStage.Declared };
      const opacity = propertyRegistry.opacity.parse('calc(150%)', context)!;
      const margin = propertyRegistry['margin-left'].parse('calc(1px + 2px)', context)!;

      expect(opacity.serialize()).toBe('1.5');
      expect(margin.serialize()).toBe('3px');
      expect(parseDeclarationBlock('opacity: calc(150%); margin-left: calc(1px + 2px)', context))
        .toMatchObject([
          { name: 'opacity', value: opacity },
          { name: 'margin-left', value: margin },
        ]);
    });

    it('retains the specified value when resolving it in different contexts', () => {
      const property = propertyRegistry['margin-top'];
      const declared = property.parse('2em', {})!;
      const specified = declared.resolve(ValueStage.Specified, {});
      const small = specified.resolve(ValueStage.Computed, { length: { em: 16 } });
      const large = specified.resolve(ValueStage.Computed, { length: { em: 24 } });

      expect(small.serialize()).toBe('32px');
      expect(large.serialize()).toBe('48px');
      expect(specified.serialize()).toBe('2em');
      expect(declared.serialize()).toBe('2em');
    });

    it('keeps serialization at the current stage through the whole-value lifecycle', () => {
      const property = propertyRegistry.opacity;
      const declared = property.parse('150%', {})!;
      let value = declared;

      expect(value.serialize()).toBe('1.5');
      for (const stage of [ValueStage.Cascaded, ValueStage.Specified]) {
        value = value.resolve(stage, {});
        expect(value.serialize()).toBe('1.5');
      }
      for (const stage of [ValueStage.Computed, ValueStage.Used, ValueStage.Actual]) {
        value = value.resolve(stage, {});
        expect(value.serialize()).toBe('1');
      }
      expect(declared.serialize()).toBe('1.5');
    });
  });

  describe('whole-value notation', () => {
    it('retains only the consuming parser and stops before unused alternatives', () => {
      const parseOrdinary = vi.fn(ColorValue.parse);
      const parseValue = WholeValue.createParser(parseOrdinary);
      const declared = parseValue('first-valid(10px, red, blue)', {})!;

      expect(parseOrdinary).not.toHaveBeenCalled();
      expect(declared.resolve(ValueStage.Specified, {})).toBe(declared);
      expect(declared.serialize()).toBe('first-valid(10px, red, blue)');
      expect(parseOrdinary).not.toHaveBeenCalled();

      const computed = declared.resolve(ValueStage.Computed, {});
      expect(computed.serialize()).toBe('rgb(255, 0, 0)');
      expect(parseOrdinary).toHaveBeenCalledTimes(2);
      expect(declared.serialize()).toBe('first-valid(10px, red, blue)');
    });

    it('adds whole-value notation to a reusable value parser', () => {
      const parseValue = WholeValue.createParser(ColorValue.parse);
      const parsed = parseValue('first-valid(10px, red)', {})!;

      expect(parsed.resolve(ValueStage.Computed, {})).toMatchObject({
        value: {
          value: {
            kind: ColorKind.Absolute,
          },
        },
      });
    });

    it('selects the first argument valid for the property', () => {
      const input = parseColorProperty('first-valid(10px, red)', {})!;
      const specified = input.resolve(ValueStage.Specified, {});

      expect(input.value).toBeInstanceOf(FirstValidValue);
      expect(specified).toBe(input);
      expect(specified.value).toBeInstanceOf(FirstValidValue);
      expect(specified.serialize()).toBe('first-valid(10px, red)');
      expect(specified.resolve(ValueStage.Specified, {})).toBe(specified);
      expect(input.resolve(ValueStage.Computed, {})).toMatchObject({
        value: {
          value: {
            kind: ColorKind.Absolute,
          },
        },
      });
    });

    it('becomes guaranteed-invalid when no argument is valid', () => {
      const input = parseColorProperty('first-valid(10px, 20px)', {})!;

      expect(input).not.toBeNull();
      expect(input.resolve(ValueStage.Computed, {}).value).toBeInstanceOf(GuaranteedInvalidValue);
    });

    it('resolves each argument through the complete property pipeline', () => {
      const input = parseColorProperty('first-valid(inherit, red)', {})!;

      expect(input.resolve(ValueStage.Computed, {})).toMatchObject({ value: new CssWideValue('inherit') });
    });
  });

  describe('CSS-wide value', () => {
    it('recognizes a CSS-wide keyword as the entire property value', () => {
      const declared = parseColorProperty(' InHeRiT ', {})!;

      expect(declared).toMatchObject({ value: new CssWideValue('inherit') });
      expect(declared.serialize()).toBe('inherit');
      // Defaulting is still unfinished; retaining the keyword must not discard it.
      expect(declared.resolve(ValueStage.Computed, {})).toBe(declared);
    });

    it('does not recognize a CSS-wide keyword as part of another value', () => {
      expect(parseColorProperty('inherit red', {})).toBeNull();
      expect(parseColorProperty('red inherit', {})).toBeNull();
    });
  });

  describe('substitution value', () => {
    it('preserves a top-level arbitrary substitution function', () => {
      const value = parseColorProperty('var(--color)', {})!;

      expect(value).toHaveProperty('value.value', expect.any(OptionalDeclarationValue));
      expect(value.serialize()).toBe('var(--color)');
      expect(value.resolve(ValueStage.Specified, {})).toBe(value);
      expect(() => value.resolve(ValueStage.Computed, {}))
        .toThrow('Arbitrary substitution is not implemented');
    });

    it('preserves arbitrary substitution nested inside property syntax', () => {
      const value = parseColorProperty('rgb(var(--channels))', {})!;

      expect(value).toHaveProperty('value.value', expect.any(OptionalDeclarationValue));
      expect(value.serialize()).toBe('rgb(var(--channels))');
    });

    it('defers a potentially invalid value containing substitution', () => {
      expect(parseColorProperty('red var(--extra)', {})?.value).toBeInstanceOf(SubstitutionValue);
    });
  });

  describe('invalid value', () => {
    it('rejects an empty ordinary property value while parsing', () => {
      expect(parseColorProperty('', {})).toBeNull();
    });

    it('rejects invalid property syntax while parsing', () => {
      expect(parseColorProperty('definitely-not-a-color', {})).toBeNull();
      expect(parseColorProperty('10px', {})).toBeNull();
      expect(parseColorProperty('red blue', {})).toBeNull();
    });

    it('rejects an invalid declaration value during input parsing', () => {
      expect(parseColorProperty('red ! blue', {})).toBeNull();
    });
  });
});
