import { describe, expect, it } from 'vitest';
import { colorWholeValueDef } from '../../../src/stylelet/props/color';
import {
  propertyRegistry, resolveBuiltInPropertyDeclaration, serializePropertyDeclaration,
} from '../../../src/stylelet/css/property';
import { parseDeclarationBlock } from '../../../src/stylelet/css/declaration-block';
import { ValueStage } from '../../../src/stylelet/value-processing/stage';
import {
  absoluteColorFromRgba, colorDef, ColorKind, ColorRgba,
} from '../../../src/stylelet/values/color';
import { defineWholeValue } from '../../../src/stylelet/values/whole-value';

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
    expect(propertyRegistry.color.definition).toBe(colorWholeValueDef);
    expect(propertyRegistry['background-color'].definition).toBe(colorWholeValueDef);
  });

  it('resolves CanvasText with each palette without changing the shared initial value', () => {
    const { definition, initialValue } = propertyRegistry.color;
    const light = absoluteColorFromRgba(ColorRgba.black);
    const dark = absoluteColorFromRgba(ColorRgba.white);

    expect(definition.serialize(initialValue)).toBe('canvastext');
    expect(definition.resolve(initialValue, ValueStage.Computed, {
      systemColors: new Map([['canvastext', light]]),
    })).toEqual({ type: 'ordinary', value: light });
    expect(definition.resolve(initialValue, ValueStage.Computed, {
      systemColors: new Map([['canvastext', dark]]),
    })).toEqual({ type: 'ordinary', value: dark });
    expect(initialValue).toEqual({
      type: 'ordinary', value: { kind: ColorKind.System, name: 'canvastext' },
    });
  });
});

