import { describe, expect, it } from 'vitest';
import {
  ColorName, ColorNameByText, ColorSourceKind, namedColorRgba,
  packRgba, resolveColorSourceToRgba, resolveColorToRgba,
  type ColorValue,
} from '../../../src/stylelet/parser/color';

describe('color values', () => {
  it('looks up named colors by text', () => {
    expect(ColorNameByText.red).toBe(ColorName.red);
    expect(ColorNameByText.rebeccapurple).toBe(ColorName.rebeccapurple);
    expect(ColorNameByText.transparent).toBe(ColorName.transparent);
    expect(ColorNameByText.notacolor).toBeUndefined();
  });

  it('resolves named colors to packed rgba', () => {
    expect(namedColorRgba(ColorName.red)).toBe(packRgba(255, 0, 0, 255));
    expect(namedColorRgba(ColorName.black)).toBe(packRgba(0, 0, 0, 255));
    expect(namedColorRgba(ColorName.white)).toBe(packRgba(255, 255, 255, 255));
    expect(namedColorRgba(ColorName.transparent)).toBe(packRgba(0, 0, 0, 0));
  });

  it('keeps equivalent color names equivalent', () => {
    expect(namedColorRgba(ColorName.aqua)).toBe(namedColorRgba(ColorName.cyan));
    expect(namedColorRgba(ColorName.fuchsia)).toBe(namedColorRgba(ColorName.magenta));
    expect(namedColorRgba(ColorName.gray)).toBe(namedColorRgba(ColorName.grey));
    expect(namedColorRgba(ColorName.darkgray)).toBe(namedColorRgba(ColorName.darkgrey));
    expect(namedColorRgba(ColorName.slategray)).toBe(namedColorRgba(ColorName.slategrey));
  });

  it('resolves hex colors', () => {
    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.Hex, text: '#f00' }))
      .toBe(packRgba(255, 0, 0, 255));

    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.Hex, text: '#0f08' }))
      .toBe(packRgba(0, 255, 0, 136));

    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.Hex, text: '#0000ff' }))
      .toBe(packRgba(0, 0, 255, 255));

    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.Hex, text: '#ff000080' }))
      .toBe(packRgba(255, 0, 0, 128));
  });

  it('rejects malformed hex colors', () => {
    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.Hex, text: '#ff' })).toBeNull();
    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.Hex, text: '#fffff' })).toBeNull();
    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.Hex, text: '#ggg' })).toBeNull();
  });

  it('resolves rgb colors', () => {
    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Rgb,
      r: 255, g: 0, b: 0, a: 1,
    })).toBe(packRgba(255, 0, 0, 255));

    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Rgb,
      r: 0, g: 255, b: 0, a: 0.5,
    })).toBe(packRgba(0, 255, 0, 128));
  });

  it('clamps rgb channels and alpha', () => {
    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Rgb,
      r: 300, g: -10, b: 12.4, a: 2,
    })).toBe(packRgba(255, 0, 12, 255));
  });

  it('resolves hsl colors', () => {
    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Hsl,
      h: 0, s: 1, l: 0.5, a: 1,
    })).toBe(packRgba(255, 0, 0, 255));

    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Hsl,
      h: 120, s: 1, l: 0.5, a: 1,
    })).toBe(packRgba(0, 255, 0, 255));

    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Hsl,
      h: 240, s: 1, l: 0.5, a: 1,
    })).toBe(packRgba(0, 0, 255, 255));
  });

  it('normalizes hsl hue', () => {
    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Hsl,
      h: 360, s: 1, l: 0.5, a: 1,
    })).toBe(packRgba(255, 0, 0, 255));

    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Hsl,
      h: -120, s: 1, l: 0.5, a: 1,
    })).toBe(packRgba(0, 0, 255, 255));
  });

  it('returns null for contextual or unsupported color sources', () => {
    expect(resolveColorSourceToRgba({ kind: ColorSourceKind.CurrentColor })).toBeNull();

    expect(resolveColorSourceToRgba({
      kind: ColorSourceKind.Raw,
      text: 'color-mix(in srgb, red, blue)',
    })).toBeNull();
  });

  it('lazily caches resolved rgba values', () => {
    const color: ColorValue = {
      source: {
        kind: ColorSourceKind.Named,
        name: ColorName.red,
      },
    };

    expect(color.rgba).toBeUndefined();

    const rgba = resolveColorToRgba(color);

    expect(rgba).toBe(packRgba(255, 0, 0, 255));
    expect(color.rgba).toBe(packRgba(255, 0, 0, 255));
  });
});
