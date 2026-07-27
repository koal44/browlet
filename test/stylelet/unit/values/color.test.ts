import { describe, expect, it } from 'vitest';
import {
  ColorKind, ColorRgba, areColorsEquivalent, convertAbsoluteColor, deltaEOK, gamutMapAbsoluteColor,
  interpolateColors, parseColorInterpolationMethod, parseColorValue, resolveColorValue,
  serializeColorValue, type AbsoluteColor, type SystemColorName,
} from '../../../../src/stylelet/values/color';

type ColorVector3 = readonly [number, number, number];
type ColorVector4 = readonly [number, number, number, number];
type ColorVector = ColorVector3 | ColorVector4;

function isColorVector(value: unknown): value is ColorVector {
  return (
    Array.isArray(value) &&
    (value.length === 3 || value.length === 4) &&
    value.every((component) => typeof component === 'number')
  );
}

function expectColorCloseTo(
  actual: AbsoluteColor,
  expected: AbsoluteColor | ColorVector,
): void {
  if (isColorVector(expected)) {
    const [first, second, third] = expected;

    if (expected.length === 4) {
      expect(actual.alpha).toBeCloseTo(expected[3], 12);
    }

    expect(deltaEOK(actual, {
      ...actual,
      components: [first, second, third],
    })).toBeLessThan(0.001);
    return;
  }

  if (expected.alpha === undefined) {
    expect(actual.alpha).toBeUndefined();
  } else {
    expect(actual.alpha).toBeCloseTo(expected.alpha, 12);
  }

  expect(deltaEOK(actual, expected)).toBeLessThan(0.001);
}

function expectComponentsCloseTo(
  actual: AbsoluteColor['components'],
  expected: readonly (number | undefined)[],
  precision: number,
): void {
  expected.forEach((component, index) => {
    if (component === undefined) {
      expect(actual[index]).toBeUndefined();
    } else {
      expect(actual[index]).toBeCloseTo(component, precision);
    }
  });
}

