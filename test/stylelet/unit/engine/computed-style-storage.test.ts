import { describe, expect, it } from 'vitest';

import { ComputedStyle } from '../../../../src/stylelet/engine/computed-style';
import { CSSStylePropertiesImpl } from '../../../../src/stylelet/cssom/declarations/style-properties';
import { defaultStyleletEnvironment } from '../../../../src/stylelet/environment';
import { propertyRegistry, CustomProperty } from '../../../../src/stylelet/props/index';
import { ValueStage } from '../../../../src/stylelet/value-processing/index';

describe('computed-style storage', () => {
  it('retains existing properties and values, replacing results without changing their order', () => {
    const computed = new ComputedStyle();
    const opacity = propertyRegistry.opacity;
    const before = opacity.parse('0.25', {})!;
    const after = opacity.parse('0.75', {})!;
    computed.set(opacity, before);
    expect(computed.get('opacity')!.property).toBe(opacity);
    expect(computed.get('opacity')!.value).toBe(before);
    expect(computed.serialize('opacity')).toBe('0.25');
    expect(computed.item(0)).toBe('opacity');

    computed.set(propertyRegistry.color, propertyRegistry.color.parse('red', {})!);
    computed.set(opacity, after);
    expect(computed.serialize('opacity')).toBe('0.75');
    expect(computed.get('opacity')!.value).toBe(after);
    expect(opacity.serialize(before)).toBe('0.25');
    expect(computed.size).toBe(2);
    expect([...computed.keys()]).toEqual(['opacity', 'color']);
    expect([computed.item(0), computed.item(1), computed.item(2)]).toEqual(['opacity', 'color', '']);
  });

  it('uses custom-property serialization for source spelling and empty values', () => {
    const computed = new ComputedStyle();
    const property = new CustomProperty('--Token');
    const text = String.raw`01.00e+0EM/**/\72 ed`;
    const value = property.resolve(property.parse(text, {})!, ValueStage.Computed, {});
    computed.set(property, value);
    expect(computed.serialize('--Token')).toBe(text);
    expect(computed.serialize('--token')).toBe('');

    computed.set(property, property.resolve(property.parse('', {})!, ValueStage.Computed, {}));
    expect(computed.serialize('--Token')).toBe(' ');
    expect(computed.serialize('--missing')).toBe('');
    expect(property.serialize(value)).toBe(text);
  });

  it('reads shorthand values from the current longhands, including after replacement', () => {
    const computed = new ComputedStyle();
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const property = propertyRegistry[`margin-${side}`];
      computed.set(property, property.parse('2px', {})!);
      if (side !== 'left') expect(computed.serialize('margin')).toBe('');
    }
    expect(computed.serialize('margin')).toBe('2px');
    const left = propertyRegistry['margin-left'];
    computed.set(left, left.parse('4px', {})!);
    expect(computed.serialize('margin')).toBe('2px 2px 2px 4px');
    expect(computed.serialize('margin-left')).toBe('4px');
  });

  it('exposes computed CSSOM reads and rejects writes without an authored block', () => {
    const computedStyle = new ComputedStyle();
    const opacity = propertyRegistry.opacity;
    computedStyle.set(opacity, opacity.parse('0.5', {})!);
    const style = new CSSStylePropertiesImpl({ computedStyle }, defaultStyleletEnvironment);

    expect(style.computedStyle).toBe(computedStyle);
    expect(style.getPropertyValue('OPACITY')).toBe('0.5');
    expect(style.getPropertyPriority('opacity')).toBe('');
    expect(style.cssText).toBe('');
    expect(style.parentRule).toBeNull();
    expect(style.length).toBe(1);
    expect([...style]).toEqual(['opacity']);
    expect([...style.getSupportedPropertyIndices()]).toEqual([0]);
    expect(style.item(1)).toBe('');
    expect(style.declarations).toEqual([]);
    expect(style.getDeclaration('opacity')).toBeUndefined();
    expect(() => style.setProperty('opacity', '1')).toThrow('read-only');
    expect(() => style.removeProperty('opacity')).toThrow('read-only');
    expect(() => { style.cssText = 'opacity: 1'; }).toThrow('read-only');
    style.attributeChanged('style', 'opacity: 1');
    expect(style.getPropertyValue('opacity')).toBe('0.5');
  });
});