describe('property value', () => {
  it('carries property context from declaration parsing into the declared value', () => {
    const context = {
      numericVariables: new Map([['progress', {
        valueType: 'number' as const,
        value: { type: 'number' as const, value: 0.5 },
      }]]),
    };
    const declarations = parseDeclarationBlock('opacity: calc(progress)', context);

    expect(declarations).toMatchObject([{ name: 'opacity', value: { type: 'ordinary' } }]);
    expect(parseDeclarationBlock('opacity: calc(progress)', {})).toEqual([]);
  });

  it('preserves an exact value definition through the property registry', () => {
    const definition: typeof colorWholeValueDef = propertyRegistry.color.definition;
    const declared = definition.parse('red', {})!;
    const computed = definition.resolve(declared, ValueStage.Computed, {});

    expect(definition.serialize(declared)).toBe('red');
    expect(definition.serialize(computed)).toBe('rgb(255, 0, 0)');

    if (computed.type === 'ordinary') {
      expect(computed.value.kind).toBe(ColorKind.Absolute);
    }
  });

  it('uses each declaration name to resolve and serialize its value', () => {
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
      const declared = colorWholeValueDef.parse('red', {})!;

      expect(declared).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Named,
          name: 'red',
        },
      });
      expect(colorWholeValueDef.serialize(declared)).toBe('red');
      expect(colorWholeValueDef.resolve(declared, ValueStage.Computed, {})).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Absolute,
        },
      });
    });

    it('rejects a free-form brace wrapper while parsing the property', () => {
      expect(colorWholeValueDef.parse('{red}', {})).toBeNull();
    });

    it('retains contextual color dependencies after parsing', () => {
      const declared = colorWholeValueDef.parse('currentcolor', {})!;

      expect(declared.type).toBe('ordinary');
      expect(colorWholeValueDef.serialize(declared)).toBe('currentcolor');
      expect(colorWholeValueDef.serialize(colorWholeValueDef.resolve(declared, ValueStage.Specified, {})))
        .toBe('currentcolor');
    });

    it('applies the supplied declared-stage math options while parsing', () => {
      const context = { unwrapMathAt: ValueStage.Declared };
      const opacity = propertyRegistry.opacity.definition.parse('calc(150%)', context)!;
      const margin = propertyRegistry['margin-left'].definition.parse('calc(1px + 2px)', context)!;

      expect(propertyRegistry.opacity.definition.serialize(opacity)).toBe('1.5');
      expect(propertyRegistry['margin-left'].definition.serialize(margin)).toBe('3px');
      expect(parseDeclarationBlock('opacity: calc(150%); margin-left: calc(1px + 2px)', context))
        .toMatchObject([
          { name: 'opacity', value: opacity },
          { name: 'margin-left', value: margin },
        ]);
    });

    it('retains the specified value when resolving it in different contexts', () => {
      const property = propertyRegistry['margin-top'];
      const declared = property.definition.parse('2em', {})!;
      const specified = property.definition.resolve(declared, ValueStage.Specified, {});
      const small = property.definition.resolve(specified, ValueStage.Computed, { length: { em: 16 } });
      const large = property.definition.resolve(specified, ValueStage.Computed, { length: { em: 24 } });

      expect(property.definition.serialize(small)).toBe('32px');
      expect(property.definition.serialize(large)).toBe('48px');
      expect(property.definition.serialize(specified)).toBe('2em');
      expect(property.definition.serialize(declared)).toBe('2em');
    });

    it('keeps serialization at the current stage through the whole-value lifecycle', () => {
      const property = propertyRegistry.opacity;
      const declared = property.definition.parse('150%', {})!;
      let value = declared;

      expect(property.definition.serialize(value)).toBe('1.5');
      for (const stage of [ValueStage.Cascaded, ValueStage.Specified]) {
        value = property.definition.resolve(value, stage, {});
        expect(property.definition.serialize(value)).toBe('1.5');
      }
      for (const stage of [ValueStage.Computed, ValueStage.Used, ValueStage.Actual]) {
        value = property.definition.resolve(value, stage, {});
        expect(property.definition.serialize(value)).toBe('1');
      }
      expect(property.definition.serialize(declared)).toBe('1.5');
    });
  });

  describe('whole-value notation', () => {
    it('adds whole-value notation to a reusable value definition', () => {
      const definition = defineWholeValue(colorDef);
      const parsed = definition.parse('first-valid(10px, red)', {})!;

      expect(definition.resolve(parsed, ValueStage.Computed, {})).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Absolute,
        },
      });
    });

    it('selects the first argument valid for the property', () => {
      const input = colorWholeValueDef.parse('first-valid(10px, red)', {})!;
      const specified = colorWholeValueDef.resolve(input, ValueStage.Specified, {});

      expect(input.type).toBe('first-valid');
      expect(specified).toBe(input);
      expect(specified.type).toBe('first-valid');
      expect(colorWholeValueDef.serialize(specified)).toBe('first-valid(10px, red)');
      expect(colorWholeValueDef.resolve(specified, ValueStage.Specified, {})).toBe(specified);
      expect(colorWholeValueDef.resolve(input, ValueStage.Computed, {})).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Absolute,
        },
      });
    });

    it('becomes guaranteed-invalid when no argument is valid', () => {
      const input = colorWholeValueDef.parse('first-valid(10px, 20px)', {})!;

      expect(input).not.toBeNull();
      expect(colorWholeValueDef.resolve(input, ValueStage.Computed, {})).toMatchObject({
        type: 'guaranteed-invalid',
      });
    });

    it('resolves each argument through the complete property pipeline', () => {
      const input = colorWholeValueDef.parse('first-valid(inherit, red)', {})!;

      expect(colorWholeValueDef.resolve(input, ValueStage.Computed, {})).toMatchObject({
        type: 'css-wide',
        keyword: 'inherit',
      });
    });
  });

  describe('CSS-wide value', () => {
    it('recognizes a CSS-wide keyword as the entire property value', () => {
      const declared = colorWholeValueDef.parse(' InHeRiT ', {})!;

      expect(declared).toMatchObject({
        type: 'css-wide',
        keyword: 'inherit',
      });
      expect(colorWholeValueDef.serialize(declared)).toBe('inherit');
      // Defaulting is still unfinished; retaining the keyword must not discard it.
      expect(colorWholeValueDef.resolve(declared, ValueStage.Computed, {})).toBe(declared);
    });

    it('does not recognize a CSS-wide keyword as part of another value', () => {
      expect(colorWholeValueDef.parse('inherit red', {})).toBeNull();
      expect(colorWholeValueDef.parse('red inherit', {})).toBeNull();
    });
  });

  describe('substitution value', () => {
    it('preserves a top-level arbitrary substitution function', () => {
      const value = colorWholeValueDef.parse('var(--color)', {})!;

      expect(value).toMatchObject({
        type: 'substitution-value',
        declaration: {
          type: 'declaration-value',
        },
      });
      expect(colorWholeValueDef.serialize(value)).toBe('var(--color)');
      expect(colorWholeValueDef.resolve(value, ValueStage.Specified, {})).toBe(value);
      expect(() => colorWholeValueDef.resolve(value, ValueStage.Computed, {}))
        .toThrow('Arbitrary substitution is not implemented');
    });

    it('preserves arbitrary substitution nested inside property syntax', () => {
      const value = colorWholeValueDef.parse('rgb(var(--channels))', {})!;

      expect(value).toMatchObject({
        type: 'substitution-value',
        declaration: {
          type: 'declaration-value',
        },
      });
      expect(colorWholeValueDef.serialize(value)).toBe('rgb(var(--channels))');
    });

    it('defers a potentially invalid value containing substitution', () => {
      expect(colorWholeValueDef.parse('red var(--extra)', {}))
        .toMatchObject({ type: 'substitution-value' });
    });
  });

  describe('invalid value', () => {
    it('rejects an empty ordinary property value while parsing', () => {
      expect(colorWholeValueDef.parse('', {})).toBeNull();
    });

    it('rejects invalid property syntax while parsing', () => {
      expect(colorWholeValueDef.parse('definitely-not-a-color', {})).toBeNull();
      expect(colorWholeValueDef.parse('10px', {})).toBeNull();
      expect(colorWholeValueDef.parse('red blue', {})).toBeNull();
    });

    it('rejects an invalid declaration value during input parsing', () => {
      expect(colorWholeValueDef.parse('red ! blue', {})).toBeNull();
    });
  });
});
