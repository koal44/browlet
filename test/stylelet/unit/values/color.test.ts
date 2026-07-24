import { describe, expect, it } from 'vitest';
import { ColorKind, parseColorValue } from '../../../../src/stylelet/values/color';
import { ColorName, colorNameFromText, namedColorRgba, SystemColorName } from '../../../../src/stylelet/values/color-keywords';

describe('color values', () => {
  it('parses named colors case-insensitively', () => {
    expect(parseColorValue('ReD')).toMatchObject({
      kind: ColorKind.Named,
      name: ColorName.red,
    });
  });

  it('parses system colors case-insensitively', () => {
    expect(parseColorValue('CanvasText')).toEqual({
      kind: ColorKind.System,
      name: SystemColorName.CanvasText,
    });
    expect(parseColorValue('ACCENTcolortext')).toEqual({
      kind: ColorKind.System,
      name: SystemColorName.AccentColorText,
    });
  });

  it('parses transparent and currentcolor', () => {
    expect(parseColorValue('transparent')).toEqual({
      kind: ColorKind.Named,
      name: ColorName.transparent,
    });
    expect(parseColorValue('CURRENTcolor')).toEqual({
      kind: ColorKind.CurrentColor,
    });
  });

  it('parses three-, four-, six-, and eight-digit hex colors', () => {
    for (const text of ['#0f8', '#0f8c', '#00ff88', '#00ff88cc']) {
      expect(parseColorValue(text)).toEqual({
        kind: ColorKind.Hex,
        text,
      });
    }

    expect(parseColorValue('#AbC')).toEqual({
      kind: ColorKind.Hex,
      text: '#AbC',
    });
    expect(parseColorValue('#\\66 00')).toEqual({
      kind: ColorKind.Hex,
      text: '#f00',
    });
  });

  it('rejects invalid hex color syntax', () => {
    for (const text of [
      '#',
      '#1',
      '#12',
      '#12345',
      '#1234567',
      '#123456789',
      '#ggg',
      '#12g',
    ]) {
      expect(parseColorValue(text)).toBeNull();
    }
  });

  it('parses legacy rgb and rgba functions', () => {
    expect(parseColorValue('rgb(255, 0, 127)')).toEqual({
      kind: ColorKind.Rgb,
      syntax: 'legacy',
      components: [
        { type: 'number', value: 255 },
        { type: 'number', value: 0 },
        { type: 'number', value: 127 },
      ],
    });
    expect(parseColorValue('rgba(100%, 0%, 50%, 25%)')).toEqual({
      kind: ColorKind.Rgb,
      syntax: 'legacy',
      components: [
        { type: 'percentage', value: 100 },
        { type: 'percentage', value: 0 },
        { type: 'percentage', value: 50 },
      ],
      alpha: { type: 'percentage', value: 25 },
    });
  });

  it('parses modern rgb and rgba functions', () => {
    expect(parseColorValue('rgb(255 20% none / 0.5)')).toEqual({
      kind: ColorKind.Rgb,
      syntax: 'modern',
      components: [
        { type: 'number', value: 255 },
        { type: 'percentage', value: 20 },
        'none',
      ],
      alpha: { type: 'number', value: 0.5 },
    });
    expect(parseColorValue('rgba(none 0 100% / none)')).toEqual({
      kind: ColorKind.Rgb,
      syntax: 'modern',
      components: [
        'none',
        { type: 'number', value: 0 },
        { type: 'percentage', value: 100 },
      ],
      alpha: 'none',
    });
  });

  it('rejects invalid mixtures of legacy and modern rgb syntax', () => {
    expect(parseColorValue('rgb(100%, 0, 50%)')).toBeNull();
    expect(parseColorValue('rgb(none, 0, 0)')).toBeNull();
    expect(parseColorValue('rgb(1 2)')).toBeNull();
    expect(parseColorValue('rgb(1 2 3, 0.5)')).toBeNull();
  });

  it.fails('accepts math functions wherever rgb accepts a numeric value', () => {
    expect(parseColorValue('rgb(calc(50%) 0 calc(255 / 2) / calc(25%))'))
      .not.toBeNull();
  });

  it.fails('clamps rgb components at parsed-value time', () => {
    expect(parseColorValue('rgb(300 -10 0 / 2)')).toEqual({
      kind: ColorKind.Rgb,
      syntax: 'modern',
      components: [
        { type: 'number', value: 255 },
        { type: 'number', value: 0 },
        { type: 'number', value: 0 },
      ],
      alpha: { type: 'number', value: 1 },
    });
  });

  it.todo('uses zero for missing rgb components outside interpolation');

  it('parses legacy hsl and hsla functions', () => {
    expect(parseColorValue('hsl(120, 100%, 50%)')).toEqual({
      kind: ColorKind.Hsl,
      syntax: 'legacy',
      hue: { type: 'number', value: 120 },
      saturation: { type: 'percentage', value: 100 },
      lightness: { type: 'percentage', value: 50 },
    });
    expect(parseColorValue('hsla(0.5turn, 25%, 75%, 20%)')).toEqual({
      kind: ColorKind.Hsl,
      syntax: 'legacy',
      hue: { type: 'angle', value: 0.5, unit: 'turn' },
      saturation: { type: 'percentage', value: 25 },
      lightness: { type: 'percentage', value: 75 },
      alpha: { type: 'percentage', value: 20 },
    });
  });

  it('parses modern hsl and hsla functions', () => {
    expect(parseColorValue('hsl(120deg 100% 50 / 0.5)')).toEqual({
      kind: ColorKind.Hsl,
      syntax: 'modern',
      hue: { type: 'angle', value: 120, unit: 'deg' },
      saturation: { type: 'percentage', value: 100 },
      lightness: { type: 'number', value: 50 },
      alpha: { type: 'number', value: 0.5 },
    });
    expect(parseColorValue('hsla(none 0 100% / none)')).toEqual({
      kind: ColorKind.Hsl,
      syntax: 'modern',
      hue: 'none',
      saturation: { type: 'number', value: 0 },
      lightness: { type: 'percentage', value: 100 },
      alpha: 'none',
    });
  });

  it('rejects invalid mixtures of legacy and modern hsl syntax', () => {
    expect(parseColorValue('hsl(120, 100, 50%)')).toBeNull();
    expect(parseColorValue('hsl(none, 100%, 50%)')).toBeNull();
    expect(parseColorValue('hsl(120 100%)')).toBeNull();
    expect(parseColorValue('hsl(120 100% 50%, 0.5)')).toBeNull();
  });

  it.fails('accepts math functions wherever hsl accepts a numeric value', () => {
    expect(parseColorValue('hsl(calc(0.5turn) calc(50%) calc(25) / calc(20%))'))
      .not.toBeNull();
  });

  it.fails('clamps negative hsl saturation at parsed-value time', () => {
    expect(parseColorValue('hsl(120 -10% 50%)')).toEqual({
      kind: ColorKind.Hsl,
      syntax: 'modern',
      hue: { type: 'number', value: 120 },
      saturation: { type: 'percentage', value: 0 },
      lightness: { type: 'percentage', value: 50 },
    });
  });

  it('parses hwb functions', () => {
    expect(parseColorValue('hwb(120deg 20% 30 / 0.5)')).toEqual({
      kind: ColorKind.Hwb,
      hue: { type: 'angle', value: 120, unit: 'deg' },
      whiteness: { type: 'percentage', value: 20 },
      blackness: { type: 'number', value: 30 },
      alpha: { type: 'number', value: 0.5 },
    });
    expect(parseColorValue('hwb(none 0 100% / none)')).toEqual({
      kind: ColorKind.Hwb,
      hue: 'none',
      whiteness: { type: 'number', value: 0 },
      blackness: { type: 'percentage', value: 100 },
      alpha: 'none',
    });
  });

  it('rejects invalid hwb syntax', () => {
    expect(parseColorValue('hwb(120, 20%, 30%)')).toBeNull();
    expect(parseColorValue('hwb(120 20%)')).toBeNull();
    expect(parseColorValue('hwb(120 20% 30% 0.5)')).toBeNull();
    expect(parseColorValue('hwb(120 20% 30% /)')).toBeNull();
  });

  it.fails('accepts math functions wherever hwb accepts a numeric value', () => {
    expect(parseColorValue('hwb(calc(0.5turn) calc(20%) calc(30) / calc(50%))'))
      .not.toBeNull();
  });

  it.todo('normalizes excessive white and black when computing hwb colors');

  it.todo('uses zero for missing hwb components outside interpolation');

  it('parses lab and oklab functions', () => {
    expect(parseColorValue('lab(50% 20 -30% / 0.4)')).toEqual({
      kind: ColorKind.Lab,
      lightness: { type: 'percentage', value: 50 },
      a: { type: 'number', value: 20 },
      b: { type: 'percentage', value: -30 },
      alpha: { type: 'number', value: 0.4 },
    });
    expect(parseColorValue('oklab(none 0.1 -20% / none)')).toEqual({
      kind: ColorKind.Oklab,
      lightness: 'none',
      a: { type: 'number', value: 0.1 },
      b: { type: 'percentage', value: -20 },
      alpha: 'none',
    });
  });

  it('parses lch and oklch functions', () => {
    expect(parseColorValue('lch(50 40% 270deg / 25%)')).toEqual({
      kind: ColorKind.Lch,
      lightness: { type: 'number', value: 50 },
      chroma: { type: 'percentage', value: 40 },
      hue: { type: 'angle', value: 270, unit: 'deg' },
      alpha: { type: 'percentage', value: 25 },
    });
    expect(parseColorValue('oklch(none 0.2 none)')).toEqual({
      kind: ColorKind.Oklch,
      lightness: 'none',
      chroma: { type: 'number', value: 0.2 },
      hue: 'none',
    });
  });

  it('rejects invalid Lab-family syntax', () => {
    expect(parseColorValue('lab(50%, 0, 0)')).toBeNull();
    expect(parseColorValue('oklab(0.5 0)')).toBeNull();
    expect(parseColorValue('lch(50 20 30 0.5)')).toBeNull();
    expect(parseColorValue('oklch(0.5 0.2 30 /)')).toBeNull();
  });

  it.fails('accepts math functions throughout Lab-family colors', () => {
    const colors = [
      'lab(calc(50%) calc(0.1) calc(-20%) / calc(40%))',
      'oklab(calc(0.5) calc(10%) calc(-0.1))',
      'lch(calc(50%) calc(20) calc(90deg))',
      'oklch(calc(0.5) calc(20%) calc(0.25turn) / calc(0.5))',
    ].map((input) => parseColorValue(input));

    expect(colors).not.toContain(null);
  });

  it.fails('clamps Lab lightness at parsed-value time', () => {
    expect(parseColorValue('lab(-10 0 0)')).toMatchObject({
      lightness: { type: 'number', value: 0 },
    });
  });

  it.fails('clamps Oklab lightness at parsed-value time', () => {
    expect(parseColorValue('oklab(2 0 0)')).toMatchObject({
      lightness: { type: 'number', value: 1 },
    });
  });

  it.fails('clamps negative LCH chroma at parsed-value time', () => {
    expect(parseColorValue('lch(50 -10 30)')).toMatchObject({
      chroma: { type: 'number', value: 0 },
    });
  });

  it('parses every predefined color space', () => {
    const spaces = [
      'srgb',
      'srgb-linear',
      'display-p3',
      'display-p3-linear',
      'a98-rgb',
      'prophoto-rgb',
      'rec2020',
      'xyz',
      'xyz-d50',
      'xyz-d65',
    ];

    for (const space of spaces) {
      expect(parseColorValue(`color(${space} 0 0 0)`)).toMatchObject({
        kind: ColorKind.Color,
        space,
      });
    }

    expect(parseColorValue('color(DISPLAY-P3 0 0 0)')).toMatchObject({
      space: 'display-p3',
    });
  });

  it('parses color function components and alpha', () => {
    expect(parseColorValue('color(display-p3 1 50% none / 25%)')).toEqual({
      kind: ColorKind.Color,
      space: 'display-p3',
      components: [
        { type: 'number', value: 1 },
        { type: 'percentage', value: 50 },
        'none',
      ],
      alpha: { type: 'percentage', value: 25 },
    });

    expect(parseColorValue('color(xyz-d50 none 0.5 120% / none)')).toEqual({
      kind: ColorKind.Color,
      space: 'xyz-d50',
      components: [
        'none',
        { type: 'number', value: 0.5 },
        { type: 'percentage', value: 120 },
      ],
      alpha: 'none',
    });
  });

  it('retains out-of-range color function components', () => {
    expect(parseColorValue('color(prophoto-rgb -0.2 1.4 120% / 2)'))
      .toEqual({
        kind: ColorKind.Color,
        space: 'prophoto-rgb',
        components: [
          { type: 'number', value: -0.2 },
          { type: 'number', value: 1.4 },
          { type: 'percentage', value: 120 },
        ],
        alpha: { type: 'number', value: 2 },
      });
  });

  it('rejects invalid color function syntax', () => {
    expect(parseColorValue('color(srgb 0 0)')).toBeNull();
    expect(parseColorValue('color(srgb 0 0 0 0)')).toBeNull();
    expect(parseColorValue('color(srgb, 0, 0, 0)')).toBeNull();
    expect(parseColorValue('color(profoto-rgb 0 0 0)')).toBeNull();
    expect(parseColorValue('color(srgb 0 0 0 /)')).toBeNull();
  });

  it.fails('accepts math functions throughout color()', () => {
    expect(parseColorValue(
      'color(display-p3 calc(0.5) calc(25%) none / calc(40%))',
    )).not.toBeNull();
  });

  it('looks up named colors by text', () => {
    expect(colorNameFromText('red')).toBe(ColorName.red);
    expect(colorNameFromText('RebeccaPurple')).toBe(ColorName.rebeccapurple);
    expect(colorNameFromText('transparent')).toBe(ColorName.transparent);
    expect(colorNameFromText('notacolor')).toBeUndefined();
  });

  it('keeps equivalent color names equivalent', () => {
    expect(namedColorRgba(ColorName.aqua)).toBe(namedColorRgba(ColorName.cyan));
    expect(namedColorRgba(ColorName.fuchsia)).toBe(namedColorRgba(ColorName.magenta));
    expect(namedColorRgba(ColorName.gray)).toBe(namedColorRgba(ColorName.grey));
    expect(namedColorRgba(ColorName.darkgray)).toBe(namedColorRgba(ColorName.darkgrey));
    expect(namedColorRgba(ColorName.slategray)).toBe(namedColorRgba(ColorName.slategrey));
  });
});
