import { describe, expect, it } from 'vitest';
import { colorProperty } from '../../../src/stylelet/props/color';
import { ValueStage } from '../../../src/stylelet/value-processing';
import { ColorKind } from '../../../src/stylelet/values/color';

describe('property value', () => {
  describe('ordinary value', () => {
    it('parses, serializes, and resolves a color whole value', () => {
      const value = colorProperty.parse('red');

      expect(value).toMatchObject({
        type: 'whole-value',
        value: {
          kind: ColorKind.Named,
          name: 'red',
        },
      });
      expect(value?.serialize()).toBe('red');
      expect(value?.resolve(ValueStage.Computed, {})).toMatchObject({
        type: 'whole-value',
        value: {
          kind: ColorKind.Absolute,
        },
      });
    });

    it('rejects a free-form brace wrapper around a direct property value', () => {
      expect(colorProperty.parse('{red}')).toBeNull();
    });
  });

  describe('CSS-wide value', () => {
    it('recognizes a CSS-wide keyword as the entire property value', () => {
      const value = colorProperty.parse(' InHeRiT ');

      expect(value).toMatchObject({
        type: 'css-wide',
        keyword: 'inherit',
      });
      expect(value?.serialize()).toBe('inherit');
    });

    it('does not recognize a CSS-wide keyword as part of another value', () => {
      expect(colorProperty.parse('inherit red')).toBeNull();
      expect(colorProperty.parse('red inherit')).toBeNull();
    });
  });

  describe('substitution value', () => {
    it('preserves a top-level arbitrary substitution function', () => {
      const value = colorProperty.parse('var(--color)');

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
      const value = colorProperty.parse('rgb(var(--channels))');

      expect(value).toMatchObject({
        type: 'substitution-value',
        declaration: {
          type: 'declaration-value',
        },
      });
      expect(value?.serialize()).toBe('rgb(var(--channels))');
    });

    it('defers a potentially invalid value containing substitution', () => {
      expect(colorProperty.parse('red var(--extra)')).toMatchObject({
        type: 'substitution-value',
      });
    });
  });

  describe('invalid value', () => {
    it('rejects an empty ordinary property value', () => {
      expect(colorProperty.parse('')).toBeNull();
    });

    it('rejects invalid syntax without arbitrary substitution', () => {
      expect(colorProperty.parse('definitely-not-a-color')).toBeNull();
      expect(colorProperty.parse('red blue')).toBeNull();
    });
  });
});