describe('color values', () => {
  it('parses named colors case-insensitively', () => {
    expect(parseColorValue('ReD')).toMatchObject({
      kind: ColorKind.Named,
      name: 'red',
    });
    expect(parseColorValue('notacolor')).toBeNull();
    expect(parseColorValue('constructor')).toBeNull();
  });

  it('parses system colors case-insensitively', () => {
    expect(parseColorValue('CanvasText')).toEqual({
      kind: ColorKind.System,
      name: 'canvastext',
    });
    expect(parseColorValue('ACCENTcolortext')).toEqual({
      kind: ColorKind.System,
      name: 'accentcolortext',
    });
  });

  it.each([
    ['activeborder', 'buttonborder'], ['activecaption', 'canvas'],
    ['appworkspace', 'canvas'], ['background', 'canvas'],
    ['buttonhighlight', 'buttonface'], ['buttonshadow', 'buttonface'],
    ['captiontext', 'canvastext'], ['inactiveborder', 'buttonborder'],
    ['inactivecaption', 'canvas'], ['inactivecaptiontext', 'graytext'],
    ['infobackground', 'canvas'], ['infotext', 'canvastext'],
    ['menu', 'canvas'], ['menutext', 'canvastext'],
    ['scrollbar', 'canvas'], ['threedarkshadow', 'buttonborder'],
    ['threedface', 'buttonface'], ['threedhighlight', 'buttonborder'],
    ['threedlightshadow', 'buttonborder'], ['threedshadow', 'buttonborder'],
    ['window', 'canvas'], ['windowframe', 'buttonborder'],
    ['windowtext', 'canvastext'],
  ] as const)(
    'parses and resolves the deprecated color %s',
    (name, systemName) => {
      const color = parseColorValue(name.toUpperCase())!;

      expect(color).toEqual({
        kind: ColorKind.Deprecated,
        name,
      });
      expect(serializeColorValue(color)).toBe(name);
      expect(resolveColorValue(color, { stage: 'specified' })).toBe(color);
      expect(resolveColorValue(color, { stage: 'computed' })).toEqual({
        kind: ColorKind.System,
        name: systemName,
      });
    },
  );

  it('resolves deprecated colors through the modern system color', () => {
    const absolute: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0.1, 0.2, 0.3],
      alpha: 1,
    };

    expect(resolveColorValue(parseColorValue('ActiveCaption')!, {
      stage: 'computed',
      systemColors: new Map<SystemColorName, AbsoluteColor>([['canvas', absolute]]),
    })).toBe(absolute);
  });

  it('parses transparent and currentcolor', () => {
    expect(parseColorValue('transparent')).toEqual({
      kind: ColorKind.Named,
      name: 'transparent',
    });
    expect(parseColorValue('CURRENTcolor')).toEqual({
      kind: ColorKind.CurrentColor,
    });
  });

  it('resolves transparent to transparent black at computed-value time', () => {
    const transparent = parseColorValue('transparent')!;

    expect(resolveColorValue(transparent, { stage: 'specified' }))
      .toBe(transparent);
    expect(resolveColorValue(transparent, { stage: 'computed' })).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0, 0, 0],
      alpha: 0,
      is8Bit: true,
    });
  });

  it.each([
    ['#0f8', [0, 255, 136], 255],
    ['#0f8c', [0, 255, 136], 204],
    ['#00ff88', [0, 255, 136], 255],
    ['#00ff88cc', [0, 255, 136], 204],
    ['#AbC', [170, 187, 204], 255],
    ['#\\66 00', [255, 0, 0], 255],
  ] as const)(
    'resolves the declared hex color %s',
    (text, components, alpha) => {
      expect(parseColorValue(text)).toEqual({
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        components,
        alpha,
        is8Bit: true,
      });
    },
  );

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

  it('resolves named colors at computed-value time', () => {
    const red = parseColorValue('red')!;

    expect(resolveColorValue(red, { stage: 'specified' })).toBe(red);
    expect(resolveColorValue(red, { stage: 'computed' })).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [255, 0, 0],
      alpha: 255,
      is8Bit: true,
    });
  });

  it('resolves contextual colors when their dependencies are available', () => {
    const absolute: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0.1, 0.2, 0.3],
      alpha: 1,
    };
    const current = parseColorValue('currentcolor')!;
    const system = parseColorValue('CanvasText')!;
    const systemColors = new Map<SystemColorName, AbsoluteColor>([
      ['canvastext', absolute],
    ]);

    expect(resolveColorValue(current, {
      stage: 'computed',
      currentColor: absolute,
    })).toBe(current);
    expect(resolveColorValue(current, {
      stage: 'used',
      currentColor: absolute,
    })).toBe(absolute);
    expect(resolveColorValue(system, {
      stage: 'specified',
      systemColors,
    })).toBe(system);
    expect(resolveColorValue(system, {
      stage: 'computed',
      systemColors,
    })).toBe(absolute);
  });

  it('resolves legacy rgb and rgba functions to absolute sRGB', () => {
    expect(parseColorValue('rgb(255, 0, 127)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [255, 0, 127],
      alpha: 255,
      is8Bit: true,
    });
    expect(parseColorValue('rgba(100%, 0%, 50%, 25%)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [1, 0, 0.5],
      alpha: 0.25,
    });
  });

  it('resolves modern rgb and rgba functions to absolute sRGB', () => {
    expect(parseColorValue('rgb(255 20% none / 0.5)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [1, 0.2, undefined],
      alpha: 0.5,
    });
    expect(parseColorValue('rgba(none 0 100% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [undefined, 0, 1],
      alpha: undefined,
    });
  });

  it('rejects invalid mixtures of legacy and modern rgb syntax', () => {
    expect(parseColorValue('rgb(100%, 0, 50%)')).toBeNull();
    expect(parseColorValue('rgb(none, 0, 0)')).toBeNull();
    expect(parseColorValue('rgb(1 2)')).toBeNull();
    expect(parseColorValue('rgb(1 2 3, 0.5)')).toBeNull();
  });

  it('accepts math functions wherever rgb accepts a numeric value', () => {
    expect(parseColorValue('rgb(calc(50%) 0 calc(255 / 2) / calc(25%))'))
      .not.toBeNull();
  });

  // Adapted from WPT css/css-color/parsing/color-valid-rgb.html.
  it.each([
    [
      'rgb(calc(50% + (sign(1em - 10px) * 10%)), 0%, 0%, 50%)',
      'rgb(calc(50% + (10% * sign(1em - 10px))) 0 0 / 0.5)',
    ],
    [
      'rgb(0%, 0%, 0%, calc(50% + (sign(1em - 10px) * 10%)))',
      'rgb(0 0 0 / calc(50% + (10% * sign(1em - 10px))))',
    ],
  ] as const)(
    'serializes the deferred legacy RGB calculation %s in modern syntax',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('resolves color calculations as their value stage permits', () => {
    const input = 'rgb(calc(255 / 2) calc(50%) 0)';

    expect(parseColorValue(input)).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0.5, 0.5, 0],
      alpha: 1,
    });

    const deferred = parseColorValue(input, {
      stage: 'declared',
      unwrapMathAt: 'computed',
    })!;

    expect(deferred).toMatchObject({
      kind: ColorKind.Rgb,
    });
    expect(resolveColorValue(deferred, {
      stage: 'declared',
      unwrapMathAt: 'declared',
    })).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0.5, 0.5, 0],
      alpha: 1,
    });

    const declared = parseColorValue(
      'rgb(calc(255 / 2) 0 0 / calc(.25 + .25))',
    )!;

    expect(declared).toMatchObject({
      kind: ColorKind.Rgb,
    });
    expect(resolveColorValue(declared, {
      stage: 'declared',
      unwrapMathAt: 'declared',
    })).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0.5, 0, 0],
      alpha: 0.5,
    });
    expect(resolveColorValue(declared, { stage: 'computed' })).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0.5, 0, 0],
      alpha: 0.5,
    });
  });

  it('matches the section 15.1 sRGB calculation examples', () => {
    expect(serializeColorValue(
      parseColorValue('rgb(calc(64 * 2) 127 255)')!,
    )).toBe('rgb(128, 127, 255)');
    expect(serializeColorValue(
      parseColorValue('rgb(calc(100 * 4) 127 calc(20 - 35))')!,
    )).toBe('rgb(255, 127, 0)');

    const hsl = parseColorValue(
      'hsl(38.82 calc(2 * 50%) 50%)',
    ) as AbsoluteColor;

    expect(hsl.space).toBe('srgb-legacy');
    expectColorCloseTo(hsl, [1, 0.647, 0, 1]);
  });

  it('clamps rgb components at parsed-value time', () => {
    expect(parseColorValue('rgb(300 -10 0 / 2)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [1, 0, 0],
      alpha: 1,
    });
  });

  // Adapted from WPT css/css-color/parsing/color-computed-rgb.html.
  it.each([
    ['rgb(calc(infinity) 0 0)', { components: [1, 0, 0], alpha: 1 }],
    ['rgb(0 calc(-infinity) 0)', { components: [0, 0, 0], alpha: 1 }],
    ['rgb(0 0 calc(NaN))', { components: [0, 0, 0], alpha: 1 }],
    ['rgb(calc(0 / 0) 0 0)', { components: [0, 0, 0], alpha: 1 }],
    ['rgb(0 0 0 / calc(infinity))', { components: [0, 0, 0], alpha: 255, is8Bit: true }],
    ['rgb(0 0 0 / calc(-infinity))', { components: [0, 0, 0], alpha: 0 }],
    ['rgb(0 0 0 / calc(NaN))', { components: [0, 0, 0], alpha: 0 }],
  ] as const)(
    'clamps special calculations in the computed color %s',
    (input, expected) => {
      const declared = parseColorValue(input)!;

      expect(resolveColorValue(declared, { stage: 'computed' })).toEqual({
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        ...expected,
      });
    },
  );

  // Computed cases adapted from WPT color-computed-color-function.html and
  // color-computed-lab.html; declared cases document the value lifecycle.
  it.each([
    [
      'rgb(calc(NaN) 0 0)',
      'rgb(0, 0, 0)',
      'rgb(0, 0, 0)',
    ],
    [
      'hsl(calc(NaN) 100% 50%)',
      'rgb(255, 0, 0)',
      'rgb(255, 0, 0)',
    ],
    [
      'hsl(0 calc(NaN) 50%)',
      'rgb(127.5, 127.5, 127.5)',
      'rgb(127.5, 127.5, 127.5)',
    ],
    [
      'hsl(0 100% calc(NaN))',
      'rgb(0, 0, 0)',
      'rgb(0, 0, 0)',
    ],
    [
      'hwb(0 calc(NaN) 0)',
      'rgb(255, 0, 0)',
      'rgb(255, 0, 0)',
    ],
    [
      'hwb(0 0 calc(NaN))',
      'rgb(255, 0, 0)',
      'rgb(255, 0, 0)',
    ],
    [
      'lab(50 calc(NaN) 0)',
      'lab(50 calc(NaN) 0)',
      'lab(50 0 0)',
    ],
    [
      'lch(50 calc(NaN) 20)',
      'lch(50 calc(NaN) 20)',
      'lch(50 0 20)',
    ],
    [
      'color(display-p3 calc(NaN) 0 0)',
      'color(display-p3 calc(NaN) 0 0)',
      'color(display-p3 0 0 0)',
    ],
  ] as const)(
    'clamps special color calculations at the correct stage for %s',
    (input, declaredSerialization, computedSerialization) => {
      const declared = parseColorValue(input)!;
      const context = { stage: 'computed' } as const;
      const computed = resolveColorValue(declared, context);

      expect(serializeColorValue(declared)).toBe(declaredSerialization);
      expect(serializeColorValue(computed))
        .toBe(computedSerialization);
    },
  );

  it.each([
    ['rgb(none none none)', [undefined, undefined, undefined], 1],
    [
      'rgb(none none none / none)',
      [undefined, undefined, undefined],
      undefined,
    ],
    ['rgb(128 none none / none)', [128 / 255, undefined, undefined], undefined],
    ['rgb(20% none none)', [0.2, undefined, undefined], 1],
  ] as const)(
    'preserves missing components in the computed color %s',
    (input, components, alpha) => {
      const declared = parseColorValue(input)!;

      expect(resolveColorValue(declared, { stage: 'computed' })).toEqual({
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        components,
        alpha,
      });
    },
  );

  it('resolves legacy hsl and hsla functions to absolute sRGB', () => {
    expect(parseColorValue('hsl(120, 100%, 50%)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0, 1, 0],
      alpha: 1,
    });
    expect(parseColorValue('hsla(0.5turn, 25%, 75%, 20%)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0.6875, 0.8125, 0.8125],
      alpha: 0.2,
    });
  });

  it('resolves modern HSL without missing components to absolute sRGB', () => {
    expect(parseColorValue('hsl(120deg 100% 50 / 0.5)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0, 1, 0],
      alpha: 0.5,
    });
    expect(parseColorValue('hsla(none 0 100% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'hsl',
      components: [undefined, 0, 100],
      alpha: undefined,
    });
  });

  it.each([
    ['hsl(none none none)', [undefined, undefined, undefined], 1],
    [
      'hsl(none none none / none)',
      [undefined, undefined, undefined],
      undefined,
    ],
    ['hsl(120 none 50%)', [120, undefined, 50], 1],
    ['hsl(none 100% 50%)', [undefined, 100, 50], 1],
  ] as const)(
    'preserves missing HSL components in %s',
    (input, components, alpha) => {
      expect(parseColorValue(input)).toEqual({
        kind: ColorKind.Absolute,
        space: 'hsl',
        components,
        alpha,
      });
    },
  );

  it('rejects invalid mixtures of legacy and modern hsl syntax', () => {
    expect(parseColorValue('hsl(120, 100, 50%)')).toBeNull();
    expect(parseColorValue('hsl(none, 100%, 50%)')).toBeNull();
    expect(parseColorValue('hsl(120 100%)')).toBeNull();
    expect(parseColorValue('hsl(120 100% 50%, 0.5)')).toBeNull();
  });

  it('accepts math functions wherever hsl accepts a numeric value', () => {
    expect(parseColorValue('hsl(calc(0.5turn) calc(50%) calc(25) / calc(20%))'))
      .not.toBeNull();
  });

  // Adapted from WPT css/css-color/parsing/color-valid-hsl.html.
  it.each([
    [
      'hsl(calc(50deg + (sign(1em - 10px) * 10deg)), 0%, 0%, 50%)',
      'hsl(calc(50deg + (10deg * sign(1em - 10px))) 0 0 / 0.5)',
    ],
    [
      'hsl(0deg, 0%, 0%, calc(50% + (sign(1em - 10px) * 10%)))',
      'hsl(0 0 0 / calc(50% + (10% * sign(1em - 10px))))',
    ],
  ] as const)(
    'serializes the deferred legacy HSL calculation %s in modern syntax',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it.each([
    'hsl(120 -10% 50%)',
    'hsl(120 -10 50)',
  ])('clamps negative hsl saturation at parsed-value time for %s', (input) => {
    expect(parseColorValue(input)).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0.5, 0.5, 0.5],
      alpha: 1,
    });
  });

  it.each([
    ['hsl(0 100% 37.5%)', [0.75, 0, 0]],
    ['hsl(360 100% 37.5%)', [0.75, 0, 0]],
    ['hsl(720 100% 37.5%)', [0.75, 0, 0]],
    ['hsl(-300 100% 37.5%)', [0.75, 0.75, 0]],
  ] as const)('normalizes the hue in %s', (input, expected) => {
    expectColorCloseTo(
      parseColorValue(input) as AbsoluteColor,
      expected,
    );
  });

  it('resolves HWB without missing components to absolute sRGB', () => {
    expect(parseColorValue('hwb(120deg 20% 30 / 0.5)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0.2, 0.7, 0.2],
      alpha: 0.5,
    });
    expect(parseColorValue('hwb(none 0 100% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'hwb',
      components: [undefined, 0, 100],
      alpha: undefined,
    });
  });

  it('rejects invalid hwb syntax', () => {
    expect(parseColorValue('hwba(120 20% 30%)')).toBeNull();
    expect(parseColorValue('hwb(120, 20%, 30%)')).toBeNull();
    expect(parseColorValue('hwb(120 20%)')).toBeNull();
    expect(parseColorValue('hwb(120 20% 30% 0.5)')).toBeNull();
    expect(parseColorValue('hwb(120 20% 30% /)')).toBeNull();
  });

  it('accepts math functions wherever hwb accepts a numeric value', () => {
    expect(parseColorValue('hwb(calc(0.5turn) calc(20%) calc(30) / calc(50%))'))
      .not.toBeNull();
  });

  it.each([
    ['hwb(45 40% 60%)', 0.4],
    ['hwb(45 40% 80%)', 1 / 3],
  ])('normalizes achromatic white and black in %s', (input, gray) => {
    expect(parseColorValue(input)).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [gray, gray, gray],
      alpha: 1,
    });
  });

  // CSS Color 4 leaves finite negative whiteness and blackness unspecified.
  // Preserve them through its unbounded sample conversion until it says otherwise.
  it.each([
    ['hwb(30 -10% 20%)', [0.8, 0.35, -0.1]],
    ['hwb(30 20% -10%)', [1.1, 0.65, 0.2]],
  ] as const)('preserves finite negative components in %s', (input, components) => {
    const color = parseColorValue(input);

    expect(color).toMatchObject({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      alpha: 1,
    });

    if (color?.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected an absolute color');
    }

    expectComponentsCloseTo(color.components, components, 12);
  });

  it('preserves missing HWB components outside interpolation', () => {
    expect(parseColorValue('hwb(none none 100%)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'hwb',
      components: [undefined, undefined, 100],
      alpha: 1,
    });
  });

  it.each([
    ['hwb(none none none)', [undefined, undefined, undefined], 1],
    [
      'hwb(none none none / none)',
      [undefined, undefined, undefined],
      undefined,
    ],
    ['hwb(120 80% none)', [120, 80, undefined], 1],
    ['hwb(120 none 50%)', [120, undefined, 50], 1],
    ['hwb(none 100% 50% / none)', [undefined, 100, 50], undefined],
  ] as const)(
    'preserves missing HWB components in %s',
    (input, components, alpha) => {
      expect(parseColorValue(input)).toEqual({
        kind: ColorKind.Absolute,
        space: 'hwb',
        components,
        alpha,
      });
    },
  );

  it('resolves lab and oklab functions to absolute colors', () => {
    expect(parseColorValue('lab(50% 20 -30% / 0.4)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'lab',
      components: [50, 20, -37.5],
      alpha: 0.4,
    });
    expect(parseColorValue('oklab(none 0.1 -20% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [undefined, 0.1, -0.08],
      alpha: undefined,
    });
  });

  it('resolves lch and oklch functions to absolute colors', () => {
    expect(parseColorValue('lch(50 40% 270deg / 25%)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'lch',
      components: [50, 60, 270],
      alpha: 0.25,
    });
    expect(parseColorValue('oklch(none 0.2 none)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [undefined, 0.2, undefined],
      alpha: 1,
    });
  });

  it('rejects invalid Lab-family syntax', () => {
    expect(parseColorValue('lab(50%, 0, 0)')).toBeNull();
    expect(parseColorValue('oklab(0.5 0)')).toBeNull();
    expect(parseColorValue('lch(50 20 30 0.5)')).toBeNull();
    expect(parseColorValue('oklch(0.5 0.2 30 /)')).toBeNull();
  });

  it('accepts math functions throughout Lab-family colors', () => {
    const colors = [
      'lab(calc(50%) calc(0.1) calc(-20%) / calc(40%))',
      'oklab(calc(0.5) calc(10%) calc(-0.1))',
      'lch(calc(50%) calc(20) calc(90deg))',
      'oklch(calc(0.5) calc(20%) calc(0.25turn) / calc(0.5))',
    ].map((input) => parseColorValue(input));

    expect(colors).not.toContain(null);
  });

  // Adapted from WPT css/css-color/parsing/color-computed-lab.html.
  it.each([
    ['lab(400 -200 200 / 50%)', 'lab', [100, -200, 200], 0.5],
    ['lch(-40 -20 -700deg / 110%)', 'lch', [0, 0, 20], 1],
    ['lch(50 -20 -20deg)', 'lch', [50, 0, 340], 1],
    ['oklab(4 -2 2 / none)', 'oklab', [1, -2, 2], undefined],
    ['oklch(-0.4 -0.2 740deg / 50%)', 'oklch', [0, 0, 20], 0.5],
  ] as const)(
    'resolves the bounded components of %s',
    (input, space, components, alpha) => {
      expect(parseColorValue(input)).toEqual({
        kind: ColorKind.Absolute,
        space,
        components,
        alpha,
      });
    },
  );

  // Adapted from WPT css/css-color/parsing/color-computed-lab.html.
  it.each([
    [
      'lab(calc(50 * 3) calc(0.5 - 1) calc(1.5)'
        + ' / calc(-0.5 + 1))',
      'lab',
      [100, -0.5, 1.5],
      0.5,
    ],
    [
      'lch(calc(-50 * 3) calc(0.5 + 1) calc(-20deg * 2)'
        + ' / calc(-0.5 * 2))',
      'lch',
      [0, 1.5, 320],
      0,
    ],
    [
      'oklab(calc(0.5 * 3) calc(0.5 - 1) calc(1.5)'
        + ' / calc(-0.5 + 1))',
      'oklab',
      [1, -0.5, 1.5],
      0.5,
    ],
    [
      'oklch(calc(-0.5 * 3) calc(0.5 + 1) calc(-20deg * 2)'
        + ' / calc(-0.5 * 2))',
      'oklch',
      [0, 1.5, 320],
      0,
    ],
  ] as const)(
    'resolves calculated components in the computed color %s',
    (input, space, components, alpha) => {
      expect(resolveColorValue(
        parseColorValue(input)!,
        { stage: 'computed' },
      )).toEqual({
        kind: ColorKind.Absolute,
        space,
        components,
        alpha,
      });
    },
  );

  it('resolves every predefined color space', () => {
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
        kind: ColorKind.Absolute,
        space: space === 'xyz' ? 'xyz-d65' : space,
      });
    }

    expect(parseColorValue('color(DISPLAY-P3 0 0 0)')).toMatchObject({
      space: 'display-p3',
    });
  });

  it('resolves color function components and alpha', () => {
    expect(parseColorValue('color(display-p3 1 50% none / 25%)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'display-p3',
      components: [1, 0.5, undefined],
      alpha: 0.25,
    });

    expect(parseColorValue('color(xyz-d50 none 0.5 120% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: 'xyz-d50',
      components: [undefined, 0.5, 1.2],
      alpha: undefined,
    });
  });

  it('retains out-of-range color function components', () => {
    expect(parseColorValue('color(prophoto-rgb -0.2 1.4 120% / 2)'))
      .toEqual({
        kind: ColorKind.Absolute,
        space: 'prophoto-rgb',
        components: [-0.2, 1.4, 1.2],
        alpha: 1,
      });
  });

  it('rejects invalid color function syntax', () => {
    expect(parseColorValue('color(srgb 0 0)')).toBeNull();
    expect(parseColorValue('color(srgb 0 0 0 0)')).toBeNull();
    expect(parseColorValue('color(srgb, 0, 0, 0)')).toBeNull();
    expect(parseColorValue('color(profoto-rgb 0 0 0)')).toBeNull();
    expect(parseColorValue('color(srgb 0 0 0 /)')).toBeNull();
  });

  it('accepts math functions throughout color()', () => {
    expect(parseColorValue(
      'color(display-p3 calc(0.5) calc(25%) none / calc(40%))',
    )).not.toBeNull();
  });

  it.each([
    ['in srgb', { space: 'srgb' }],
    ['in srgb-linear', { space: 'srgb-linear' }],
    ['in display-p3', { space: 'display-p3' }],
    ['in display-p3-linear', { space: 'display-p3-linear' }],
    ['in a98-rgb', { space: 'a98-rgb' }],
    ['in prophoto-rgb', { space: 'prophoto-rgb' }],
    ['in rec2020', { space: 'rec2020' }],
    ['in lab', { space: 'lab' }],
    ['in oklab', { space: 'oklab' }],
    ['in xyz', { space: 'xyz-d65' }],
    ['in xyz-d50', { space: 'xyz-d50' }],
    ['in xyz-d65', { space: 'xyz-d65' }],
    ['in hsl', { space: 'hsl' }],
    ['in hwb', { space: 'hwb' }],
    ['in lch', { space: 'lch' }],
    ['in oklch', { space: 'oklch' }],
  ])('parses the color interpolation method %s', (input, expected) => {
    expect(parseColorInterpolationMethod(input)).toEqual(expected);
  });

  it.each([
    ['in oklch shorter hue', 'shorter'],
    ['in oklch longer hue', 'longer'],
    ['in oklch increasing hue', 'increasing'],
    ['in oklch decreasing hue', 'decreasing'],
  ])('parses the hue interpolation method in %s', (input, hue) => {
    expect(parseColorInterpolationMethod(input)).toEqual({
      space: 'oklch',
      hue,
    });
  });

  it('parses color interpolation methods case-insensitively', () => {
    expect(parseColorInterpolationMethod('IN OkLcH LoNgEr HuE')).toEqual({
      space: 'oklch',
      hue: 'longer',
    });
  });

  it.each([
    '', 'in', 'srgb', 'in unknown', 'in srgb shorter hue',
    'in oklch shorter', 'in oklch hue', 'in oklch shorter hue extra',
    'in srgb-legacy',
  ])('rejects the invalid color interpolation method %j', (input) => {
    expect(parseColorInterpolationMethod(input)).toBeNull();
  });

  it('serializes parsed color functions with canonical spelling and spacing', () => {
    const cases = [
      [' RGBa( 1 ,  2, 3 , 50% ) ', 'rgba(1, 2, 3, 0.5)'],
      ['rgb(0\t,  51 ,255)', 'rgb(0, 51, 255)'],
      [' HSLa( .5turn , 25% , 75% , 20% ) ', 'rgba(175.3125, 207.1875, 207.1875, 0.2)'],
      [' HWB( .5turn   20%  30% / 50% ) ', 'rgba(51, 178.5, 178.5, 0.5)'],
      ['rgb(29 164 192 / 95%)', 'rgba(29, 164, 192, 0.95)'],
      ['hwb(740deg 20% 30% / 50%)', 'rgba(178.5, 93.5, 51, 0.5)'],
      [' LAB( 50%  20  -30% / 40% ) ', 'lab(50 20 -37.5 / 0.4)'],
      [' OKLAB( 50%  20%  -30% / 40% ) ', 'oklab(0.5 0.08 -0.12 / 0.4)'],
      [' LCH( 50%  40%  270deg / 25% ) ', 'lch(50 60 270 / 0.25)'],
      [' OKLCH( .5  20%  .25turn / 25% ) ', 'oklch(0.5 0.08 90 / 0.25)'],
      [' COLOR( DISPLAY-P3  .1  20%  NoNe / 25% ) ', 'color(display-p3 0.1 0.2 none / 0.25)'],
      [' COLOR( XYZ  0  0  0 ) ', 'color(xyz-d65 0 0 0)'],
    ];

    for (const [input, serialized] of cases) {
      const color = parseColorValue(input);

      expect(color).not.toBeNull();
      expect(serializeColorValue(color!)).toBe(serialized);
    }
  });

  // Section 16.2.1 HTML-compatible serialization of sRGB values.
  it('serializes opaque 8-bit sRGB colors in hexadecimal notation', () => {
    const color = parseColorValue('#ff00ff')!;

    expect(serializeColorValue(color, true))
      .toBe('#ff00ff');
    expect(serializeColorValue(color)).toBe('rgb(255, 0, 255)');
  });

  it.each([
    ['#ff00ffed', 'rgba(255, 0, 255, 0.93)'],
    ['rgb(255, 0, 255)', '#ff00ff'],
    ['rgb(254.5, 0, 255)', 'rgb(254.5, 0, 255)'],
    ['rgb(100%, 0%, 100%)', 'rgb(255, 0, 255)'],
    ['hsl(300 100% 50%)', 'rgb(255, 0, 255)'],
    ['color(display-p3 1 0 1)', 'color(display-p3 1 0 1)'],
  ] as const)(
    'serializes %s as %s in HTML-compatible mode',
    (input, serialized) => {
      expect(serializeColorValue(
        parseColorValue(input)!,
        true,
      )).toBe(serialized);
    },
  );

  // Section 16.2.2 serialization examples
  it.each([
    ['rgb(29 164 192 / 95%)', 'rgba(29, 164, 192, 0.95)'],
    ['hwb(740deg 20% 30% / 50%)', 'rgba(178.5, 93.5, 51, 0.5)'],
    ['hwb(20 20% 30% / 50%)', 'rgba(178.5, 93.5, 51, 0.5)'],
    ['hwb(20 none 30% / none)', 'hwb(20 none 30% / none)'],
    ['rgb(none 0 0)', 'color(srgb none 0 0)'],
    ['rgb(146.064 107.457 131.223)', 'rgb(146.064, 107.457, 131.223)'],
    ['rgb(57.28% 42.14% 51.46%)', 'rgb(146.064, 107.457, 131.223)'],
    ['goldenrod', 'rgb(218, 165, 32)'],
  ] as const)(
    'matches the section 16.2.2 serialization example %s',
    (input, serialized) => {
      const context = { stage: 'computed' } as const;
      const color = resolveColorValue(parseColorValue(input)!, context);

      expect(serializeColorValue(color)).toBe(serialized);
    },
  );

  // Section 16.3 serialization examples
  it.each([
    ['lab(56.200% 0.000 83.600)', 'lab(56.2 0 83.6)'],
    ['lab(56.200% 0.000 66.88%)', 'lab(56.2 0 83.6)'],
    ['lch(37% 105.0 305.00)', 'lch(37 105 305)'],
    ['lch(56.2% 83.6 357.4 / 93%)', 'lch(56.2 83.6 357.4 / 0.93)'],
  ] as const)(
    'matches the section 16.3 serialization example %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  // Adapted from WPT css/css-color/parsing/color-computed-lab.html.
  it.each([
    ['lab(none none none / none)', 'lab(none none none / none)'],
    ['lab(20% -50% 90% / 0.5)', 'lab(20 -62.5 112.5 / 0.5)'],
    ['lch(10 20 740deg)', 'lch(10 20 20)'],
    ['lch(calc(NaN) 0 0)', 'lch(0 0 0)'],
  ] as const)(
    'matches section 16.3 WPT serialization coverage for %s',
    (input, serialized) => {
      const context = { stage: 'computed' } as const;
      const color = resolveColorValue(parseColorValue(input)!, context);

      expect(serializeColorValue(color)).toBe(serialized);
    },
  );

  // Section 16.4 serialization examples
  // The first input corrects the specification's omitted "%" after 54.0.
  it.each([
    ['oklab(54.0% -25% -5%)', 'oklab(0.54 -0.1 -0.02)'],
    ['oklch(56.43% 0.0900 123.40)', 'oklch(0.5643 0.09 123.4)'],
    ['oklch(53.85% 0.1725 320.67 / 70%)', 'oklch(0.5385 0.1725 320.67 / 0.7)'],
  ] as const)(
    'matches the section 16.4 serialization example %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  // Adapted from WPT css/css-color/parsing/color-computed-lab.html.
  it.each([
    ['oklab(none none none / none)', 'oklab(none none none / none)'],
    ['oklab(20% 70% -80% / 0.5)', 'oklab(0.2 0.28 -0.32 / 0.5)'],
    ['oklch(0.1 0.2 -700deg)', 'oklch(0.1 0.2 20)'],
    ['oklch(calc(NaN) 0 0)', 'oklch(0 0 0)'],
  ] as const)(
    'matches section 16.4 WPT serialization coverage for %s',
    (input, serialized) => {
      const context = { stage: 'computed' } as const;
      const color = resolveColorValue(parseColorValue(input)!, context);

      expect(serializeColorValue(color)).toBe(serialized);
    },
  );

  // Section 16.5 serialization examples. The specification's first and third
  // results conditionally retain two and three decimal places, respectively;
  // retaining the additional authored precision is also conforming.
  it.each([
    [
      'color(dIsPlAy-P3  0.964  0.763  0.787)',
      'color(display-p3 0.964 0.763 0.787)',
    ],
    [
      'color(rec2020 0.400 0.660 0.340)',
      'color(rec2020 0.4 0.66 0.34)',
    ],
    [
      'color(prophoto-rgb 0.2804 0.40283 0.42259/85%)',
      'color(prophoto-rgb 0.2804 0.40283 0.42259 / 0.85)',
    ],
  ] as const)(
    'matches the section 16.5 serialization example %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  // Adapted from WPT css/css-color/parsing/color-computed-color-function.html.
  it.each([
    [
      'color(srgb 100% none 20% / 23.7%)',
      'color(srgb 1 none 0.2 / 0.237)',
    ],
    ['color(srgb 400% 0 10 / 50%)', 'color(srgb 4 0 10 / 0.5)'],
    ['color(xyz 0.2 none 25% / none)', 'color(xyz-d65 0.2 none 0.25 / none)'],
  ] as const)(
    'matches section 16.5 WPT serialization coverage for %s',
    (input, serialized) => {
      const context = { stage: 'computed' } as const;
      const color = resolveColorValue(parseColorValue(input)!, context);

      expect(serializeColorValue(color)).toBe(serialized);
    },
  );

  // Section 16.6 serialization of currentcolor.
  it('serializes computed currentcolor in ASCII lowercase', () => {
    const context = { stage: 'computed' } as const;
    const color = resolveColorValue(parseColorValue('currentColor')!, context);

    expect(serializeColorValue(color)).toBe('currentcolor');
  });

  it('serializes context-dependent calc color components', () => {
    const contextual = parseColorValue(
      ' color( display-p3  calc(sign(1em - 1px))  20%  0'
      + ' / calc(.25 + .25) ) ',
    );

    expect(contextual).not.toBeNull();
    expect(serializeColorValue(contextual!))
      .toBe('color(display-p3 sign(1em - 1px) 0.2 0 / calc(0.5))');
  });

  it('uses the value stage to serialize reducible calc color components', () => {
    const declared = parseColorValue(
      'color(display-p3 calc(.1 + .2) 0 0 / calc(.25 + .25))',
    )!;
    const computed = resolveColorValue(declared, { stage: 'computed' });

    expect(serializeColorValue(declared))
      .toBe('color(display-p3 calc(0.3) 0 0 / calc(0.5))');
    expect(serializeColorValue(computed))
      .toBe('color(display-p3 0.3 0 0 / 0.5)');
  });

  const calculatedAlphaSerializationCases = [
    [
      'rgb(0 0 0 / calc(2 * 60%))',
      'rgb(0 0 0 / calc(1.2))',
      'rgb(0, 0, 0)',
    ],
    [
      'color(display-p3 0 1 0 / calc(2 * 60%))',
      'color(display-p3 0 1 0 / calc(1.2))',
      'color(display-p3 0 1 0)',
    ],
  ] as const;

  it.each(calculatedAlphaSerializationCases)(
    'normalizes calculated alpha in the declared color %s',
    (input, declared) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(declared);
    },
  );

  it.each(calculatedAlphaSerializationCases)(
    'clamps calculated alpha in the computed color %s',
    (input, _declared, computed) => {
      const context = { stage: 'computed' } as const;

      expect(serializeColorValue(
        resolveColorValue(parseColorValue(input)!, context),
      )).toBe(computed);
    },
  );

  it('preserves unresolved calculated percentage alpha', () => {
    const color = parseColorValue(
      'color(display-p3 0 1 0 / calc(60% * sign(1em - 1px)))',
    )!;

    expect(serializeColorValue(color)).toBe(
      'color(display-p3 0 1 0 / calc(60% * sign(1em - 1px)))',
    );
  });

  it('serializes keyword colors in lowercase', () => {
    expect(serializeColorValue({
      kind: ColorKind.Named,
      name: 'rebeccapurple',
    })).toBe('rebeccapurple');
    expect(serializeColorValue({
      kind: ColorKind.Named,
      name: 'transparent',
    })).toBe('transparent');
    expect(serializeColorValue({
      kind: ColorKind.System,
      name: 'canvastext',
    })).toBe('canvastext');
    expect(serializeColorValue({
      kind: ColorKind.Deprecated,
      name: 'windowtext',
    })).toBe('windowtext');
    expect(serializeColorValue({
      kind: ColorKind.CurrentColor,
    })).toBe('currentcolor');
  });

  it('serializes computed sRGB keywords numerically', () => {
    const context = { stage: 'computed' } as const;

    expect(serializeColorValue(resolveColorValue(
      parseColorValue('goldenrod')!,
      context,
    ))).toBe('rgb(218, 165, 32)');
    expect(serializeColorValue(resolveColorValue(
      parseColorValue('transparent')!,
      context,
    ))).toBe('rgba(0, 0, 0, 0)');
  });

  it('serializes absolute sRGB colors in legacy rgb form', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [1, 0.5, 0],
      alpha: 1,
    })).toBe('rgb(255, 127.5, 0)');
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [1.2, -0.1, 0],
      alpha: 0.5,
    })).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('preserves missing absolute sRGB components through color()', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [undefined, 0.5, 0],
      alpha: undefined,
    })).toBe('color(srgb none 0.5 0 / none)');
  });

  it.each([
    ['rgb(none 0 0)', 'color(srgb none 0 0)'],
    ['rgb(none 0 0 / none)', 'color(srgb none 0 0 / none)'],
    ['hsl(none 0% 100% / none)', 'hsl(none 0% 100% / none)'],
    ['hwb(20 none 30% / none)', 'hwb(20 none 30% / none)'],
  ] as const)(
    'preserves missing components while serializing %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('keeps color(srgb) distinct from rgb()', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [1, 0, 0],
      alpha: 1,
    })).toBe('color(srgb 1 0 0)');
  });

  it('clamps and rounds numerical alpha values', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: 2,
    })).toBe('color(display-p3 1 0 0)');
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: 0.123456789,
    })).toBe('color(display-p3 1 0 0 / 0.123457)');
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: Number.NaN,
    })).toBe('color(display-p3 1 0 0 / 0)');
  });

  it.each([
    // CSS Color 4 examples 6 and 7.
    ['rgb(100% 0% 0% / 50%)', 'rgba(255, 0, 0, 0.5)'],
    ['rgba(100%, 0%, 0%, 0.5)', 'rgba(255, 0, 0, 0.5)'],
    ['rgba(0, 0, 0, 12.3456789%)', 'rgba(0, 0, 0, 0.123457)'],
    ['rgb(0 0 0 / 12.3456789%)', 'rgba(0, 0, 0, 0.123457)'],
    ['color(display-p3 0 0 0 / 70%)', 'color(display-p3 0 0 0 / 0.7)'],
    ['color(display-p3 0 0 0 / 120%)', 'color(display-p3 0 0 0)'],
  ] as const)(
    'serializes the alpha value in %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it.each([
    ['#ff000080', 'rgba(255, 0, 0, 0.5)'],
    ['#ff0000ed', 'rgba(255, 0, 0, 0.93)'],
    ['#ff0000ec', 'rgba(255, 0, 0, 0.925)'],
  ] as const)(
    'serializes the 8-bit alpha value in %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('serializes absolute HSL and HWB colors with missing components', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'hsl',
      components: [20, undefined, 30],
      alpha: undefined,
    })).toBe('hsl(20 none 30% / none)');
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: 'hwb',
      components: [20, undefined, 30],
      alpha: 1,
    })).toBe('hwb(20 none 30%)');
  });

  it('serializes absolute wide-gamut colors in their notation', () => {
    const cases: [AbsoluteColor, string][] = [
      [{
        kind: ColorKind.Absolute,
        space: 'lab',
        components: [56.2, 0, 83.6],
        alpha: 1,
      }, 'lab(56.2 0 83.6)'],
      [{
        kind: ColorKind.Absolute,
        space: 'lch',
        components: [56.2, 83.6, 357.4],
        alpha: 0.93,
      }, 'lch(56.2 83.6 357.4 / 0.93)'],
      [{
        kind: ColorKind.Absolute,
        space: 'oklab',
        components: [0.54, -0.1, -0.02],
        alpha: 1,
      }, 'oklab(0.54 -0.1 -0.02)'],
      [{
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.5385, 0.1725, 320.67],
        alpha: 0.7,
      }, 'oklch(0.5385 0.1725 320.67 / 0.7)'],
      [{
        kind: ColorKind.Absolute,
        space: 'display-p3',
        components: [0.28, 0.403, 0.423],
        alpha: 0.85,
      }, 'color(display-p3 0.28 0.403 0.423 / 0.85)'],
    ];

    for (const [color, serialized] of cases) {
      expect(serializeColorValue(color)).toBe(serialized);
    }
  });

  type ColorConversionReference = readonly [
    rgb: ColorVector3,
    srgbLch: ColorVector3,
    srgbXyz: ColorVector3,
    displayP3Lch: ColorVector3,
    displayP3Xyz: ColorVector3,
  ];

  // csswg-drafts/css-color-4/tests.js
  const colorConversionReferences = [
    [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[0, 0, 0.5], [11.257649830405711, 78.4855230871109, 301.36852485669147], [0.038621048285762835, 0.015448419314305135, 0.20340417336894157], [12.125050622409844, 80.98311488018534, 301.3685234204596], [0.04242665379485494, 0.016970661517941975, 0.2234470433195694]],
    [[0, 0, 1], [29.5675825705695, 131.20704008299427, 301.36852485669147], [0.1804375, 0.072175, 0.9503041], [31.017647321468736, 135.3823531039849, 301.3685234204596], [0.1982172852343625, 0.079286914093745, 1.043944368900976]],
    [[0, 0.5, 0], [46.10200487720031, 67.79764688120514, 134.39124629270788], [0.07653599625318884, 0.15307199250637768, 0.025511991616358264], [45.382094598457606, 88.59863623716036, 136.00886646919355], [0.0568638160351965, 0.14806050212937955, 0.00965611970408998]],
    [[0, 0.5, 0.5], [47.805245436929056, 31.600981799674866, 196.45241125035645], [0.11515704453895168, 0.1685204118206828, 0.22891616498529982], [47.29038116180345, 42.30133919358886, 194.47526369092208], [0.09929046983005144, 0.1650311636473215, 0.23310316302365938]],
    [[0, 0.5, 1], [53.390836258164114, 73.33499428844263, 277.0144049848567], [0.2569734962531888, 0.2252469925063777, 0.9758160916163583], [53.46621809897093, 77.86398465185749, 274.3831905635118], [0.255081101269559, 0.22734741622312454, 1.053600488605066]],
    [[0, 1, 0], [87.81813005327668, 113.33973734241219, 134.3912462927079], [0.3575761, 0.7151522, 0.119192], [86.61463043852204, 148.1134909831133, 136.00886646919355], [0.26566769316909306, 0.6917385218365064, 0.04511338185890264]],
    [[0, 1, 0.5], [88.44071092427411, 85.6929438417646, 147.73052605574094], [0.39619714828576286, 0.7306006193143052, 0.3225961733689416], [87.31412287701264, 109.91612392701252, 152.10424733448326], [0.308094346963948, 0.7087091833544484, 0.26856042517847206]],
    [[0, 1, 1], [90.66549786839941, 52.82848508316594, 196.45241125035645], [0.5380136, 0.7873272, 1.0694961], [89.80478094983177, 70.7166530696031, 194.47526369092208], [0.46388497840345555, 0.7710254359302514, 1.0890577507598787]],
    [[0.5, 0, 0], [26.047161670467766, 62.28793882063699, 39.09692484182021], [0.0882826382551959, 0.04552075006566379, 0.004138250005969436], [27.191500659719573, 73.69635368760655, 39.93345411121776], [0.104146200774186, 0.04900997683491106, 0]],
    [[0.5, 0, 0.5], [29.563247268933154, 66.64193335495227, 327.1093519251607], [0.12690368654095874, 0.06096916937996893, 0.207542423374911], [30.848376103967077, 73.20545387928618, 329.8103804861144], [0.14657285456904096, 0.06598063835285303, 0.2234470433195694]],
    [[0.5, 0, 1], [39.28279656389248, 121.2547640439368, 308.00468721507167], [0.2687201382551959, 0.1176957500656638, 0.9544423500059694], [40.930250649478054, 127.31433110210455, 309.3255378668548], [0.3023634860085485, 0.12829689092865607, 1.043944368900976]],
    [[0.5, 0.5, 0], [51.957594419557566, 56.65236969828312, 99.57459669758012], [0.16481863450838474, 0.19859274257204146, 0.0296502416223277], [51.8131467040147, 73.73887377501569, 98.13571529011948], [0.1610100168093825, 0.1970704789642906, 0.00965611970408998]],
    [[0.5, 0.5, 0.5], [53.38896687883651, 0.000017583257676680256, 157.37860193127446], [0.2034396827941476, 0.2140411618863466, 0.23305441499126928], [53.3888651604252, 0.008755270717235005, 254.8841151658154], [0.20343667060423745, 0.21404114048223258, 0.23310316302365938]],
    [[0.5, 0.5, 1], [58.19651042992987, 69.76315231291977, 291.8303324780847], [0.34525613450838477, 0.27076774257204145, 0.9799543416223276], [58.637484950362335, 74.18813521931754, 292.1733198003908], [0.359227302043745, 0.27635739305803564, 1.053600488605066]],
    [[0.5, 1, 0], [90.068036829637, 103.92399790206163, 126.18719683920217], [0.4458587382551959, 0.7606729500656638, 0.12333025000596945], [89.10440611727756, 133.51195139098468, 126.51982278628302], [0.36981389394327907, 0.7407484986714175, 0.04511338185890264]],
    [[0.5, 1, 0.5], [90.66470674310524, 74.1904047582473, 138.60917527085977], [0.48447978654095875, 0.776121369379969, 0.326734423374911], [89.77146389413845, 91.18473102158605, 142.3429556503696], [0.412240547738134, 0.7577191601893595, 0.26856042517847206]],
    [[0.5, 1, 1], [92.80039769160194, 38.81312541835366, 197.27291249073542], [0.6262962382551959, 0.8328479500656638, 1.0736343500059695], [92.15152655660088, 51.01305777173378, 195.47622379141126], [0.5680311791776416, 0.8200354127651625, 1.0890577507598787]],
    [[1, 0, 0], [54.29173546502365, 106.83900393835908, 40.85263489758937], [0.4124564, 0.2126729, 0.0193339], [56.20476764886537, 136.7568948664298, 46.30795018347639], [0.4865709486482162, 0.2289745640697488, 0]],
    [[1, 0, 0.5], [55.6322739970431, 84.04016736731634, 4.1833907823003695], [0.45107744828576285, 0.22812131931430513, 0.22273807336894158], [57.6000486421556, 97.56633503099316, 5.590189197210951], [0.5289976024430711, 0.24594522558769077, 0.2234470433195694]],
    [[1, 0, 1], [60.1697008006315, 111.40768994055931, 327.10935192516075], [0.5928939, 0.2848479, 0.969638], [62.318096376500435, 122.380160616024, 329.8103804861144], [0.6847882338825787, 0.3082614781634938, 1.043944368900976]],
    [[1, 0.5, 0], [67.72075953447306, 87.65882387386596, 58.557095621037966], [0.48899239625318885, 0.36574489250637765, 0.04484589161635827], [68.703219054922, 117.8986875235393, 61.43138053688231], [0.5434347646834127, 0.37703506619912835, 0.00965611970408998]],
    [[1, 0.5, 0.5], [68.67300154466754, 54.958026775352145, 25.810960732929495], [0.5276134445389516, 0.3811933118206828, 0.24825006498529983], [69.72447161538403, 66.36489541902458, 25.282022609563732], [0.5858614184782676, 0.3940057277170703, 0.23310316302365938]],
    [[1, 0.5, 1], [71.99816641415508, 74.5865173880577, 325.81024490310034], [0.6694298962531888, 0.43791989250637764, 0.9951499916163582], [73.28046439269039, 83.94353995709928, 328.8783770719978], [0.7416520499177752, 0.45632198029287335, 1.053600488605066]],
    [[1, 1, 0], [97.60712733040384, 94.707781122248, 99.57459669758006], [0.7700325, 0.9278251, 0.1385259], [97.36564894741473, 123.27189762543868, 98.13571529011946], [0.7522386418173093, 0.9207130859062552, 0.04511338185890264]],
    [[1, 1, 0.5], [98.1277751014117, 61.22609652360603, 101.47173621025149], [0.8086535482857629, 0.9432735193143051, 0.34193007336894155], [97.93976302926873, 71.24063681412848, 100.89159287690555], [0.7946652956121643, 0.9376837474241972, 0.26856042517847206]],
    [[1, 1, 1], [100.00000357370622, 0.00002939455720908227, 157.3786019654702], [0.95047, 1.0000001, 1.08883], [99.99983352742068, 0.014636497416960078, 254.8841151652981], [0.9504559270516717, 1.0000000000000002, 1.0890577507598787]],
  ] as const satisfies readonly ColorConversionReference[];

  it.each(colorConversionReferences)(
    'matches the CSS Working Group conversion references for RGB %j',
    (rgb, srgbLch, srgbXyz, displayP3Lch, displayP3Xyz) => {
      const srgb: AbsoluteColor = {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [...rgb],
        alpha: 1,
      };
      const displayP3: AbsoluteColor = {
        ...srgb,
        space: 'display-p3',
      };
      const actualSrgbXyz = convertAbsoluteColor(srgb, 'xyz-d65');
      const actualSrgbLch = convertAbsoluteColor(srgb, 'lch');
      const actualDisplayP3Xyz = convertAbsoluteColor(displayP3, 'xyz-d65');
      const actualDisplayP3Lch = convertAbsoluteColor(displayP3, 'lch');

      expect(actualSrgbXyz.space).toBe('xyz-d65');
      expectColorCloseTo(actualSrgbXyz, {
        kind: ColorKind.Absolute,
        space: 'xyz-d65',
        components: [...srgbXyz],
        alpha: 1,
      });
      expect(actualSrgbLch.space).toBe('lch');
      expectColorCloseTo(actualSrgbLch, {
        kind: ColorKind.Absolute,
        space: 'lch',
        components: [...srgbLch],
        alpha: 1,
      });
      expect(actualDisplayP3Xyz.space).toBe('xyz-d65');
      expectColorCloseTo(actualDisplayP3Xyz, {
        kind: ColorKind.Absolute,
        space: 'xyz-d65',
        components: [...displayP3Xyz],
        alpha: 1,
      });
      expect(actualDisplayP3Lch.space).toBe('lch');
      expectColorCloseTo(actualDisplayP3Lch, {
        kind: ColorKind.Absolute,
        space: 'lch',
        components: [...displayP3Lch],
        alpha: 1,
      });
    },
  );

  it('converts absolute HSL and HWB colors to sRGB', () => {
    const hsl: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'hsl',
      components: [120, 100, 50],
      alpha: 0.5,
    };
    const hwb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'hwb',
      components: [120, 0, 0],
      alpha: 0.5,
    };

    expect(convertAbsoluteColor(hsl, 'srgb')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0, 1, 0],
      alpha: 0.5,
    });
    expect(convertAbsoluteColor(hwb, 'srgb')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0, 1, 0],
      alpha: 0.5,
    });
  });

  it('normalizes 8-bit sRGB values before color conversion', () => {
    const color = parseColorValue('#ff0080cc') as AbsoluteColor;

    expect(convertAbsoluteColor(color, 'srgb')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [1, 0, 128 / 255],
      alpha: 0.8,
    });
  });

  it('converts absolute sRGB colors to HSL and HWB', () => {
    const rgb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0, 1, 0],
      alpha: 0.5,
    };

    expect(convertAbsoluteColor(rgb, 'hsl')).toEqual({
      kind: ColorKind.Absolute,
      space: 'hsl',
      components: [120, 100, 50],
      alpha: 0.5,
    });
    expect(convertAbsoluteColor(rgb, 'hwb')).toEqual({
      kind: ColorKind.Absolute,
      space: 'hwb',
      components: [120, 0, 0],
      alpha: 0.5,
    });
  });

  it('corrects negative saturation when converting out-of-gamut sRGB to HSL', () => {
    const rgb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [2, 1.5, 1.5],
      alpha: 0.5,
    };
    const hsl = convertAbsoluteColor(rgb, 'hsl');

    expectComponentsCloseTo(hsl.components, [180, 100 / 3, 175], 12);
    expectColorCloseTo(convertAbsoluteColor(hsl, 'srgb'), rgb);
  });

  it('replaces missing components with zero during color conversion', () => {
    const hsl: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'hsl',
      components: [undefined, 100, 50],
      alpha: undefined,
    };
    const gray: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0.5, 0.5, 0.5],
      alpha: 1,
    };

    expect(convertAbsoluteColor(hsl, 'srgb').components).toEqual([1, 0, 0]);
    expect(convertAbsoluteColor(gray, 'hsl').components[0]).toBeUndefined();
    expect(convertAbsoluteColor(gray, 'hwb').components[0]).toBeUndefined();
  });

  it.each([
    ['HSL', 'hsl', 'srgb', [0.4999975, 0.5000025, 0.4999975], 0],
    ['HWB', 'hwb', 'srgb', [0.499995, 0.5, 0.499995], 0],
    ['LCH', 'lch', 'lab', [50, -0.0005, 0.0008660254], 2],
    ['OKLCH', 'oklch', 'oklab', [0.5, -0.0000015, 0.000002598], 2],
  ] as const)(
    'uses the %s powerless-hue epsilon when conversion produces the hue',
    (_, target, source, components, hueIndex) => {
      const converted = convertAbsoluteColor(
        {
          kind: ColorKind.Absolute,
          space: source,
          components: [...components],
          alpha: 1,
        },
        target,
      );

      expect(converted.components[hueIndex]).toBeUndefined();
    },
  );

  it('routes absolute color conversion through sRGB', () => {
    const hsl: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'hsl',
      components: [120, 100, 50],
      alpha: 0.5,
    };

    expect(convertAbsoluteColor(hsl, 'hwb')).toEqual({
      kind: ColorKind.Absolute,
      space: 'hwb',
      components: [120, 0, 0],
      alpha: 0.5,
    });
    expect(convertAbsoluteColor(hsl, 'srgb-legacy')).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [0, 1, 0],
      alpha: 0.5,
    });
  });

  it('converts Lab and Oklab between rectangular and polar forms', () => {
    const lab: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'lab',
      components: [50, 0, 40],
      alpha: 0.5,
    };
    const oklab: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0.5, 0.1, 0],
      alpha: 0.25,
    };

    expect(convertAbsoluteColor(lab, 'lch')).toEqual({
      kind: ColorKind.Absolute,
      space: 'lch',
      components: [50, 40, 90],
      alpha: 0.5,
    });
    const labRoundTrip = convertAbsoluteColor(
      convertAbsoluteColor(lab, 'lch'),
      'lab',
    );

    expect(labRoundTrip.space).toBe('lab');
    expect(labRoundTrip.alpha).toBe(lab.alpha);
    expectComponentsCloseTo(labRoundTrip.components, [50, 0, 40], 12);
    expect(convertAbsoluteColor(oklab, 'oklch')).toEqual({
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [0.5, 0.1, 0],
      alpha: 0.25,
    });
    const oklabRoundTrip = convertAbsoluteColor(
      convertAbsoluteColor(oklab, 'oklch'),
      'oklab',
    );

    expect(oklabRoundTrip.space).toBe('oklab');
    expect(oklabRoundTrip.alpha).toBe(oklab.alpha);
    expectComponentsCloseTo(oklabRoundTrip.components, [0.5, 0.1, 0], 12);
  });

  it('replaces a missing polar hue with zero rectangular components', () => {
    const lch: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'lch',
      components: [50, 40, undefined],
      alpha: 0.5,
    };
    const oklch: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [0.5, 0.1, undefined],
      alpha: 0.25,
    };

    expect(convertAbsoluteColor(lch, 'lab')).toEqual({
      kind: ColorKind.Absolute,
      space: 'lab',
      components: [50, 0, 0],
      alpha: 0.5,
    });
    expect(convertAbsoluteColor(oklch, 'oklab')).toEqual({
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0.5, 0, 0],
      alpha: 0.25,
    });
  });

  it('converts known sRGB and Display P3 primaries to XYZ D65', () => {
    const red: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [1, 0, 0],
      alpha: 1,
    };
    const p3Red: AbsoluteColor = {
      ...red,
      space: 'display-p3',
    };
    const srgbXyz = convertAbsoluteColor(red, 'xyz-d65').components;
    const p3Xyz = convertAbsoluteColor(p3Red, 'xyz-d65').components;

    expectComponentsCloseTo(
      srgbXyz,
      [0.4123907993, 0.2126390059, 0.0193308187],
      9,
    );
    expectComponentsCloseTo(p3Xyz, [0.4865709486, 0.2289745641], 9);
    expect(p3Xyz[2]).toBe(0);
  });

  it('converts colors across D50 and D65 spaces', () => {
    const labWhite: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'lab',
      components: [100, 0, 0],
      alpha: 0.75,
    };
    const srgb = convertAbsoluteColor(labWhite, 'srgb');

    expect(srgb.alpha).toBe(0.75);

    expectComponentsCloseTo(srgb.components, [1, 1, 1], 6);
  });

  it('round-trips absolute colors in every color space through XYZ', () => {
    const colors: AbsoluteColor[] = [
      {
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'srgb-linear',
        components: [0.1, 0.3, 0.5],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'hsl',
        components: [210, 50, 40],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'hwb',
        components: [210, 20, 30],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'lab',
        components: [50, 20, -30],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'lch',
        components: [50, 36.0555127546, 303.690067526],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklab',
        components: [0.5, 0.1, -0.1],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.5, 0.1414213562, 315],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'display-p3',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'display-p3-linear',
        components: [0.1, 0.3, 0.5],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'a98-rgb',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'prophoto-rgb',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'rec2020',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'xyz-d50',
        components: [0.3, 0.4, 0.2],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Absolute,
        space: 'xyz-d65',
        components: [0.3, 0.4, 0.2],
        alpha: 0.7,
      },
    ];

    for (const color of colors) {
      const intermediate = color.space === 'xyz-d50'
        ? 'xyz-d65'
        : 'xyz-d50';
      const converted = convertAbsoluteColor(color, intermediate);
      const roundTrip = convertAbsoluteColor(converted, color.space);

      expect(roundTrip.space).toBe(color.space);
      expect(roundTrip.alpha).toBe(color.alpha);

      expectComponentsCloseTo(
        roundTrip.components,
        color.components,
        7,
      );
    }
  });

  it('returns an unchanged absolute color conversion by identity', () => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: 1,
    };

    expect(convertAbsoluteColor(color, 'display-p3')).toBe(color);
  });

  it('calculates color difference as Euclidean distance in Oklab', () => {
    const reference: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0.5, 0.1, -0.2],
      alpha: 1,
    };
    const sample: AbsoluteColor = {
      ...reference,
      components: [0.6, 0.3, -0.4],
    };

    expect(deltaEOK(reference, sample)).toBeCloseTo(0.3, 12);
  });

  it('compares same-space color components and alpha within epsilon', () => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0.5, 0.1, -0.2],
      alpha: 0.4,
    };

    expect(areColorsEquivalent(color, {
      ...color,
      components: [0.500009, 0.099991, -0.2],
      alpha: 0.400009,
    })).toBe(true);
    expect(areColorsEquivalent(color, {
      ...color,
      alpha: 0.40002,
    })).toBe(false);
  });

  it('only considers missing components equal to missing components', () => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [0.5, 0.2, undefined],
      alpha: undefined,
    };

    expect(areColorsEquivalent(color, { ...color })).toBe(true);
    expect(areColorsEquivalent(color, {
      ...color,
      components: [0.5, 0.2, 0],
    })).toBe(false);
    expect(areColorsEquivalent(color, {
      ...color,
      alpha: 0,
    })).toBe(false);
  });

  it.each([
    ['hsl', [120, 0, 50], [undefined, 0, 50]],
    ['hwb', [120, 40, 60], [undefined, 40, 60]],
    ['lch', [50, 0, 120], [50, 0, undefined]],
    ['oklch', [0.5, 0, 120], [0.5, 0, undefined]],
  ] as const)(
    'converts powerless %s components to missing before comparison',
    (space, components, expectedComponents) => {
      const color: AbsoluteColor = {
        kind: ColorKind.Absolute,
        space,
        components: [...components],
        alpha: 1,
      };

      expect(areColorsEquivalent(color, {
        ...color,
        components: [...expectedComponents],
      })).toBe(true);
    },
  );

  it.each([
    ['hsl', [120, 0.001, 50], [undefined, 0.001, 50]],
    ['hwb', [120, 49.999, 50], [undefined, 49.999, 50]],
    ['lch', [50, 0.0015, 120], [50, 0.0015, undefined]],
    ['oklch', [0.5, 0.000004, 120], [0.5, 0.000004, undefined]],
  ] as const)(
    'does not apply the %s conversion epsilon during comparison',
    (space, components, expectedComponents) => {
      const color: AbsoluteColor = {
        kind: ColorKind.Absolute,
        space,
        components: [...components],
        alpha: 1,
      };

      expect(areColorsEquivalent(color, {
        ...color,
        components: [...expectedComponents],
      })).toBe(false);
    },
  );

  it('retains a manually specified HSL hue at the conversion epsilon', () => {
    const gray: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'hsl',
      components: [120, 0.001, 50],
      alpha: 1,
    };

    const result = interpolateColors(
      gray,
      { ...gray, components: [240, 100, 50] },
      0.5,
      'hsl',
    );

    expectComponentsCloseTo(result.components, [180, 50.0005, 50], 12);
  });

  it('retains a manually specified HWB hue at the conversion epsilon', () => {
    const gray: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'hwb',
      components: [120, 49.999, 50],
      alpha: 1,
    };

    const result = interpolateColors(
      gray,
      { ...gray, components: [240, 0, 0] },
      0.5,
      'hwb',
    );

    expectComponentsCloseTo(result.components, [180, 24.9995, 25], 12);
  });

  it('retains a manually specified LCH hue at the conversion epsilon', () => {
    const gray: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'lch',
      components: [50, 0.0015, 120],
      alpha: 1,
    };

    const result = interpolateColors(
      gray,
      { ...gray, components: [70, 40, 240] },
      0.5,
      'lch',
    );

    expectComponentsCloseTo(result.components, [60, 20.00075, 180], 12);
  });

  it('retains a manually specified OKLCH hue at the conversion epsilon', () => {
    const gray: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [0.5, 0.000004, 120],
      alpha: 1,
    };

    const result = interpolateColors(
      gray,
      { ...gray, components: [0.7, 0.2, 240] },
      0.5,
      'oklch',
    );

    expectComponentsCloseTo(result.components, [0.6, 0.100002, 180], 12);
  });

  it('compares colors from different spaces in Oklab', () => {
    const srgb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0.8, 0.2, 0.4],
      alpha: 0.6,
    };

    expect(areColorsEquivalent(
      srgb,
      convertAbsoluteColor(srgb, 'display-p3'),
    )).toBe(true);
    expect(areColorsEquivalent(
      srgb,
      {
        ...convertAbsoluteColor(srgb, 'display-p3'),
        alpha: 0.7,
      },
    )).toBe(false);
  });

  it('rejects different-space colors with missing components', () => {
    const missing: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [undefined, 0.2, 0.4],
      alpha: 1,
    };

    expect(areColorsEquivalent(missing, {
      ...missing,
      space: 'display-p3',
    })).toBe(false);
  });

  it('compares legacy and 8-bit sRGB colors as sRGB', () => {
    const legacy: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: [255, 128, 0],
      alpha: 128,
      is8Bit: true,
    };

    expect(areColorsEquivalent(legacy, {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [1, 128 / 255, 0],
      alpha: 128 / 255,
    })).toBe(true);
  });

  it('carries an analogous missing component into the interpolation space', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [undefined, 0.2, 0.4],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'xyz-d65',
        components: [0.8, 0.3, 0.2],
        alpha: 1,
      },
      0.5,
      'xyz-d65',
    );

    expect(result.space).toBe('xyz-d65');
    expect(result.components[0]).toBe(0.8);
  });

  it('carries a wholly missing analogous set into the interpolation space', () => {
    const expected: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0.7, 0.1, -0.1],
      alpha: 0.6,
    };
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [undefined, undefined, undefined],
        alpha: 0.4,
      },
      {
        ...expected,
        alpha: 0.8,
      },
      0.5,
      'oklab',
    );

    expectColorCloseTo(result, expected);
  });

  it('keeps a component missing when both analogous sets are missing', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [undefined, undefined, undefined],
        alpha: 0.4,
      },
      {
        kind: ColorKind.Absolute,
        space: 'display-p3',
        components: [undefined, undefined, undefined],
        alpha: 0.8,
      },
      0.5,
      'oklab',
    );

    expect(result).toMatchObject({
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [undefined, undefined, undefined],
    });
    expect(result.alpha).toBeCloseTo(0.6, 12);
  });

  it('uses the other color value for a missing alpha component', () => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0.5, 0.1, -0.1],
      alpha: 0.6,
    };

    expect(interpolateColors(
      { ...color, alpha: undefined },
      color,
      0.5,
      'oklab',
    )).toEqual(color);
  });

  it('converts an uncarried missing component as zero', () => {
    const source: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [undefined, 0.2, 0.4],
      alpha: 1,
    };
    const expected = convertAbsoluteColor({
      ...source,
      components: [0, 0.2, 0.4],
    }, 'oklab');
    const result = interpolateColors(
      source,
      {
        kind: ColorKind.Absolute,
        space: 'oklab',
        components: [0.8, 0.1, 0.1],
        alpha: 1,
      },
      0,
      'oklab',
    );

    expectColorCloseTo(result, expected);
  });

  // Section 13.3, "Interpolating with Alpha."
  it('matches the premultiplied sRGB interpolation example', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [0.24, 0.12, 0.98],
        alpha: 0.4,
      },
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [0.62, 0.26, 0.64],
        alpha: 0.6,
      },
      0.5,
      'srgb',
    );

    expect(result.alpha).toBeCloseTo(0.5, 12);
    expectComponentsCloseTo(result.components, [0.468, 0.204, 0.776], 12);
  });

  it('matches the premultiplied Lab interpolation example', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'lab',
        components: [66.927, 4.873, 68.622],
        alpha: 0.4,
      },
      {
        kind: ColorKind.Absolute,
        space: 'lab',
        components: [53.503, 82.672, -33.901],
        alpha: 0.6,
      },
      0.5,
      'lab',
    );

    expect(result.alpha).toBeCloseTo(0.5, 12);
    expectComponentsCloseTo(result.components, [58.873, 51.552, 7.108], 3);
  });

  it('matches the premultiplied LCH interpolation example', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'lch',
        components: [66.93, 68.79, 85.94],
        alpha: 0.4,
      },
      {
        kind: ColorKind.Absolute,
        space: 'lch',
        components: [53.5, 89.35, 337.7],
        alpha: 0.6,
      },
      0.5,
      'lch',
    );

    expect(result.alpha).toBeCloseTo(0.5, 12);
    expect(result.components[0]).toBeCloseTo(58.873, 2);
    expect(result.components[1]).toBeCloseTo(81.126, 3);
    expect(result.components[2]).toBeCloseTo(31.82, 12);
  });

  it('does not premultiply when alpha is missing', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'oklab',
        components: [0.2, 0.1, -0.1],
        alpha: undefined,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklab',
        components: [0.6, 0.3, 0.1],
        alpha: undefined,
      },
      0.5,
      'oklab',
    );

    expect(result).toEqual({
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0.4, 0.2, 0],
      alpha: undefined,
    });
  });

  it('does not unpremultiply a zero-alpha result', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'oklab',
        components: [0.2, 0.1, -0.1],
        alpha: 0,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklab',
        components: [0.6, 0.3, 0.1],
        alpha: 0,
      },
      0.5,
      'oklab',
    );

    expect(result).toEqual({
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0, 0, 0],
      alpha: 0,
    });
  });

  // Section 13.4, "Hue Interpolation."
  it.each([
    ['LCH', 'lch', [100, 0, 40], [100, 0, 60], [100, 0, 50]],
    ['OKLCH', 'oklch', [1, 0, 40], [1, 0, 60], [1, 0, 50]],
  ] as const)(
    'matches the same-space zero-chroma %s WPT',
    (_, space, a, b, expected) => {
      const result = interpolateColors(
        {
          kind: ColorKind.Absolute,
          space,
          components: [...a],
          alpha: 1,
        },
        {
          kind: ColorKind.Absolute,
          space,
          components: [...b],
          alpha: 1,
        },
        0.5,
        space,
      );

      expect(result.components).toEqual(expected);
    },
  );

  it.each([
    ['shorter', [0.6, 0.24, 30], [0.8, 0.15, 90], [0.7, 0.195, 60]],
    ['longer', [0.6, 0.24, 30], [0.8, 0.15, 90], [0.7, 0.195, 240]],
    ['increasing', [0.5, 0.1, 30], [0.7, 0.1, 190], [0.6, 0.1, 110]],
    ['decreasing', [0.5, 0.1, 30], [0.7, 0.1, 190], [0.6, 0.1, 290]],
  ] as const)(
    'matches the %s hue interpolation example',
    (method, a, b, expected) => {
      const result = interpolateColors(
        {
          kind: ColorKind.Absolute,
          space: 'oklch',
          components: [...a],
          alpha: 1,
        },
        {
          kind: ColorKind.Absolute,
          space: 'oklch',
          components: [...b],
          alpha: 1,
        },
        0.5,
        'oklch',
        method,
      );

      expect(result.alpha).toBe(1);

      expectComponentsCloseTo(result.components, expected, 12);
    },
  );

  it('takes a full circle for longer interpolation between equal hues', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.4, 0.1, 30],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.8, 0.1, 30],
        alpha: 1,
      },
      0.5,
      'oklch',
      'longer',
    );

    expect(result.components[2]).toBe(210);
  });

  it('borrows the other hue when one hue is missing', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.2, 0.1, undefined],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.8, 0.4, 180],
        alpha: 1,
      },
      0.5,
      'oklch',
    );

    expect(result.components).toEqual([0.5, 0.25, 180]);
  });

  it('keeps the hue missing when both hues are missing', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.2, 0.1, undefined],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.8, 0.4, undefined],
        alpha: 1,
      },
      0.5,
      'oklch',
    );

    expect(result.components).toEqual([0.5, 0.25, undefined]);
  });

  it.each([
    ['hsl', [350, 100, 50], [10, 100, 50], [0, 100, 50]],
    ['hwb', [350, 20, 30], [10, 20, 30], [0, 20, 30]],
  ] as const)('uses the first component as the %s hue', (space, a, b, expected) => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space,
        components: [...a],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space,
        components: [...b],
        alpha: 1,
      },
      0.5,
      space,
    );

    expect(result.components).toEqual(expected);
  });

  it('defaults two legacy colors to sRGB interpolation', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        components: [0.2, 0.4, 0.6],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        components: [0.8, 0.6, 0.4],
        alpha: 1,
      },
      0.5,
    );

    expect(result).toEqual({
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0.5, 0.5, 0.5],
      alpha: 1,
    });
  });

  it('defaults to Oklab when either color is not legacy', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        components: [0, 0, 0],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [1, 1, 1],
        alpha: 1,
      },
      0.5,
    );

    expect(result.space).toBe('oklab');
    expectComponentsCloseTo(result.components, [0.5, 0, 0], 7);
  });

  it('takes an individual missing component from the other color', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [0.5, 0, 0],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [undefined, 0.5, 0.5],
        alpha: 1,
      },
      0.5,
      'srgb',
    );

    expect(result.components).toEqual([0.5, 0.25, 0.25]);
  });

  it('carries the Lab opponent set into LCH', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'lab',
        components: [50, undefined, undefined],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'lch',
        components: [70, undefined, undefined],
        alpha: 1,
      },
      0.5,
      'lch',
    );

    expect(result.components).toEqual([60, undefined, undefined]);
  });

  it('treats a hue that becomes powerless during conversion as missing', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb-legacy',
        components: [0, 0, 0],
        alpha: 0,
      },
      {
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [0.8, 0.2, 120],
        alpha: 1,
      },
      0.5,
      'oklch',
    );

    expect(result.alpha).toBe(0.5);
    expectComponentsCloseTo(result.components, [0.8, 0.2], 7);
    expect(result.components[2]).toBe(120);
  });

  it('does not clip out-of-range values during interpolation', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [-1, 2, 3],
        alpha: 1,
      },
      {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [3, 4, -1],
        alpha: 1,
      },
      0.5,
      'srgb',
    );

    expect(result.components).toEqual([1, 3, 1]);
  });

  // testing/web-platform/tests/css/css-color/gamut-mapping
  const binarySearchGamutMappingReferences = [
    [[0.99, 0.8, 29.2], [1, 0.963, 0.947]],
    [[0.99, 0.8, 142], [0.9031, 1, 0.8868]],
    [[0.99, 0.8, 264], [0.9538, 0.9889, 1]],
    [[0.99, 0.8, 195], [0.8409, 1, 1]],
    [[0.99, 0.8, 328], [1, 0.9567, 1]],
    [[0.99, 0.8, 110], [1, 1, 0.3386]],
  ] as const satisfies readonly (readonly [
    oklch: ColorVector3,
    srgb: ColorVector3,
  ])[];

  it.each(binarySearchGamutMappingReferences)(
    'matches the WPT binary-search gamut mapping reference %j',
    (oklch, srgb) => {
      const mapped = gamutMapAbsoluteColor({
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [...oklch],
        alpha: 1,
      }, 'srgb');

      expect(mapped.space).toBe('srgb');
      expectColorCloseTo(mapped, {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [...srgb],
        alpha: 1,
      });
    },
  );

  it('returns the clipped color below the just-noticeable difference', () => {
    const mapped = gamutMapAbsoluteColor({
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [0.7, 0.2, 30],
      alpha: 0.5,
    }, 'srgb');

    expectColorCloseTo(mapped, {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [1, 0.38019885544225046, 0.3010433350997795],
      alpha: 0.5,
    });
  });

  it('maps out-of-range OKLCH lightness to black or white', () => {
    const cases = [
      [[0, 1.1, 60], [0, 0, 0]],
      [[-0.1, 1.1, 60], [0, 0, 0]],
      [[1, 110, 60], [1, 1, 1]],
      [[1.1, 110, 60], [1, 1, 1]],
    ] as const satisfies readonly (readonly [
      oklch: ColorVector3,
      srgb: ColorVector3,
    ])[];

    for (const [oklch, srgb] of cases) {
      const mapped = gamutMapAbsoluteColor({
        kind: ColorKind.Absolute,
        space: 'oklch',
        components: [...oklch],
        alpha: 0.4,
      }, 'srgb');

      expectColorCloseTo(mapped, {
        kind: ColorKind.Absolute,
        space: 'srgb',
        components: [...srgb],
        alpha: 0.4,
      });
    }
  });

  it('leaves in-gamut colors colorimetrically unchanged', () => {
    const origin: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: [0.2, 0.4, 0.6],
      alpha: 0.35,
    };
    const mapped = gamutMapAbsoluteColor(origin, 'srgb');

    expect(mapped.space).toBe('srgb');
    expectColorCloseTo(mapped, origin);
  });

  it('converts without mapping when the destination has no gamut limits', () => {
    const origin: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [0.7, 0.8, 40],
      alpha: 0.6,
    };

    expect(gamutMapAbsoluteColor(origin, 'xyz-d65'))
      .toEqual(convertAbsoluteColor(origin, 'xyz-d65'));
  });

  it('returns an in-gamut color in the requested RGB destination', () => {
    const mapped = gamutMapAbsoluteColor({
      kind: ColorKind.Absolute,
      space: 'oklch',
      components: [0.7, 0.8, 40],
      alpha: 0.25,
    }, 'display-p3');

    expect(mapped.space).toBe('display-p3');
    expect(mapped.alpha).toBe(0.25);

    for (const component of mapped.components) {
      expect(component).toBeGreaterThanOrEqual(0);
      expect(component).toBeLessThanOrEqual(1);
    }
  });

  it('keeps equivalent color names equivalent', () => {
    expect(ColorRgba.aqua).toBe(ColorRgba.cyan);
    expect(ColorRgba.fuchsia).toBe(ColorRgba.magenta);
    expect(ColorRgba.gray).toBe(ColorRgba.grey);
    expect(ColorRgba.darkgray).toBe(ColorRgba.darkgrey);
    expect(ColorRgba.slategray).toBe(ColorRgba.slategrey);
  });
});
