import { describe, expect, it } from 'vitest';
import { colorProperty } from '../../../src/stylelet/props/color';
import { ValueStage } from '../../../src/stylelet/value-processing/stage';
import { colorDef, ColorKind } from '../../../src/stylelet/values/color';
import { defineProperty } from '../../../src/stylelet/values/whole-value';

describe('property value', () => {
  describe('ordinary value', () => {
    it('creates a raw value, then resolves and serializes a color value instance', () => {
      const raw = colorProperty.parse('red');

      expect(raw).toMatchObject({
        type: 'raw',
        declaration: {
          type: 'declaration-value',
        },
      });
      expect(raw?.serialize()).toBe('red');
      expect(raw?.resolve(ValueStage.Declared, {})).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Named,
          name: 'red',
        },
      });
      expect(raw?.resolve(ValueStage.Computed, {})).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Absolute,
        },
      });
    });

    it('rejects a free-form brace wrapper during declared resolution', () => {
      const input = colorProperty.parse('{red}');

      expect(input).not.toBeNull();
      expect(input?.resolve(ValueStage.Declared, {})).toBeNull();
    });
  });

  describe('whole-value notation', () => {
    it('creates a host-bound consumer from only the value definition', () => {
      const { parse } = defineProperty(colorDef);
      const parsed = parse('first-valid(10px, red)');

      expect(parsed?.resolve(ValueStage.Computed, {})).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Absolute,
        },
      });
    });

    it('selects the first argument valid for the property', () => {
      const input = colorProperty.parse('first-valid(10px, red)');
      const specified = input?.resolve(ValueStage.Specified, {});

      expect(input).not.toBeNull();
      expect(specified?.type).toBe('first-valid');
      expect(specified?.serialize()).toBe('first-valid(10px, red)');
      expect(specified?.resolve(ValueStage.Specified, {})).toBe(specified);
      expect(input?.resolve(ValueStage.Computed, {})).toMatchObject({
        type: 'ordinary',
        value: {
          kind: ColorKind.Absolute,
        },
      });
    });

    it('becomes guaranteed-invalid when no argument is valid', () => {
      const input = colorProperty.parse('first-valid(10px, 20px)');

      expect(input).not.toBeNull();
      expect(input?.resolve(ValueStage.Computed, {})).toMatchObject({
        type: 'guaranteed-invalid',
      });
    });

    it('resolves each argument through the complete property pipeline', () => {
      const input = colorProperty.parse('first-valid(inherit, red)');

      expect(input?.resolve(ValueStage.Computed, {})).toMatchObject({
        type: 'css-wide',
        keyword: 'inherit',
      });
    });
  });

  describe('CSS-wide value', () => {
    it('recognizes a CSS-wide keyword as the entire property value', () => {
      const input = colorProperty.parse(' InHeRiT ');
      const declared = input?.resolve(ValueStage.Declared, {});

      expect(declared).toMatchObject({
        type: 'css-wide',
        keyword: 'inherit',
      });
      expect(declared?.serialize()).toBe('inherit');
    });

    it('does not recognize a CSS-wide keyword as part of another value', () => {
      expect(colorProperty.parse('inherit red')?.resolve(ValueStage.Declared, {}))
        .toBeNull();
      expect(colorProperty.parse('red inherit')?.resolve(ValueStage.Declared, {}))
        .toBeNull();
    });
  });

  describe('substitution value', () => {
    it('preserves a top-level arbitrary substitution function', () => {
      const input = colorProperty.parse('var(--color)');
      const value = input?.resolve(ValueStage.Declared, {});

      expect(value).toMatchObject({
        type: 'substitution-value',
        declaration: {
          type: 'declaration-value',
        },
      });
      expect(value?.serialize()).toBe('var(--color)');
      expect(value?.resolve(ValueStage.Specified, {})).toBe(value);
    });

    it('preserves arbitrary substitution nested inside property syntax', () => {
      const value = colorProperty.parse('rgb(var(--channels))')
        ?.resolve(ValueStage.Declared, {});

      expect(value).toMatchObject({
        type: 'substitution-value',
        declaration: {
          type: 'declaration-value',
        },
      });
      expect(value?.serialize()).toBe('rgb(var(--channels))');
    });

    it('defers a potentially invalid value containing substitution', () => {
      expect(
        colorProperty.parse('red var(--extra)')
          ?.resolve(ValueStage.Declared, {}),
      ).toMatchObject({ type: 'substitution-value' });
    });
  });

  describe('invalid value', () => {
    it('rejects an empty ordinary property value during declared resolution', () => {
      const input = colorProperty.parse('');

      expect(input).not.toBeNull();
      expect(input?.resolve(ValueStage.Declared, {})).toBeNull();
    });

    it('rejects invalid property syntax during declared resolution', () => {
      expect(
        colorProperty.parse('definitely-not-a-color')
          ?.resolve(ValueStage.Declared, {}),
      ).toBeNull();
      expect(colorProperty.parse('red blue')?.resolve(ValueStage.Declared, {}))
        .toBeNull();
    });

    it('rejects an invalid declaration value during input parsing', () => {
      expect(colorProperty.parse('red ! blue')).toBeNull();
    });
  });
});
