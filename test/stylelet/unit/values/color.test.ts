import { describe, expect, it } from 'vitest';
import { ValueStage } from '../../../../src/stylelet/value-processing';
import {
  ColorKind, ColorRgba, SPACES, areColorsEquivalent, convertAbsoluteColor,
  defineColorProfile, deltaE2000, deltaEOK,
  gamutMapColor, interpolateColors, isLegacySrgbColor,
  parseColorInterpolationMethod, parseColorValue, resolveColorValue,
  serializeColorInterpolationMethod, serializeColorValue,
  tryResolveAbsoluteColor,
  type AbsoluteColor,
  type PredefinedAbsoluteColor, type SystemColorName,
} from '../../../../src/stylelet/values/color';

type ColorVector3 = readonly [number, number, number];
type ColorVector4 = readonly [number, number, number, number];
type ColorVector = ColorVector3 | ColorVector4;

function promotedVariable(name: string) {
  return {
    type: 'math' as const,
    calculation: {
      type: 'variable' as const,
      name,
    },
    valueType: 'number' as const,
    promoted: true,
  };
}

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

function resolveComputedAbsoluteColor(input: string): AbsoluteColor {
  const color = tryResolveAbsoluteColor(
    parseColorValue(input)!,
    ValueStage.Computed,
  );

  if (color === null) {
    throw new TypeError('Expected an absolute computed color');
  }

  return color;
}

function testColorProfile() {
  const inputs: number[][] = [];
  const profile = defineColorProfile({
    space: '--four-channel',
    components: ['r', 'g', 'b', 'spot'],
    toAbsoluteColor: (components) => {
      inputs.push([...components]);

      return {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [components[0], components[1], components[2]],
        alpha: 1,
        isLegacySrgb: false,
      };
    },
    fromAbsoluteColor: (color) => {
      const [red = 0, green = 0, blue = 0] =
        convertAbsoluteColor(color, 'srgb').components;

      return [red, green, blue, 0.25];
    },
  });

  return { inputs, profile };
}

function swappedSrgbProfile() {
  return defineColorProfile({
    space: '--foo',
    components: ['r', 'g', 'b'],
    toAbsoluteColor: ([r, g, b]) => ({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [g, r, b],
      alpha: 1,
      isLegacySrgb: false,
    }),
    fromAbsoluteColor: (color) => {
      const [red = 0, green = 0, blue = 0] =
        convertAbsoluteColor(color, 'srgb').components;

      return [green, red, blue];
    },
  });
}

describe('color values', () => {
  it.each([
    ['red', true],
    ['#f00', true],
    ['rgb(255 0 0)', true],
    ['hsl(0 100% 50%)', true],
    ['hwb(0 0% 0%)', true],
    ['color(srgb 1 0 0)', false],
    ['rgb(from red r g b)', false],
    ['lab(50 0 0)', false],
  ] as const)('classifies %s for legacy sRGB interpolation', (input, expected) => {
    expect(isLegacySrgbColor(parseColorValue(input)!)).toBe(expected);
  });

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
      expect(resolveColorValue(color, ValueStage.Specified)).toBe(color);
      expect(resolveColorValue(color, ValueStage.Computed)).toEqual({
        kind: ColorKind.System,
        name: systemName,
      });
    },
  );

  it('resolves deprecated colors through the modern system color', () => {
    const absolute: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.1, 0.2, 0.3],
      alpha: 1,
      isLegacySrgb: false,
    };

    expect(resolveColorValue(parseColorValue('ActiveCaption')!, ValueStage.Computed, {
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

    expect(resolveColorValue(transparent, ValueStage.Specified))
      .toBe(transparent);
    expect(resolveColorValue(transparent, ValueStage.Computed)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 0, 0],
      alpha: 0,
      isLegacySrgb: true,
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
        space: SPACES.srgb,
        components,
        alpha,
        isLegacySrgb: true,
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

  it.each([
    ['abc', '#abc'],
    ['ABC', '#abc'],
    ['123', '#000123'],
    ['023', '#000023'],
    ['1ab', '#0001ab'],
    ['+12345a', '#12345a'],
    ['\\31 23', '#123'],
    ['12\\33 ', '#000123'],
  ])('parses the quirky color %s as %s', (input, hex) => {
    expect(parseColorValue(input, {}, true)).toEqual(parseColorValue(hex));
  });

  it.each([
    'abc',
    '123',
    '1ab',
  ])('does not parse the quirky color %s unless enabled', (input) => {
    expect(parseColorValue(input)).toBeNull();
  });

  it.each([
    'a',
    'aaaa',
    '1234567',
    '-123',
    '1.0',
    '1e1',
    '12345g',
  ])('rejects the invalid quirky color %s', (input) => {
    expect(parseColorValue(input, {}, true)).toBeNull();
  });

  it('resolves named colors at computed-value time', () => {
    const red = parseColorValue('red')!;

    expect(resolveColorValue(red, ValueStage.Specified)).toBe(red);
    expect(resolveColorValue(red, ValueStage.Computed)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [255, 0, 0],
      alpha: 255,
      isLegacySrgb: true,
      is8Bit: true,
    });
  });

  it('resolves contextual colors when their dependencies are available', () => {
    const absolute: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.1, 0.2, 0.3],
      alpha: 1,
      isLegacySrgb: false,
    };
    const current = parseColorValue('currentcolor')!;
    const system = parseColorValue('CanvasText')!;
    const systemColors = new Map<SystemColorName, AbsoluteColor>([
      ['canvastext', absolute],
    ]);

    expect(resolveColorValue(current, ValueStage.Computed, {
      currentColor: absolute,
    })).toBe(current);
    expect(resolveColorValue(current, ValueStage.Used, {
      currentColor: absolute,
    })).toBe(absolute);
    expect(resolveColorValue(system, ValueStage.Specified, {
      systemColors,
    })).toBe(system);
    expect(resolveColorValue(system, ValueStage.Computed, {
      systemColors,
    })).toBe(absolute);
  });

  it('tries to resolve a color to its absolute form', () => {
    const absolute: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.1, 0.2, 0.3],
      alpha: 1,
      isLegacySrgb: false,
    };
    const current = parseColorValue('currentcolor')!;

    expect(tryResolveAbsoluteColor(
      current,
      ValueStage.Computed,
      { currentColor: absolute },
    )).toBeNull();
    expect(tryResolveAbsoluteColor(
      current,
      ValueStage.Used,
      { currentColor: absolute },
    )).toBe(absolute);
  });

  it('resolves legacy rgb and rgba functions to absolute sRGB', () => {
    expect(parseColorValue('rgb(255, 0, 127)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [255, 0, 127],
      alpha: 255,
      isLegacySrgb: true,
      is8Bit: true,
    });
    expect(parseColorValue('rgba(255, 0, 127, 0)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [255, 0, 127],
      alpha: 0,
      isLegacySrgb: true,
      is8Bit: true,
    });
    expect(parseColorValue('rgba(100%, 0%, 50%, 25%)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 0.5],
      alpha: 0.25,
      isLegacySrgb: true,
    });
  });

  it('resolves modern rgb and rgba functions to absolute sRGB', () => {
    expect(parseColorValue('rgb(255 20% none / 0.5)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0.2, undefined],
      alpha: 0.5,
      isLegacySrgb: true,
    });
    expect(parseColorValue('rgba(none 0 100% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [undefined, 0, 1],
      alpha: undefined,
      isLegacySrgb: true,
    });
  });

  it('parses relative rgb component keywords only after an origin color', () => {
    const color = parseColorValue('rgba(from red alpha g b / r)');

    expect(color).toMatchObject({
      kind: ColorKind.RgbFn,
      useLegacySyntax: false,
      origin: {
        kind: ColorKind.Named,
        name: 'red',
      },
      components: [
        promotedVariable('alpha'),
        promotedVariable('g'),
        promotedVariable('b'),
        promotedVariable('r'),
      ],
    });
    expect(serializeColorValue(color!))
      .toBe('rgb(from red alpha g b / r)');
    expect(parseColorValue('rgb(r g b)')).toBeNull();
    expect(parseColorValue('rgb(calc(r / 2) 0 0)')).toBeNull();
    expect(parseColorValue('rgb(from red h g b)')).toBeNull();
  });

  it('resolves relative rgb component keywords and math variables', () => {
    const color = parseColorValue(
      'rgb(from red calc(r / 2) g b / alpha)',
    )!;

    expect(color).toMatchObject({
      kind: ColorKind.RgbFn,
      components: [
        {
          type: 'math',
          valueType: 'number',
          promoted: false,
        },
        promotedVariable('g'),
        promotedVariable('b'),
        promotedVariable('alpha'),
      ],
    });
    expect(resolveColorValue(color, ValueStage.Computed)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(resolveComputedAbsoluteColor(
      'rgb(from rebeccapurple '
      + 'calc((r / 255) * 100%) '
      + 'calc((g / 255) * 100%) '
      + 'calc((b / 255) * 100%) / calc(alpha * 100%))',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.4, 0.2, 0.6],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('does not resolve relative colors before computed-value time', () => {
    const declared = parseColorValue(
      'rgb(from rgb(20%, 40%, 60%, 80%) r g b / alpha)',
    )!;

    expect(declared).toMatchObject({
      kind: ColorKind.RgbFn,
      origin: {
        kind: ColorKind.RgbFn,
      },
    });
    expect(serializeColorValue(declared))
      .toBe('rgb(from rgb(20% 40% 60% / 80%) r g b / alpha)');
    expect(resolveColorValue(declared, ValueStage.Computed)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.2, 0.4, 0.6],
      alpha: 0.8,
      isLegacySrgb: false,
    });
  });

  it('resolves an alpha function used as another relative color origin', () => {
    const declared = parseColorValue(
      'rgb(from alpha(from red / 0.5) r g b / alpha)',
    )!;

    expect(serializeColorValue(declared)).toBe(
      'rgb(from alpha(from red / 0.5) r g b / alpha)',
    );
    expect(resolveColorValue(declared, ValueStage.Computed)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
  });

  it('serializes origin functions without clamping or dropping explicit alpha', () => {
    expect(serializeColorValue(parseColorValue(
      'rgb(from rgba(300, -10, 20, 1) r g b)',
    )!)).toBe('rgb(from rgb(300 -10 20 / 1) r g b)');
    expect(serializeColorValue(parseColorValue(
      'hsl(from hsla(0.5turn, 120%, -20%, 100%) h s l / alpha)',
    )!)).toBe(
      'hsl(from hsl(180deg 120% -20% / 100%) h s l / alpha)',
    );
    expect(serializeColorValue(parseColorValue(
      'rgb(from color(xyz 120% -1 0 / 100%) r g b)',
    )!)).toBe(
      'rgb(from color(xyz-d65 120% -1 0 / 100%) r g b)',
    );
  });

  it('canonicalizes specified hue angles without coercing hue numbers', () => {
    const angles = parseColorValue(
      'hsl(from hsl(.5turn 120% -20%) .5turn s l)',
    );
    expect(angles).toHaveProperty(
      'origin.components.0',
      { type: 'angle', value: 180, unit: 'deg' },
    );
    expect(angles).toHaveProperty(
      'components.0',
      { type: 'angle', value: 180, unit: 'deg' },
    );

    const numbers = parseColorValue(
      'hsl(from hsl(.5 120% -20%) .5 s l)',
    );
    expect(numbers).toHaveProperty(
      'origin.components.0',
      { type: 'number', value: 0.5 },
    );
    expect(numbers).toHaveProperty(
      'components.0',
      { type: 'number', value: 0.5 },
    );
  });

  it('resolves unit alpha omission while preserving it on origin functions', () => {
    expect(parseColorValue('color(--custom 0 0 0 / 1)'))
      .toHaveProperty('components.3', undefined);
    expect(parseColorValue(
      'rgb(from color(--custom 0 0 0 / 1) r g b)',
    )).toHaveProperty(
      'origin.components.3',
      { type: 'number', value: 1 },
    );
  });

  it.each([
    [
      'hsl(from red .5turn s l / 100%)',
      'hsl(from red 180deg s l / 1)',
    ],
    [
      'rgb(from red r g b / 120%)',
      'rgb(from red r g b / 1)',
    ],
    [
      'rgb(from red r g b / -20%)',
      'rgb(from red r g b / 0)',
    ],
    [
      'rgb(from red r g b / 20%)',
      'rgb(from red r g b / 0.2)',
    ],
    [
      'alpha(from red / 50%)',
      'alpha(from red / 0.5)',
    ],
    [
      'rgb(from rebeccapurple 20% g b / alpha)',
      'rgb(from rebeccapurple 51 g b / alpha)',
    ],
    [
      'oklab(from red 50% 20% -20%)',
      'oklab(from red 0.5 0.08 -0.08)',
    ],
    [
      'rgb(from red calc(30%) g b)',
      'rgb(from red calc(76.5) g b)',
    ],
    [
      'alpha(from rgb(0 0 0 / 0.25) / 100%)',
      'alpha(from rgb(0 0 0 / 0.25) / 1)',
    ],
    [
      'alpha(from rgb(0 0 0 / 0.25))',
      'alpha(from rgb(0 0 0 / 0.25))',
    ],
    [
      'color(from color(xyz 7 -20.5 100) xyz x y z)',
      'color(from color(xyz-d65 7 -20.5 100) xyz-d65 x y z)',
    ],
  ] as const)(
    'serializes the declared relative color %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('resolves a relative currentcolor origin at used-value time', () => {
    const declared = parseColorValue(
      'rgb(from currentcolor g r b / alpha)',
    )!;
    const computed = resolveColorValue(declared, ValueStage.Computed);
    const currentColor = resolveComputedAbsoluteColor(
      'rgb(20% 40% 60% / 80%)',
    );

    expect(computed).toMatchObject({
      kind: ColorKind.RgbFn,
      origin: { kind: ColorKind.CurrentColor },
    });
    expect(resolveColorValue(computed, ValueStage.Used, {
      currentColor,
    })).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.4, 0.2, 0.6],
      alpha: 0.8,
      isLegacySrgb: false,
    });
  });

  it('preserves relative colors whose origin channels are unavailable', () => {
    const declared = parseColorValue(
      'rgb(from currentcolor 1 2 3)',
    )!;
    const currentColor: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: { name: '--origin', keys: ['x'] },
      components: [0.2],
      alpha: 0.4,
      isLegacySrgb: false,
    };
    const resolved = resolveColorValue(declared, ValueStage.Used, {
      currentColor,
    });

    expect(serializeColorValue(resolved)).toBe(
      'rgb(from color(--origin 0.2 / 0.4) 1 2 3 / 0.4)',
    );
  });

  it('does not rescale relative rgb keywords used in another position', () => {
    expect(resolveComputedAbsoluteColor(
      'rgb(from rgb(0 0 0 / 60%) alpha 153 153 / 0.9)',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.6 / 255, 0.6, 0.6],
      alpha: 0.9,
      isLegacySrgb: false,
    });
  });

  it('inherits and clamps relative rgb alpha without clamping channels', () => {
    expect(resolveComputedAbsoluteColor(
      'rgb(from rgb(20 30 40 / 70%) 300 -10 b)',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [300 / 255, -10 / 255, 40 / 255],
      alpha: 0.7,
      isLegacySrgb: false,
    });
    expect(resolveComputedAbsoluteColor(
      'rgb(from rgb(20 30 40 / 70%) r g b / calc(alpha * 2))',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [20 / 255, 30 / 255, 40 / 255],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('carries missing relative rgb components and calculates with them as zero', () => {
    expect(resolveComputedAbsoluteColor(
      'rgb(from rgb(none 0 0 / none) r calc(r + 1) b)',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [undefined, 1 / 255, 0],
      alpha: undefined,
      isLegacySrgb: false,
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
      'rgb(calc(255 * (50% + (10% * sign(1em - 10px))) / 100%) 0 0 / 0.5)',
    ],
    [
      'rgb(0%, 0%, 0%, calc(50% + (sign(1em - 10px) * 10%)))',
      'rgb(0 0 0 / calc((50% + (10% * sign(1em - 10px))) / 100%))',
    ],
  ] as const)(
    'serializes the deferred legacy RGB calculation %s in modern syntax',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('stores deferred legacy RGB in its serializable modern form', () => {
    expect(parseColorValue(
      'rgb(calc(50% + (sign(1em - 10px) * 10%)), 0%, 0%, 50%)',
    )).toMatchObject({
      kind: ColorKind.RgbFn,
      useLegacySyntax: false,
      components: [
        { type: 'math', valueType: 'number' },
        { type: 'number', value: 0 },
        { type: 'number', value: 0 },
        { type: 'number', value: 0.5 },
      ],
    });
  });

  it('clamps independent RGB components while preserving deferred math', () => {
    const color = parseColorValue(
      'rgb(128 300 calc(sign(1em - 10px)))',
    )!;

    expect(serializeColorValue(color))
      .toBe('rgb(128 255 sign(1em - 10px))');
  });

  it('resolves color calculations as their value stage permits', () => {
    const input = 'rgb(calc(255 / 2) calc(50%) 0)';

    expect(parseColorValue(input)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0.5, 0],
      alpha: 1,
      isLegacySrgb: true,
    });

    const deferred = parseColorValue(input, {
      unwrapMathAt: ValueStage.Computed,
    })!;

    expect(deferred).toMatchObject({
      kind: ColorKind.RgbFn,
    });
    expect(resolveColorValue(deferred, ValueStage.Declared, {
      unwrapMathAt: ValueStage.Declared,
    })).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0.5, 0],
      alpha: 1,
      isLegacySrgb: true,
    });

    const declared = parseColorValue(
      'rgb(calc(255 / 2) 0 0 / calc(.25 + .25))',
    )!;

    expect(declared).toMatchObject({
      kind: ColorKind.RgbFn,
      useLegacySyntax: false,
    });
    expect(resolveColorValue(declared, ValueStage.Declared, {
      unwrapMathAt: ValueStage.Declared,
    })).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0, 0],
      alpha: 0.5,
      isLegacySrgb: true,
    });
    expect(resolveColorValue(declared, ValueStage.Computed)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0, 0],
      alpha: 0.5,
      isLegacySrgb: true,
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

    expect(hsl).toMatchObject({
      space: SPACES.srgb,
      isLegacySrgb: true,
    });
    expectColorCloseTo(hsl, [1, 0.647, 0, 1]);
  });

  it.each([
    'srgb',
    'srgb-linear',
  ] as const)(
    'does not apply legacy sRGB clamping to color(%s)',
    (space) => {
      expect(parseColorValue(`color(${space} -0.25 1.5 0.75)`)).toEqual({
        kind: ColorKind.Absolute,
        space: SPACES[space],
        components: [-0.25, 1.5, 0.75],
        alpha: 1,
        isLegacySrgb: false,
      });
    },
  );

  it('parses legacy and modern device CMYK syntax', () => {
    expect(parseColorValue('device-cmyk(0, .81, .81, .25)'))
      .toMatchObject({
        kind: ColorKind.DeviceCmykFn,
        useLegacySyntax: true,
        components: [
          { type: 'number', value: 0 },
          { type: 'number', value: 0.81 },
          { type: 'number', value: 0.81 },
          { type: 'number', value: 0.25 },
          undefined,
        ],
      });
    expect(parseColorValue(
      'device-cmyk(10% none 0.5 120% / 25%)',
    )).toMatchObject({
      kind: ColorKind.DeviceCmykFn,
      useLegacySyntax: false,
      components: [
        { type: 'percentage', value: 10 },
        'none',
        { type: 'number', value: 0.5 },
        { type: 'percentage', value: 120 },
        { type: 'number', value: 0.25 },
      ],
    });
  });

  it.each([
    'device-cmyk(0 0 0)',
    'device-cmyk(0 0 0 0 0)',
    'device-cmyk(0%, 0%, 0%, 0%)',
    'device-cmyk(0, 0, 0, 0 / 0.5)',
    'device-cmyk(0 0 0 0, 0.5)',
  ])('rejects invalid device CMYK syntax %s', (input) => {
    expect(parseColorValue(input)).toBeNull();
  });

  it('resolves and serializes device CMYK without implicit conversion', () => {
    const declared = parseColorValue(
      'device-cmyk(-0.2 25% none 1.2 / 50%)',
    )!;

    expect(serializeColorValue(declared))
      .toBe('device-cmyk(-0.2 25% none 1.2 / 0.5)');

    const computed = resolveColorValue(
      declared,
      ValueStage.Computed,
    );

    expect(computed).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: 'device-cmyk',
        keys: ['c', 'm', 'y', 'k'],
      },
      components: [0, 0.25, undefined, 1],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(serializeColorValue(computed))
      .toBe('device-cmyk(0 0.25 none 1 / 0.5)');
  });

  it('canonicalizes device CMYK percentages and defaults alpha to opaque', () => {
    const computed = resolveComputedAbsoluteColor(
      'device-cmyk(0% 70% 20% 0%)',
    );

    expect(computed).toMatchObject({
      kind: ColorKind.Absolute,
      space: {
        name: 'device-cmyk',
        keys: ['c', 'm', 'y', 'k'],
      },
      alpha: 1,
      isLegacySrgb: false,
    });
    expectComponentsCloseTo(computed.components, [0, 0.7, 0.2, 0], 12);
    expect(serializeColorValue(computed))
      .toBe('device-cmyk(0 0.7 0.2 0)');
  });

  it('uses naïve device CMYK conversion when no profile is available', () => {
    const cmyk = resolveComputedAbsoluteColor(
      'device-cmyk(0 0.81 0.81 0.3 / 0.5)',
    );
    const srgb = convertAbsoluteColor(cmyk, 'srgb');

    expect(srgb).toMatchObject({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expectComponentsCloseTo(srgb.components, [0.7, 0.133, 0.133], 12);
  });

  it('uses the device CMYK profile for an explicit target conversion', () => {
    const inputs: number[][] = [];
    const profile = defineColorProfile({
      space: 'device-cmyk',
      components: ['c', 'm', 'y', 'k'],
      toAbsoluteColor: (components) => {
        inputs.push([...components]);
        return {
          kind: ColorKind.Absolute,
          space: SPACES.srgb,
          components: [
            components[0],
            components[1],
            components[2],
          ],
          alpha: 1,
          isLegacySrgb: false,
        };
      },
      fromAbsoluteColor: () => null,
    });
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'device-cmyk(0.1 0.2 0.3 0.4 / 0.5)',
      context,
    )!;
    const native = resolveColorValue(
      declared,
      ValueStage.Computed,
      context,
    );

    expect(native).toMatchObject({
      kind: ColorKind.Absolute,
      space: {
        name: 'device-cmyk',
        keys: ['c', 'm', 'y', 'k'],
      },
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(inputs).toEqual([]);

    if (native.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected an absolute computed color');
    }

    const computed = convertAbsoluteColor(native, 'srgb', context);

    expect(computed).toMatchObject({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expectComponentsCloseTo(computed.components, [0.1, 0.2, 0.3], 12);
    expect(inputs).toHaveLength(1);
    expectComponentsCloseTo(inputs[0], [0.1, 0.2, 0.3, 0.4], 12);
  });

  it('parses and serializes the light-dark color production', () => {
    const color = parseColorValue('LiGhT-DaRk(black, white)');

    expect(color).toEqual({
      kind: ColorKind.LightDarkColor,
      light: {
        kind: ColorKind.Named,
        name: 'black',
      },
      dark: {
        kind: ColorKind.Named,
        name: 'white',
      },
    });
    expect(serializeColorValue(color!)).toBe('light-dark(black, white)');
  });

  it.each([
    'light-dark()',
    'light-dark(red)',
    'light-dark(red blue)',
    'light-dark(red,, blue)',
    'light-dark(red, blue, green)',
    'light-dark(red, url(dark.png))',
  ])('rejects invalid light-dark color syntax %s', (input) => {
    expect(parseColorValue(input)).toBeNull();
  });

  it.each([
    ['light', 'rgb(255, 255, 255)'],
    ['dark', 'rgb(0, 0, 0)'],
  ] as const)(
    'resolves the %s light-dark color at computed-value time',
    (colorScheme, serialized) => {
      const declared = parseColorValue('light-dark(white, black)')!;

      expect(resolveColorValue(
        declared,
        ValueStage.Declared,
        { colorScheme },
      )).toEqual(declared);
      expect(serializeColorValue(resolveColorValue(
        declared,
        ValueStage.Computed,
        { colorScheme },
      ))).toBe(serialized);
    },
  );

  it('preserves light-dark until color-scheme context is available', () => {
    const color = parseColorValue('light-dark(white, black)')!;

    expect(resolveColorValue(color, ValueStage.Computed)).toEqual(color);
    expect(serializeColorValue(color)).toBe('light-dark(white, black)');
  });

  it('resolves nested light-dark colors using the same color scheme', () => {
    const color = parseColorValue(
      'light-dark(light-dark(white, red), red)',
    )!;

    expect(serializeColorValue(resolveColorValue(
      color,
      ValueStage.Computed,
      { colorScheme: 'light' },
    ))).toBe('rgb(255, 255, 255)');
    expect(serializeColorValue(resolveColorValue(
      color,
      ValueStage.Computed,
      { colorScheme: 'dark' },
    ))).toBe('rgb(255, 0, 0)');
  });

  it('selects currentcolor without resolving it before the used stage', () => {
    const declared = parseColorValue(
      'light-dark(red, currentcolor)',
    )!;
    const computed = resolveColorValue(
      declared,
      ValueStage.Computed,
      { colorScheme: 'dark' },
    );

    expect(computed).toEqual({
      kind: ColorKind.CurrentColor,
    });

    const currentColor = resolveComputedAbsoluteColor('blue');

    expect(resolveColorValue(
      computed,
      ValueStage.Used,
      { colorScheme: 'dark', currentColor },
    )).toBe(currentColor);
  });

  it('parses and serializes the contrast color production', () => {
    const color = parseColorValue('CoNtRaSt-CoLoR(rebeccapurple)');

    expect(color).toEqual({
      kind: ColorKind.ContrastColorFn,
      color: {
        kind: ColorKind.Named,
        name: 'rebeccapurple',
      },
    });
    expect(serializeColorValue(color!))
      .toBe('contrast-color(rebeccapurple)');
  });

  it.each([
    'contrast-color()',
    'contrast-color(1)',
    'contrast-color(max)',
    'contrast-color(max white)',
    'contrast-color(white white)',
    'contrast-color(red blue)',
    'contrast-color(red, blue)',
    'contrast-color(red / 0.5)',
  ])('rejects invalid contrast color syntax %s', (input) => {
    expect(parseColorValue(input)).toBeNull();
  });

  it.each([
    ['white', 'rgb(0, 0, 0)'],
    ['aliceblue', 'rgb(0, 0, 0)'],
    ['mistyrose', 'rgb(0, 0, 0)'],
    ['lightyellow', 'rgb(0, 0, 0)'],
    ['palegreen', 'rgb(0, 0, 0)'],
    ['darkblue', 'rgb(255, 255, 255)'],
    ['maroon', 'rgb(255, 255, 255)'],
    ['purple', 'rgb(255, 255, 255)'],
    ['brown', 'rgb(255, 255, 255)'],
    ['black', 'rgb(255, 255, 255)'],
    ['rgb(255 255 255 / 0)', 'rgb(0, 0, 0)'],
    ['device-cmyk(1 1 1 1)', 'rgb(255, 255, 255)'],
  ])(
    'chooses the maximum WCAG 2.1 contrast for %s',
    (background, expected) => {
      const color = parseColorValue(`contrast-color(${background})`)!;

      expect(resolveColorValue(color, ValueStage.Declared)).toEqual(color);
      expect(serializeColorValue(resolveColorValue(
        color,
        ValueStage.Computed,
      ))).toBe(expected);
    },
  );

  it('chooses white when black and white have equal contrast', () => {
    const luminance = Math.sqrt(0.0525) - 0.05;
    const component = 1.055 * luminance ** (1 / 2.4) - 0.055;
    const color = parseColorValue(
      `contrast-color(color(srgb ${component} ${component} ${component}))`,
    )!;

    expect(serializeColorValue(resolveColorValue(
      color,
      ValueStage.Computed,
    ))).toBe('rgb(255, 255, 255)');
  });

  it('preserves contrast color until its input can be resolved', () => {
    const color = parseColorValue('contrast-color(currentcolor)')!;
    const computed = resolveColorValue(color, ValueStage.Computed);

    expect(computed).toEqual(color);
    expect(serializeColorValue(computed))
      .toBe('contrast-color(currentcolor)');

    const currentColor = resolveComputedAbsoluteColor('white');

    expect(serializeColorValue(resolveColorValue(
      computed,
      ValueStage.Used,
      { currentColor },
    ))).toBe('rgb(0, 0, 0)');
  });

  it('uses color profile context only when contrast resolution needs it', () => {
    const { profile } = testColorProfile();
    const color = parseColorValue(
      'contrast-color(color(--four-channel 1 1 1 0))',
    )!;

    expect(resolveColorValue(color, ValueStage.Computed))
      .toMatchObject({ kind: ColorKind.ContrastColorFn });
    expect(serializeColorValue(resolveColorValue(
      color,
      ValueStage.Computed,
      { colorProfiles: new Map([[profile.space, profile]]) },
    ))).toBe('rgb(0, 0, 0)');
  });

  it('parses and serializes custom color space parameters', () => {
    const color = parseColorValue(
      'color(--four-channel 0.125 0.25 0.5 0.75 / 0.5)',
    )!;

    expect(color).toMatchObject({
      kind: ColorKind.CustomColorFn,
      space: '--four-channel',
      components: [
        { type: 'number', value: 0.125 },
        { type: 'number', value: 0.25 },
        { type: 'number', value: 0.5 },
        { type: 'number', value: 0.75 },
        { type: 'number', value: 0.5 },
      ],
    });
    expect(serializeColorValue(color))
      .toBe('color(--four-channel 0.125 0.25 0.5 0.75 / 0.5)');
  });

  it('converts resolved custom-space colors through conversion context', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const custom = resolveColorValue(
      parseColorValue(
        'color(--four-channel 0.2 0.4 0.6 0.8 / 0.5)',
        context,
      )!,
      ValueStage.Computed,
      context,
    );

    expect(custom.kind).toBe(ColorKind.Absolute);
    expect(inputs).toEqual([]);

    if (custom.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected an absolute computed color');
    }

    const converted = convertAbsoluteColor(custom, 'srgb', context);

    expect(serializeColorValue(custom))
      .toBe('color(--four-channel 0.2 0.4 0.6 0.8 / 0.5)');
    expect(converted).toMatchObject({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expectComponentsCloseTo(converted.components, [0.2, 0.4, 0.6], 12);
    expect(inputs).toHaveLength(1);
    expectComponentsCloseTo(inputs[0], [0.2, 0.4, 0.6, 0.8], 12);
    expect(interpolateColors(
      custom,
      converted,
      0.5,
      'srgb',
      'shorter',
      context,
    )).toEqual(converted);
  });

  it('converts a resolved custom color to an explicit target', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'color(--four-channel 0.2 0.4 0.6 0.8 / 0.5)',
      context,
    )!;

    expect(resolveColorValue(
      declared,
      ValueStage.Declared,
      context,
    )).toEqual(declared);
    expect(inputs).toEqual([]);

    const computed = resolveColorValue(
      declared,
      ValueStage.Computed,
      context,
    );

    if (computed.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected an absolute computed color');
    }

    const resolved = convertAbsoluteColor(computed, 'srgb', context);

    expect(resolved).toMatchObject({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      alpha: 0.5,
      isLegacySrgb: false,
    });

    expectComponentsCloseTo(resolved.components, [0.2, 0.4, 0.6], 12);
    expect(inputs).toHaveLength(1);
    expectComponentsCloseTo(inputs[0], [0.2, 0.4, 0.6, 0.8], 12);
  });

  it('converts a resolved predefined color to an explicit target', () => {
    const declared = parseColorValue('color(display-p3 0.2 0.4 0.6)')!;
    const source = resolveColorValue(
      declared,
      ValueStage.Computed,
    );
    if (source.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected an absolute computed color');
    }

    const resolved = convertAbsoluteColor(source, 'srgb');

    expect(resolved).toMatchObject({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      alpha: 1,
      isLegacySrgb: false,
    });

    expect(resolved).toEqual(convertAbsoluteColor(source, 'srgb'));
  });

  it('converts missing custom-space components as zero', () => {
    const { inputs, profile } = testColorProfile();
    const space = {
      name: profile.space,
      keys: profile.components,
    };
    const custom: AbsoluteColor<typeof space> = {
      kind: ColorKind.Absolute,
      space,
      components: [undefined, 0.4, 0.6, 0.8],
      alpha: undefined,
      isLegacySrgb: false,
    };

    expect(convertAbsoluteColor(custom, 'srgb', {
      colorProfiles: new Map([[profile.space, profile]]),
    })).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 0.4, 0.6],
      alpha: undefined,
      isLegacySrgb: false,
    });
    expect(inputs).toEqual([[0, 0.4, 0.6, 0.8]]);
  });

  it('rejects custom-space conversion without its profile', () => {
    const space = {
      name: '--missing',
      keys: ['value'],
    } as const;
    const custom: AbsoluteColor<typeof space> = {
      kind: ColorKind.Absolute,
      space,
      components: [0.5],
      alpha: 1,
      isLegacySrgb: false,
    };

    expect(() => convertAbsoluteColor(custom, 'srgb'))
      .toThrow('Cannot convert color space --missing');
  });

  it('lowers a computed custom color without converting its space', () => {
    const profile = swappedSrgbProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'color(--foo 0.6 0 0)',
      context,
    )!;
    const color = resolveColorValue(declared, ValueStage.Computed, context);

    expect(color).toMatchObject({
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(color.kind).toBe(ColorKind.Absolute);

    if (color.kind === ColorKind.Absolute) {
      expectComponentsCloseTo(color.components, [0.6, 0, 0], 12);
    }

    expect(serializeColorValue(color)).toBe('color(--foo 0.6 0 0)');
  });

  it('does not implicitly convert custom colors at later stages', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'color(--four-channel 0.125 0.25 0.5 0.75 / 0.5)',
      context,
    )!;
    const expected = {
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      components: [0.125, 0.25, 0.5, 0.75],
      alpha: 0.5,
      isLegacySrgb: false,
    };

    expect(resolveColorValue(declared, ValueStage.Used, context))
      .toEqual(expected);
    expect(resolveColorValue(declared, ValueStage.Actual, context))
      .toEqual(expected);
    expect(inputs).toEqual([]);
  });

  it('clamps custom profile components at computed-value time', () => {
    const { inputs, profile } = testColorProfile();
    const profiles = new Map([[profile.space, profile]]);
    const declared = parseColorValue(
      'color(--four-channel -0.25 125% 0.5 2)',
    )!;

    expect(resolveColorValue(declared, ValueStage.Declared, {
      colorProfiles: profiles,
    })).toMatchObject({
      kind: ColorKind.CustomColorFn,
      components: [
        { type: 'number', value: -0.25 },
        { type: 'number', value: 1.25 },
        { type: 'number', value: 0.5 },
        { type: 'number', value: 2 },
        undefined,
      ],
    });
    expect(inputs).toEqual([]);

    const computed = resolveColorValue(declared, ValueStage.Computed, {
      colorProfiles: profiles,
    });

    expect(computed).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      components: [0, 1, 0.5, 1],
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(serializeColorValue(computed))
      .toBe('color(--four-channel 0 1 0.5 1)');
    expect(inputs).toEqual([]);
  });

  it('defaults missing and ignores excess custom profile components', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };

    const missing = resolveColorValue(
      parseColorValue(
        'color(--four-channel 0.125 0.25)',
        context,
      )!,
      ValueStage.Computed,
      context,
    );
    const excess = resolveColorValue(
      parseColorValue(
        'color(--four-channel 0.125 0.25 0.5 0.75 0.9)',
        context,
      )!,
      ValueStage.Computed,
      context,
    );

    expect(missing).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      components: [0.125, 0.25, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(excess).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      components: [0.125, 0.25, 0.5, 0.75],
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(inputs).toEqual([]);
  });

  it('distinguishes an explicit missing custom component from an omitted parameter', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'color(--four-channel none 0.25)',
      context,
    )!;
    const computed = resolveColorValue(
      declared,
      ValueStage.Computed,
      context,
    );

    expect(computed).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      components: [undefined, 0.25, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(serializeColorValue(computed))
      .toBe('color(--four-channel none 0.25 0 0)');
    expect(inputs).toEqual([]);
  });

  it('only exposes declared custom profile component keywords', () => {
    const { profile } = testColorProfile();
    const profiles = new Map([[profile.space, profile]]);

    expect(parseColorValue(
      'color(from red --four-channel r g b spot / alpha)',
      { colorProfiles: profiles },
    )).toBeNull();

    const alphaProfile = defineColorProfile({
      space: '--alpha-channel',
      components: ['alpha'],
      toAbsoluteColor: ([alpha]) => ({
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [alpha, 0, 0],
        alpha: 1,
        isLegacySrgb: false,
      }),
      fromAbsoluteColor: () => [0.25],
    });

    const context = {
      colorProfiles: new Map([[alphaProfile.space, alphaProfile]]),
    };
    const declared = parseColorValue(
      'color(from red --alpha-channel alpha)',
      context,
    )!;

    expect(resolveColorValue(declared, ValueStage.Computed, context)).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: alphaProfile.space,
        keys: alphaProfile.components,
      },
      components: [0.25],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('resolves relative custom color components through its profile', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'color(from rgb(25.5 51 76.5 / 0.4) --four-channel '
      + 'calc(r + 0.1) g b calc(spot * 2) / calc(r + 0.4))',
      context,
    )!;
    const color = resolveColorValue(declared, ValueStage.Computed, context);

    expect(color).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      components: [0.2, 0.2, 0.3, 0.5],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(serializeColorValue(color))
      .toBe('color(--four-channel 0.2 0.2 0.3 0.5 / 0.5)');
    expect(inputs).toEqual([]);
  });

  it('does not clamp relative custom profile components', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'color(from red --four-channel calc(r + 1) g b spot)',
      context,
    )!;
    const color = resolveColorValue(declared, ValueStage.Computed, context);

    expect(color).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: profile.space,
        keys: profile.components,
      },
      components: [2, 0, 0, 0.25],
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(inputs).toEqual([]);
  });

  it('preserves unresolved currentcolor in a relative custom color', () => {
    const { inputs, profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const declared = parseColorValue(
      'color(from currentcolor --four-channel 0.1 0.2 0.3 0.4 / 0.5)',
      context,
    )!;
    const computed = resolveColorValue(
      declared,
      ValueStage.Computed,
      context,
    );

    expect(computed).toMatchObject({
      kind: ColorKind.CustomColorFn,
      space: '--four-channel',
      origin: {
        kind: ColorKind.CurrentColor,
      },
    });
    expect(serializeColorValue(computed))
      .toBe('color(from currentcolor --four-channel 0.1 0.2 0.3 0.4 / 0.5)');
    expect(inputs).toEqual([]);
  });

  it.each([
    [
      'color(from color(display-p3 0.7 0.5 0.3 / 0.4) '
      + 'display-p3 calc(r + 0.01) calc(g + 0.01) calc(b + 0.01) '
      + '/ calc(alpha + 0.01))',
      SPACES['display-p3'],
      [0.71, 0.51, 0.31],
      0.41,
    ],
    [
      'color(from color(srgb 0.7 0.5 0.3 / 0.4) '
      + 'srgb b alpha r / g)',
      SPACES.srgb,
      [0.3, 0.4, 0.7],
      0.5,
    ],
    [
      'color(from color(xyz 7 -20.5 100 / 0.4) xyz x y z / alpha)',
      SPACES['xyz-d65'],
      [7, -20.5, 100],
      0.4,
    ],
  ] as const)(
    'resolves the relative color() WPT case %s',
    (input, space, components, alpha) => {
      const color = resolveColorValue(
        parseColorValue(input)!,
        ValueStage.Computed,
      );

      expect(color).toMatchObject({
        kind: ColorKind.Absolute,
        space,
        isLegacySrgb: false,
      });
      expectComponentsCloseTo(
        (color as AbsoluteColor).components,
        components,
        12,
      );
      expect((color as AbsoluteColor).alpha).toBeCloseTo(alpha, 12);
    },
  );

  it('serializes a deferred relative color() function', () => {
    const color = parseColorValue(
      'color(from currentColor display-p3 r g b / alpha)',
    )!;

    expect(color).toMatchObject({
      kind: ColorKind.ColorFn,
      space: 'display-p3',
      origin: {
        kind: ColorKind.CurrentColor,
      },
    });
    expect(serializeColorValue(color))
      .toBe('color(from currentcolor display-p3 r g b / alpha)');
  });

  it('scopes relative color() channel keywords to the selected profile', () => {
    expect(parseColorValue('color(srgb r g b)')).toBeNull();
    expect(parseColorValue(
      'color(from red srgb x g b)',
    )).toBeNull();
    expect(parseColorValue(
      'color(from red xyz r y z)',
    )).toBeNull();
  });

  it.each([
    [
      'lch(52.2345% 72.2 56.2 / 1)',
      'lch',
      [52.2345, 72.2, 56.2],
    ],
    [
      'oklch(42.1% 0.192 328.6 / 1)',
      'oklch',
      [0.421, 0.192, 328.6],
    ],
    [
      'color(display-p3 0.823 0.6554 0.2537 / 1)',
      'display-p3',
      [0.823, 0.6554, 0.2537],
    ],
    [
      'color(xyz 0.472 0.372 0.131)',
      'xyz-d65',
      [0.472, 0.372, 0.131],
    ],
  ] as const)(
    'matches the section 15 resolved color example %s',
    (input, space, components) => {
      const color = parseColorValue(input);

      expect(color).toMatchObject({
        kind: ColorKind.Absolute,
        space: SPACES[space],
        alpha: 1,
        isLegacySrgb: false,
      });

      if (color?.kind !== ColorKind.Absolute) {
        throw new TypeError('Expected an absolute color');
      }

      expectComponentsCloseTo(color.components, components, 12);
    },
  );

  it('clamps rgb components at parsed-value time', () => {
    expect(parseColorValue('rgb(300 -10 0 / 2)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 0],
      alpha: 1,
      isLegacySrgb: true,
    });
  });

  // Adapted from WPT css/css-color/parsing/color-computed-rgb.html.
  it.each([
    ['rgb(calc(infinity) 0 0)', true, { components: [1, 0, 0], alpha: 1 }],
    ['rgb(0 calc(-infinity) 0)', true, { components: [0, 0, 0], alpha: 1 }],
    ['rgb(0 0 calc(NaN))', true, { components: [0, 0, 0], alpha: 1 }],
    ['rgb(calc(0 / 0) 0 0)', true, { components: [0, 0, 0], alpha: 1 }],
    [
      'rgb(0 0 0 / calc(infinity))',
      true,
      { components: [0, 0, 0], alpha: 1 },
    ],
    [
      'rgb(0 0 0 / calc(-infinity))',
      true,
      { components: [0, 0, 0], alpha: 0 },
    ],
    [
      'rgb(0 0 0 / calc(NaN))',
      true,
      { components: [0, 0, 0], alpha: 0 },
    ],
  ] as const)(
    'clamps special calculations in the computed color %s',
    (input, isLegacySrgb, expected) => {
      const declared = parseColorValue(input)!;

      expect(resolveColorValue(declared, ValueStage.Computed)).toEqual({
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        ...expected,
        isLegacySrgb,
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
      const computed = resolveColorValue(declared, ValueStage.Computed);

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

      expect(resolveColorValue(declared, ValueStage.Computed)).toEqual({
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components,
        alpha,
        isLegacySrgb: true,
      });
    },
  );

  it('resolves legacy hsl and hsla functions to absolute sRGB', () => {
    expect(parseColorValue('hsl(120, 100%, 50%)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 1, 0],
      alpha: 1,
      isLegacySrgb: true,
    });
    expect(parseColorValue('hsla(0.5turn, 25%, 75%, 20%)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.6875, 0.8125, 0.8125],
      alpha: 0.2,
      isLegacySrgb: true,
    });
  });

  it('resolves modern HSL without missing components to absolute sRGB', () => {
    expect(parseColorValue('hsl(120deg 100% 50 / 0.5)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 1, 0],
      alpha: 0.5,
      isLegacySrgb: true,
    });
    expect(parseColorValue('hsla(none 0 100% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.hsl,
      components: [undefined, 0, 100],
      alpha: undefined,
      isLegacySrgb: false,
    });
  });

  it('parses relative HSL component keywords only after an origin color', () => {
    const color = parseColorValue('hsla(from red alpha s l / h)');

    expect(color).toMatchObject({
      kind: ColorKind.HslFn,
      useLegacySyntax: false,
      origin: {
        kind: ColorKind.Named,
        name: 'red',
      },
      components: [
        promotedVariable('alpha'),
        promotedVariable('s'),
        promotedVariable('l'),
        promotedVariable('h'),
      ],
    });
    expect(serializeColorValue(color!))
      .toBe('hsl(from red alpha s l / h)');
    expect(parseColorValue('hsl(h s l)')).toBeNull();
    expect(parseColorValue('hsl(calc(h + 180) 0 0)')).toBeNull();
    expect(parseColorValue('hsl(from red r s l)')).toBeNull();
  });

  it('resolves relative HSL component keywords and math variables', () => {
    const color = resolveComputedAbsoluteColor(
      'hsl(from hsl(30 40% 50% / 0.5) '
      + 'calc(h + 180) s l / calc(alpha * 2))',
    );

    expectColorCloseTo(color, [0.3, 0.5, 0.7, 1]);
  });

  it('carries missing relative HSL components and calculates with them as zero', () => {
    const color = resolveComputedAbsoluteColor(
      'hsl(from hsl(none 10% 50%) h calc(h + 20) l)',
    );

    expect(color).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.hsl,
      components: [undefined, 20, 50],
      alpha: 1,
      isLegacySrgb: false,
    });
    expect(serializeColorValue(color)).toBe('hsl(none 20% 50%)');
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
        space: SPACES.hsl,
        components,
        alpha,
        isLegacySrgb: false,
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
      'hsl(0 0 0 / calc((50% + (10% * sign(1em - 10px))) / 100%))',
    ],
  ] as const)(
    'serializes the deferred legacy HSL calculation %s in modern syntax',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('stores deferred HSL in its canonical serializable form', () => {
    expect(parseColorValue(
      'hsl(.5turn, calc(50% + (sign(1em - 10px) * 10%)), 25%, 50%)',
    )).toMatchObject({
      kind: ColorKind.HslFn,
      useLegacySyntax: false,
      components: [
        { type: 'number', value: 180 },
        { type: 'math', valueType: 'percentage' },
        { type: 'percentage', value: 25 },
        { type: 'number', value: 0.5 },
      ],
    });
  });

  it.each([
    'hsl(120 -10% 50%)',
    'hsl(120 -10 50)',
  ])('clamps negative hsl saturation at parsed-value time for %s', (input) => {
    expect(parseColorValue(input)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0.5, 0.5],
      alpha: 1,
      isLegacySrgb: true,
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
      space: SPACES.srgb,
      components: [0.2, 0.7, 0.2],
      alpha: 0.5,
      isLegacySrgb: true,
    });
    expect(parseColorValue('hwb(none 0 100% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.hwb,
      components: [undefined, 0, 100],
      alpha: undefined,
      isLegacySrgb: false,
    });
  });

  it('parses relative HWB component keywords only after an origin color', () => {
    const color = parseColorValue('hwb(from red alpha w b / h)');

    expect(color).toMatchObject({
      kind: ColorKind.HwbFn,
      origin: {
        kind: ColorKind.Named,
        name: 'red',
      },
      components: [
        promotedVariable('alpha'),
        promotedVariable('w'),
        promotedVariable('b'),
        promotedVariable('h'),
      ],
    });
    expect(serializeColorValue(color!))
      .toBe('hwb(from red alpha w b / h)');
    expect(parseColorValue('hwb(h w b)')).toBeNull();
    expect(parseColorValue('hwb(from red r w b)')).toBeNull();
  });

  it('resolves relative HWB component keywords and math variables', () => {
    const color = resolveComputedAbsoluteColor(
      'hwb(from hwb(30 20% 40% / 0.5) '
      + 'calc(h + 180) w b / calc(alpha * 2))',
    );

    expectColorCloseTo(color, [0.2, 0.4, 0.6, 1]);
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

  // Adapted from WPT css/css-color/parsing/color-valid-hwb.html.
  it.each([
    [
      'hwb(calc(110deg + (sign(1em - 10px) * 10deg)) 30% 50% / 50%)',
      'hwb(calc(110deg + (10deg * sign(1em - 10px))) 30% 50% / 0.5)',
    ],
    [
      'hwb(120deg 30% 50% / calc(50% + (sign(1em - 10px) * 10%)))',
      'hwb(120 30% 50% / calc((50% + (10% * sign(1em - 10px))) / 100%))',
    ],
  ] as const)(
    'serializes the deferred HWB calculation %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('stores deferred HWB percentage channels as percentages', () => {
    expect(parseColorValue(
      'hwb(calc(110deg + (sign(1em - 10px) * 10deg)) 30% 50% / 50%)',
    )).toMatchObject({
      kind: ColorKind.HwbFn,
      components: [
        { type: 'math', valueType: 'angle' },
        { type: 'percentage', value: 30 },
        { type: 'percentage', value: 50 },
        { type: 'number', value: 0.5 },
      ],
    });
  });

  it.each([
    ['hwb(45 40% 60%)', 0.4],
    ['hwb(45 40% 80%)', 1 / 3],
  ])('normalizes achromatic white and black in %s', (input, gray) => {
    expect(parseColorValue(input)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [gray, gray, gray],
      alpha: 1,
      isLegacySrgb: true,
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
      space: SPACES.srgb,
      alpha: 1,
      isLegacySrgb: true,
    });

    if (color?.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected an absolute color');
    }

    expectComponentsCloseTo(color.components, components, 12);
  });

  it('preserves missing HWB components outside interpolation', () => {
    expect(parseColorValue('hwb(none none 100%)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.hwb,
      components: [undefined, undefined, 100],
      alpha: 1,
      isLegacySrgb: false,
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
        space: SPACES.hwb,
        components,
        alpha,
        isLegacySrgb: false,
      });
    },
  );

  it('resolves lab and oklab functions to absolute colors', () => {
    expect(parseColorValue('lab(50% 20 -30% / 0.4)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.lab,
      components: [50, 20, -37.5],
      alpha: 0.4,
      isLegacySrgb: false,
    });
    expect(parseColorValue('oklab(none 0.1 -20% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [undefined, 0.1, -0.08],
      alpha: undefined,
      isLegacySrgb: false,
    });
  });

  it.each([
    ['lab', ColorKind.LabFn],
    ['oklab', ColorKind.OklabFn],
  ] as const)(
    'parses relative %s component keywords only after an origin color',
    (name, kind) => {
      const input = `${name}(from red alpha a b / l)`;
      const color = parseColorValue(input);

      expect(color).toMatchObject({
        kind,
        origin: {
          kind: ColorKind.Named,
          name: 'red',
        },
        components: [
          promotedVariable('alpha'),
          promotedVariable('a'),
          promotedVariable('b'),
          promotedVariable('l'),
        ],
      });
      expect(serializeColorValue(color!)).toBe(input);
      expect(parseColorValue(`${name}(l a b)`)).toBeNull();
      expect(parseColorValue(`${name}(from red r a b)`)).toBeNull();
    },
  );

  it.each([
    [
      'lab(from lab(50 20 -30 / 0.5) '
      + 'calc(l + 10) a calc(b * 2) / calc(alpha * 2))',
      'lab',
      [60, 20, -60],
    ],
    [
      'oklab(from oklab(0.5 0.1 -0.1 / 0.5) '
      + 'calc(l + 0.1) a calc(b * 2) / calc(alpha * 2))',
      'oklab',
      [0.6, 0.1, -0.2],
    ],
  ] as const)(
    'resolves relative Lab-family component keywords in %s',
    (input, space, components) => {
      expect(resolveComputedAbsoluteColor(input)).toEqual({
        kind: ColorKind.Absolute,
        space: SPACES[space],
        components,
        alpha: 1,
        isLegacySrgb: false,
      });
    },
  );

  it('resolves lch and oklch functions to absolute colors', () => {
    expect(parseColorValue('lch(50 40% 270deg / 25%)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.lch,
      components: [50, 60, 270],
      alpha: 0.25,
      isLegacySrgb: false,
    });
    expect(parseColorValue('oklch(none 0.2 none)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [undefined, 0.2, undefined],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it.each([
    ['lch', ColorKind.LchFn],
    ['oklch', ColorKind.OklchFn],
  ] as const)(
    'parses relative %s component keywords only after an origin color',
    (name, kind) => {
      const input = `${name}(from red alpha c h / l)`;
      const color = parseColorValue(input);

      expect(color).toMatchObject({
        kind,
        origin: {
          kind: ColorKind.Named,
          name: 'red',
        },
        components: [
          promotedVariable('alpha'),
          promotedVariable('c'),
          promotedVariable('h'),
          promotedVariable('l'),
        ],
      });
      expect(serializeColorValue(color!)).toBe(input);
      expect(parseColorValue(`${name}(l c h)`)).toBeNull();
      expect(parseColorValue(`${name}(from red l a h)`)).toBeNull();
    },
  );

  it.each([
    [
      'lch(from lch(50 30 40 / 0.5) '
      + 'calc(l * 0.8) c calc(h + 180) / calc(alpha * 2))',
      'lch',
      [40, 30, 220],
    ],
    [
      'oklch(from oklch(0.5 0.1 40 / 0.5) '
      + 'calc(l * 0.8) c calc(h + 180) / calc(alpha * 2))',
      'oklch',
      [0.4, 0.1, 220],
    ],
  ] as const)(
    'resolves relative polar Lab-family component keywords in %s',
    (input, space, components) => {
      expect(resolveComputedAbsoluteColor(input)).toEqual({
        kind: ColorKind.Absolute,
        space: SPACES[space],
        components,
        alpha: 1,
        isLegacySrgb: false,
      });
    },
  );

  it('carries missing relative LCH components and calculates with them as zero', () => {
    expect(resolveComputedAbsoluteColor(
      'lch(from lch(50 20 none / none) l calc(h + 10) h / alpha)',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.lch,
      components: [50, 10, undefined],
      alpha: undefined,
      isLegacySrgb: false,
    });
  });

  it('parses alpha functions and scopes the alpha component keyword', () => {
    const input = 'alpha(from currentcolor / alpha)';
    const color = parseColorValue(input);

    expect(color).toMatchObject({
      kind: ColorKind.AlphaFn,
      origin: {
        kind: ColorKind.CurrentColor,
      },
      components: [promotedVariable('alpha')],
    });
    expect(serializeColorValue(color!)).toBe(input);
    expect(parseColorValue('alpha()')).toBeNull();
    expect(parseColorValue('alpha(red / 0.5)')).toBeNull();
    expect(parseColorValue('alpha(from red 0.5)')).toBeNull();
    expect(parseColorValue('alpha(from red / r)')).toBeNull();
  });

  it('replaces, inherits, and removes alpha without changing color components', () => {
    expect(resolveComputedAbsoluteColor(
      'alpha(from oklch(0.5 0.1 40 / 0.8) / calc(alpha * 0.5))',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [0.5, 0.1, 40],
      alpha: 0.4,
      isLegacySrgb: false,
    });
    expect(resolveComputedAbsoluteColor(
      'alpha(from lab(50 20 -30 / 0.3))',
    )).toEqual(resolveComputedAbsoluteColor(
      'lab(50 20 -30 / 0.3)',
    ));
    expect(resolveComputedAbsoluteColor(
      'alpha(from color(display-p3 1 0 0) / none)',
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES['display-p3'],
      components: [1, 0, 0],
      alpha: undefined,
      isLegacySrgb: false,
    });
  });

  it('clamps alpha and uses the origin color processing space', () => {
    expect(serializeColorValue(resolveComputedAbsoluteColor(
      'alpha(from red)',
    ))).toBe('color(srgb 1 0 0)');
    expect(resolveComputedAbsoluteColor('alpha(from red / 2)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    });
    const translucent = resolveComputedAbsoluteColor('alpha(from red / 0.5)');

    expect(translucent).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(serializeColorValue(translucent))
      .toBe('color(srgb 1 0 0 / 0.5)');
    expect(resolveComputedAbsoluteColor('alpha(from red / -1)'))
      .toEqual({ ...translucent, alpha: 0 });
    expect(serializeColorValue(resolveComputedAbsoluteColor(
      'alpha(from hsl(120 20% 50%) / 0.5)',
    ))).toBe('color(srgb 0.4 0.6 0.4 / 0.5)');
    expect(serializeColorValue(resolveComputedAbsoluteColor(
      'alpha(from hsl(none 20% 50%) / 0.5)',
    ))).toBe('hsl(none 20% 50% / 0.5)');
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
        space: SPACES[space],
        components,
        alpha,
        isLegacySrgb: false,
      });
    },
  );

  it.each([
    [
      'lab(200 calc(sign(1em - 10px)) 0)',
      'lab(100 sign(1em - 10px) 0)',
    ],
    [
      'oklab(-2 calc(sign(1em - 10px)) 0)',
      'oklab(0 sign(1em - 10px) 0)',
    ],
    [
      'lch(calc(sign(1em - 10px)) -20 -20deg)',
      'lch(sign(1em - 10px) 0 340)',
    ],
    [
      'oklch(calc(sign(1em - 10px)) -0.2 740deg)',
      'oklch(sign(1em - 10px) 0 20)',
    ],
  ])(
    'resolves independent Lab-family components while preserving math in %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
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
        ValueStage.Computed,
      )).toEqual({
        kind: ColorKind.Absolute,
        space: SPACES[space],
        components,
        alpha,
        isLegacySrgb: false,
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
    ] as const;

    for (const space of spaces) {
      expect(parseColorValue(`color(${space} 0 0 0)`)).toMatchObject({
        kind: ColorKind.Absolute,
        space: SPACES[space === 'xyz' ? 'xyz-d65' : space],
        isLegacySrgb: false,
      });
    }

    expect(parseColorValue('color(DISPLAY-P3 0 0 0)')).toMatchObject({
      space: SPACES['display-p3'],
    });
  });

  it('canonicalizes xyz while retaining deferred components', () => {
    const color = parseColorValue(
      'color(xyz calc(sign(1em - 1px)) 0 0)',
    )!;

    expect(color).toMatchObject({
      kind: ColorKind.ColorFn,
      space: 'xyz-d65',
    });
    expect(serializeColorValue(color))
      .toBe('color(xyz-d65 sign(1em - 1px) 0 0)');
  });

  it('resolves color function components and alpha', () => {
    expect(parseColorValue('color(display-p3 1 50% none / 25%)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES['display-p3'],
      components: [1, 0.5, undefined],
      alpha: 0.25,
      isLegacySrgb: false,
    });

    expect(parseColorValue('color(xyz-d50 none 0.5 120% / none)')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES['xyz-d50'],
      components: [undefined, 0.5, 1.2],
      alpha: undefined,
      isLegacySrgb: false,
    });
  });

  it('retains out-of-range color function components', () => {
    expect(parseColorValue('color(prophoto-rgb -0.2 1.4 120% / 2)'))
      .toEqual({
        kind: ColorKind.Absolute,
        space: SPACES['prophoto-rgb'],
        components: [-0.2, 1.4, 1.2],
        alpha: 1,
        isLegacySrgb: false,
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

  it('parses color-mix() with its optional interpolation method', () => {
    expect(parseColorValue('color-mix(red)')).toMatchObject({
      kind: ColorKind.ColorMixFn,
      items: [
        { color: { kind: ColorKind.Named, name: 'red' } },
      ],
    });

    expect(parseColorValue('color-mix(red, blue)')).toEqual({
      kind: ColorKind.ColorMixFn,
      method: undefined,
      items: [
        {
          color: { kind: ColorKind.Named, name: 'red' },
          percentage: undefined,
        },
        {
          color: { kind: ColorKind.Named, name: 'blue' },
          percentage: undefined,
        },
      ],
    });

    expect(parseColorValue(
      'color-mix(in lch longer hue, red 25%, 75% blue, green)',
    )).toEqual({
      kind: ColorKind.ColorMixFn,
      method: { space: 'lch', hue: 'longer' },
      items: [
        {
          color: { kind: ColorKind.Named, name: 'red' },
          percentage: { type: 'percentage', value: 25 },
        },
        {
          color: { kind: ColorKind.Named, name: 'blue' },
          percentage: { type: 'percentage', value: 75 },
        },
        {
          color: { kind: ColorKind.Named, name: 'green' },
          percentage: { type: 'percentage', value: 0 },
        },
      ],
    });

    expect(parseColorValue('color-mix(red calc(50%), blue)')).not.toBeNull();
  });

  it.each([
    [
      'color-mix(in oklab, teal, peru 40%)',
      undefined,
      [60, 40],
    ],
    [
      'color-mix(in oklab, teal 50%, peru 50%)',
      undefined,
      [undefined, undefined],
    ],
    [
      'color-mix(in oklab, teal 70%, peru 70%)',
      undefined,
      [70, 70],
    ],
    [
      'color-mix(in oklch shorter hue, red, green, blue)',
      { space: 'oklch' },
      [undefined, undefined, undefined],
    ],
    [
      'color-mix(red 70%, green 70%, blue)',
      undefined,
      [70, 70, 0],
    ],
  ])(
    'stores the canonical declared mix %s',
    (input, method, percentages) => {
      const value = parseColorValue(input);

      expect(value?.kind).toBe(ColorKind.ColorMixFn);
      if (value?.kind !== ColorKind.ColorMixFn) {
        throw new TypeError('Expected a color mix');
      }
      expect(value.method).toEqual(method);
      expect(value.items.map(({ percentage }) =>
        percentage === undefined || percentage.type === 'math'
          ? undefined
          : percentage.value
      )).toEqual(percentages);
    },
  );

  it('parses nested color-mix() values', () => {
    expect(parseColorValue('color-mix(red, color-mix(blue, green))'))
      .toMatchObject({
        kind: ColorKind.ColorMixFn,
        items: [
          { color: { kind: ColorKind.Named, name: 'red' } },
          {
            color: {
              kind: ColorKind.ColorMixFn,
              items: [
                { color: { kind: ColorKind.Named, name: 'blue' } },
                { color: { kind: ColorKind.Named, name: 'green' } },
              ],
            },
          },
        ],
      });
  });

  it.each([
    [
      'color-mix(in oklab, teal, peru 40%)',
      'color-mix(teal 60%, peru 40%)',
    ],
    [
      'color-mix(in oklab, teal 50%, peru 50%)',
      'color-mix(teal, peru)',
    ],
    [
      'color-mix(in oklab, teal 70%, peru 70%)',
      'color-mix(teal 70%, peru 70%)',
    ],
    [
      'color-mix(in oklch longer hue, red, green, blue)',
      'color-mix(in oklch longer hue, red, green, blue)',
    ],
    [
      'color-mix(red 50%, green, blue)',
      'color-mix(red 50%, green 25%, blue 25%)',
    ],
    [
      'color-mix(in oklch shorter hue, red, blue)',
      'color-mix(in oklch, red, blue)',
    ],
    [
      'color-mix(red calc(50%), green, blue)',
      'color-mix(red calc(50%), green, blue)',
    ],
    [
      'color-mix(currentcolor, #fff)',
      'color-mix(currentcolor, rgb(255, 255, 255))',
    ],
  ])('serializes the declared color mix %s', (input, expected) => {
    expect(serializeColorValue(parseColorValue(input)!)).toBe(expected);
  });

  it.each([
    'color-mix()',
    'color-mix(in srgb)',
    'color-mix(in srgb,)',
    'color-mix(red blue)',
    'color-mix(red -1%, blue)',
    'color-mix(red 101%, blue)',
    'color-mix(red 20% 30%, blue)',
  ])('rejects the invalid color mix %s', (input) => {
    expect(parseColorValue(input)).toBeNull();
  });

  it('calculates color-mix() at computed-value time', () => {
    const declared = parseColorValue('color-mix(in srgb, red, blue)')!;

    expect(declared).toMatchObject({
      kind: ColorKind.ColorMixFn,
    });
    expect(resolveColorValue(declared, ValueStage.Computed)).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0, 0.5],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('serializes computed HSL and HWB mixes in sRGB unless missing', () => {
    const hsl = resolveComputedAbsoluteColor(
      'color-mix(in hsl, red, blue)',
    );
    const hwb = resolveComputedAbsoluteColor(
      'color-mix(in hwb, red, blue)',
    );
    const missing = resolveComputedAbsoluteColor(
      'color-mix(in hsl, hsl(none 50% 50%), hsl(none 50% 50%))',
    );

    expect(hsl.space).toBe(SPACES.srgb);
    expect(hwb.space).toBe(SPACES.srgb);
    expect(missing.space).toBe(SPACES.hsl);
    expect(serializeColorValue(hsl)).toMatch(/^color\(srgb /);
    expect(serializeColorValue(hwb)).toMatch(/^color\(srgb /);
    expect(serializeColorValue(missing)).toBe('hsl(none 50% 50%)');
  });

  it('produces different results in different mixing color spaces', () => {
    const lch = convertAbsoluteColor(resolveComputedAbsoluteColor(
      'color-mix(in lch, white, black)',
    ), 'lch');
    const xyz = convertAbsoluteColor(resolveComputedAbsoluteColor(
      'color-mix(in xyz, white, black)',
    ), 'lch');
    const srgb = convertAbsoluteColor(resolveComputedAbsoluteColor(
      'color-mix(in srgb, white, black)',
    ), 'lch');

    expect(lch.components[0]).toBeCloseTo(50, 8);
    expect(xyz.components[0]).toBeCloseTo(76, 0);
    expect(srgb.components[0]).toBeCloseTo(53.4, 1);
  });

  it('mixes weighted colors in XYZ', () => {
    const computed = resolveComputedAbsoluteColor(
      'color-mix(in xyz, rgb(82.02% 30.21% 35.02%) 75.23%,'
      + ' rgb(5.64% 55.94% 85.31%))',
    );
    const rendered = convertAbsoluteColor(computed, 'srgb');

    expect(computed.space.name).toBe('xyz-d65');
    expectComponentsCloseTo(
      rendered.components,
      [0.723, 0.38639, 0.53557],
      3,
    );
  });

  it.each([
    ['lch', [64.7841, 65.6008, 301.364]],
    ['oklch', [0.72601, 0.15661, 264.052]],
    ['srgb', [0.5, 0.5, 1]],
  ] as const)(
    'mixes white and blue in %s',
    (space, components) => {
      const computed = resolveComputedAbsoluteColor(
        `color-mix(in ${space}, white, blue)`,
      );

      expect(computed.space.name).toBe(space);
      expectComponentsCloseTo(computed.components, components, 3);
    },
  );

  it('preserves an out-of-gamut HSL mix when converting it to sRGB', () => {
    const computed = resolveComputedAbsoluteColor(
      'color-mix(in hsl, color(display-p3 0 1 0) 80%, yellow)',
    );

    expect(computed.space.name).toBe('srgb');
    expect(computed.components.some(
      (component) =>
        component !== undefined && (component < 0 || component > 1),
    )).toBe(true);
  });

  it.each([
    [
      'color-mix(in srgb, rgb(100% 0 0 / .7) 25%,'
      + ' rgb(0 100% 0 / .2))',
      0.325,
    ],
    [
      'color-mix(in srgb, rgb(100% 0 0 / .7) 20%,'
      + ' rgb(0 100% 0 / .2) 60%)',
      0.26,
    ],
  ])('premultiplies non-unity alpha in %s', (input, alpha) => {
    const computed = resolveComputedAbsoluteColor(input);

    expectComponentsCloseTo(
      computed.components,
      [0.5384615384615384, 0.46153846153846156, 0],
      12,
    );
    expect(computed.alpha).toBeCloseTo(alpha, 12);
  });

  it('mixes any number of colors in order', () => {
    const computed = resolveColorValue(parseColorValue(
      'color-mix('
      + 'oklab(.3 .1 .1),'
      + 'oklab(.6 .2 .2),'
      + 'oklab(.9 .3 .3))',
    )!, ValueStage.Computed);

    expect(computed.kind).toBe(ColorKind.Absolute);

    if (computed.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected a calculated color mix');
    }

    expect(computed.space.name).toBe('oklab');
    expectComponentsCloseTo(computed.components, [0.6, 0.2, 0.2], 12);
    expect(computed.alpha).toBe(1);
  });

  it('converts a sole mix item and applies its alpha multiplier', () => {
    const computed = resolveColorValue(parseColorValue(
      'color-mix(in oklab, red 30%)',
    )!, ValueStage.Computed);

    expect(computed).toMatchObject({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      isLegacySrgb: false,
    });

    if (computed.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected a calculated color mix');
    }

    expect(computed.alpha).toBeCloseTo(0.3, 12);
  });

  it('carries missing components through color-mix()', () => {
    const computed = resolveColorValue(parseColorValue(
      'color-mix(in srgb, rgb(none 0 0), rgb(100% 100% 0))',
    )!, ValueStage.Computed);

    expect(computed).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0.5, 0],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('resolves other color-mix() items while preserving currentcolor', () => {
    const declared = parseColorValue(
      'color-mix(in srgb, currentcolor, blue)',
    )!;
    const computed = resolveColorValue(declared, ValueStage.Computed);

    expect(computed).toMatchObject({
      kind: ColorKind.ColorMixFn,
      items: [
        { color: { kind: ColorKind.CurrentColor } },
        { color: { kind: ColorKind.Absolute, space: SPACES.srgb } },
      ],
    });
    expect(serializeColorValue(computed))
      .toBe('color-mix(in srgb, currentcolor, rgb(0, 0, 255))');

    const currentColor = resolveColorValue(
      parseColorValue('red')!,
      ValueStage.Computed,
    );

    if (currentColor.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected an absolute current color');
    }

    expect(resolveColorValue(computed, ValueStage.Used, {
      currentColor,
    })).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0, 0.5],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('completes mix percentages after resolving calculated percentages', () => {
    const computed = resolveColorValue(parseColorValue(
      'color-mix(in srgb, currentcolor calc(25%), blue)',
    )!, ValueStage.Computed);

    expect(serializeColorValue(computed)).toBe(
      'color-mix('
      + 'in srgb, currentcolor 25%, rgb(0, 0, 255) 75%)',
    );
  });

  it('resolves other colors in nested color-mix() around currentcolor', () => {
    const declared = parseColorValue(
      'color-mix(in srgb, '
      + 'color-mix(in srgb, currentcolor, red), white)',
    )!;
    const computed = resolveColorValue(declared, ValueStage.Computed);
    const currentColor = resolveComputedAbsoluteColor('blue');

    expect(computed.kind).toBe(ColorKind.ColorMixFn);
    if (computed.kind !== ColorKind.ColorMixFn) {
      throw new TypeError('Expected a deferred outer color mix');
    }
    const inner = computed.items[0].color;
    expect(inner.kind).toBe(ColorKind.ColorMixFn);
    if (inner.kind !== ColorKind.ColorMixFn) {
      throw new TypeError('Expected a deferred inner color mix');
    }
    expect(inner.items[0].color).toEqual({
      kind: ColorKind.CurrentColor,
    });
    expect(serializeColorValue(computed)).toBe(
      'color-mix(in srgb, '
      + 'color-mix(in srgb, currentcolor, rgb(255, 0, 0)), '
      + 'rgb(255, 255, 255))',
    );
    expect(resolveColorValue(computed, ValueStage.Used, {
      currentColor,
    })).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.75, 0.5, 0.75],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('preserves color-mix() while a percentage remains deferred', () => {
    const computed = resolveColorValue(parseColorValue(
      'color-mix(red calc(50% + sign(1em - 1px) * 10%), blue)',
    )!, ValueStage.Computed);

    expect(computed).toMatchObject({
      kind: ColorKind.ColorMixFn,
      items: [
        { percentage: { type: 'math', valueType: 'percentage' } },
        { percentage: undefined },
      ],
    });
  });

  it('clamps calculated mix percentages before normalization', () => {
    const computed = resolveColorValue(parseColorValue(
      'color-mix(in srgb, red calc(200%), blue 100%)',
    )!, ValueStage.Computed);

    expect(computed).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0, 0.5],
      alpha: 1,
      isLegacySrgb: false,
    });
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

  it('omits the default shorter hue interpolation method when serializing', () => {
    expect(serializeColorInterpolationMethod({ space: 'oklch', hue: 'shorter' }))
      .toBe('in oklch');
  });

  it('parses color interpolation methods case-insensitively', () => {
    expect(parseColorInterpolationMethod('IN OkLcH LoNgEr HuE')).toEqual({
      space: 'oklch',
      hue: 'longer',
    });
  });

  it('parses a declared custom color interpolation space', () => {
    const { profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };

    expect(parseColorInterpolationMethod('in --four-channel', context))
      .toEqual({ space: '--four-channel' });
    expect(parseColorInterpolationMethod('in --four-channel'))
      .toBeNull();
    expect(parseColorInterpolationMethod(
      'in --four-channel longer hue',
      context,
    )).toBeNull();
  });

  it.each([
    '', 'in', 'srgb', 'in unknown', 'in srgb shorter hue',
    'in oklch shorter', 'in oklch hue', 'in oklch shorter hue extra',
    'in srgb-legacy',
  ])('rejects the invalid color interpolation method %j', (input) => {
    expect(parseColorInterpolationMethod(input)).toBeNull();
  });

  it('interpolates every component in a custom color space', () => {
    const { profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const color = parseColorValue(
      'color-mix(in --four-channel, red 25%, blue 75%)',
      context,
    )!;
    const result = resolveColorValue(color, ValueStage.Computed, context);

    expect(result).toEqual({
      kind: ColorKind.Absolute,
      space: {
        name: '--four-channel',
        keys: ['r', 'g', 'b', 'spot'],
      },
      components: [0.25, 0, 0.75, 0.25],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('premultiplies custom color components by alpha', () => {
    const { profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const color = parseColorValue(
      'color-mix(in --four-channel, ' +
      'color(--four-channel 1 0 0 0 / 0.5), ' +
      'color(--four-channel 0 0 1 1))',
      context,
    )!;
    const result = resolveColorValue(color, ValueStage.Computed, context);

    expect(result.kind).toBe(ColorKind.Absolute);
    if (result.kind !== ColorKind.Absolute) {
      throw new TypeError('Expected a calculated custom color mix');
    }
    expectComponentsCloseTo(
      result.components,
      [1 / 3, 0, 2 / 3, 2 / 3],
      12,
    );
    expect(result.alpha).toBeCloseTo(0.75, 12);
  });

  it('carries missing components in a custom interpolation space', () => {
    const { profile } = testColorProfile();
    const context = {
      colorProfiles: new Map([[profile.space, profile]]),
    };
    const color = parseColorValue(
      'color-mix(in --four-channel, ' +
      'color(--four-channel none 0 0 0), ' +
      'color(--four-channel 1 0 0 0))',
      context,
    )!;
    const result = resolveColorValue(color, ValueStage.Computed, context);

    expect(result).toMatchObject({
      kind: ColorKind.Absolute,
      components: [1, 0, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    });
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
    ['rgba(255, 0, 255, 0)', 'rgba(255, 0, 255, 0)'],
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

  it('preserves percentage RGB encoding while alpha is deferred', () => {
    const declared = parseColorValue(
      'rgb(100% 0% 100% / calc(infinity))',
    )!;
    const computed = resolveColorValue(declared, ValueStage.Computed);

    expect(computed).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 1],
      alpha: 1,
      isLegacySrgb: true,
    });
    expect(serializeColorValue(computed, true))
      .toBe('rgb(255, 0, 255)');
  });

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
      const color = resolveColorValue(
        parseColorValue(input)!,
        ValueStage.Computed,
      );

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
      const color = resolveColorValue(
        parseColorValue(input)!,
        ValueStage.Computed,
      );

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
      const color = resolveColorValue(
        parseColorValue(input)!,
        ValueStage.Computed,
      );

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
      const color = resolveColorValue(
        parseColorValue(input)!,
        ValueStage.Computed,
      );

      expect(serializeColorValue(color)).toBe(serialized);
    },
  );

  // Section 16.6 serialization of currentcolor.
  it('serializes computed currentcolor in ASCII lowercase', () => {
    const color = resolveColorValue(
      parseColorValue('currentColor')!,
      ValueStage.Computed,
    );

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

  it.each([
    [
      'lch(calc(sign(1em - 1px)) 40% 270deg)',
      'lch(sign(1em - 1px) 60 270)',
    ],
    [
      'oklch(calc(sign(1em - 1px)) 20% 270deg)',
      'oklch(sign(1em - 1px) 0.08 270)',
    ],
  ] as const)(
    'canonicalizes resolved components around deferred math in %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('uses the value stage to serialize reducible calc color components', () => {
    const declared = parseColorValue(
      'color(display-p3 calc(.1 + .2) 0 0 / calc(.25 + .25))',
    )!;
    const computed = resolveColorValue(declared, ValueStage.Computed);

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
    'resolves calculated alpha in the declared color %s',
    (input, declared) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(declared);
    },
  );

  it.each(calculatedAlphaSerializationCases)(
    'clamps calculated alpha in the computed color %s',
    (input, _declared, computed) => {
      expect(serializeColorValue(
        resolveColorValue(parseColorValue(input)!, ValueStage.Computed),
      )).toBe(computed);
    },
  );

  it.each([
    ['calc(2 * 60%)', 'number'],
    ['calc(60% * sign(1em - 1px))', 'number'],
  ] as const)(
    'resolves calculated alpha %s as %s math',
    (alpha, valueType) => {
      const color = parseColorValue(
        `color(display-p3 0 1 0 / ${alpha})`,
      );

      expect(color).toMatchObject({
        kind: ColorKind.ColorFn,
        components: [
          { type: 'number', value: 0 },
          { type: 'number', value: 1 },
          { type: 'number', value: 0 },
          { type: 'math', valueType },
        ],
      });
    },
  );

  it.each([
    [
      'rgb(calc(sign(1em - 1px)) 0 0 / 120%)',
      'rgb(sign(1em - 1px) 0 0)',
    ],
    [
      'color(display-p3 calc(sign(1em - 1px)) 0 0 / -0.2)',
      'color(display-p3 sign(1em - 1px) 0 0 / 0)',
    ],
  ] as const)(
    'clamps literal alpha while preserving deferred components in %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it.each([
    [
      'rgb(calc(sign(1em - 1px)) 0 0 / calc(1.2))',
      'rgb(sign(1em - 1px) 0 0)',
    ],
    [
      'color(display-p3 calc(sign(1em - 1px)) 0 0 / calc(-0.2))',
      'color(display-p3 sign(1em - 1px) 0 0 / 0)',
    ],
  ] as const)(
    'clamps calculated alpha while preserving computed deferred components in %s',
    (input, serialized) => {
      const computed = resolveColorValue(
        parseColorValue(input)!,
        ValueStage.Computed,
      );

      expect(serializeColorValue(computed)).toBe(serialized);
    },
  );

  it('canonicalizes unresolved calculated percentage alpha as number math', () => {
    const color = parseColorValue(
      'color(display-p3 0 1 0 / calc(60% * sign(1em - 1px)))',
    )!;

    expect(serializeColorValue(color)).toBe(
      'color(display-p3 0 1 0 / calc(60% * sign(1em - 1px) / 100%))',
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
    expect(serializeColorValue(resolveColorValue(
      parseColorValue('goldenrod')!,
      ValueStage.Computed,
    ))).toBe('rgb(218, 165, 32)');
    expect(serializeColorValue(resolveColorValue(
      parseColorValue('transparent')!,
      ValueStage.Computed,
    ))).toBe('rgba(0, 0, 0, 0)');
  });

  it('serializes absolute sRGB colors in legacy rgb form', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0.5, 0],
      alpha: 1,
      isLegacySrgb: true,
    })).toBe('rgb(255, 127.5, 0)');
    expect(serializeColorValue(
      parseColorValue('rgb(306 -25.5 0 / 0.5)')!,
    )).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('preserves missing absolute sRGB components through color()', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [undefined, 0.5, 0],
      alpha: undefined,
      isLegacySrgb: true,
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

  // Section 16.2.2 requires HSL and HWB components to remain percentages
  // when missing components select their modern functional serialization.
  it.each([
    [
      'hsl(calc(50deg + (sign(1em - 10px) * 10deg)) none 50%)',
      'hsl(calc(50deg + (10deg * sign(1em - 10px))) none 50%)',
    ],
    [
      'hwb(calc(110deg + (sign(1em - 10px) * 10deg)) none 50%)',
      'hwb(calc(110deg + (10deg * sign(1em - 10px))) none 50%)',
    ],
    [
      'hsl(calc(50deg + (sign(1em - 10px) * 10deg)) none 50)',
      'hsl(calc(50deg + (10deg * sign(1em - 10px))) none 50%)',
    ],
    [
      'hwb(calc(110deg + (sign(1em - 10px) * 10deg)) none 50)',
      'hwb(calc(110deg + (10deg * sign(1em - 10px))) none 50%)',
    ],
  ] as const)(
    'preserves percentage serialization with a missing component in %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('retains RGB while its alpha is deferred', () => {
    expect(resolveColorValue(
      parseColorValue('rgb(none 0 0)')!,
      ValueStage.Declared,
    )).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [undefined, 0, 0],
      alpha: 1,
      isLegacySrgb: true,
    });

    expect(resolveColorValue(
      parseColorValue(
        'rgb(none 0 0 / calc(60% * sign(1em - 1px)))',
      )!,
      ValueStage.Declared,
    )).toMatchObject({
      kind: ColorKind.RgbFn,
      useLegacySyntax: false,
      components: [
        'none',
        { type: 'number', value: 0 },
        { type: 'number', value: 0 },
        {
          type: 'math',
          valueType: 'number',
        },
      ],
    });
  });

  it.each([
    [
      'rgb(0 0 0 / calc(60% * sign(1em - 1px)))',
      'rgb(0 0 0 / calc(60% * sign(1em - 1px) / 100%))',
    ],
    [
      'rgb(none 0 0 / calc(60% * sign(1em - 1px)))',
      'rgb(none 0 0 / calc(60% * sign(1em - 1px) / 100%))',
    ],
    [
      'rgb(none 0 0 / 0.5)',
      'color(srgb none 0 0 / 0.5)',
    ],
  ] as const)(
    'retains deferred RGB and lowers resolved missing RGB for %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it.each([
    [
      'rgb(50% 0% 0% / calc(60% * sign(1em - 1px)))',
      'rgb(127.5 0 0 / calc(60% * sign(1em - 1px) / 100%))',
    ],
    [
      'rgb(calc(sign(1em - 1px)) 0 0'
      + ' / calc(60% * sign(1em - 1px)))',
      'rgb(sign(1em - 1px) 0 0'
      + ' / calc(60% * sign(1em - 1px) / 100%))',
    ],
    [
      'rgb(calc(sign(1em - 1px)) none 0'
      + ' / calc(60% * sign(1em - 1px)))',
      'rgb(sign(1em - 1px) none 0'
      + ' / calc(60% * sign(1em - 1px) / 100%))',
    ],
    [
      'rgb(calc(sign(1em - 1px)) 0 0 / none)',
      'rgb(sign(1em - 1px) 0 0 / none)',
    ],
  ] as const)(
    'canonicalizes resolved RGB components without lowering deferred %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it.each([
    [
      'rgb(50% 0% 0% / none)',
      'color(srgb 0.5 0 0 / none)',
    ],
    [
      'rgb(none 50% 0 / none)',
      'color(srgb none 0.5 0 / none)',
    ],
  ] as const)(
    'lowers fully resolved missing RGB to color(srgb) for %s',
    (input, serialized) => {
      expect(serializeColorValue(parseColorValue(input)!)).toBe(serialized);
    },
  );

  it('keeps color(srgb) distinct from rgb()', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    })).toBe('color(srgb 1 0 0)');
  });

  it('clamps and rounds numerical alpha values', () => {
    expect(serializeColorValue(
      parseColorValue('color(display-p3 1 0 0 / 2)')!,
    )).toBe('color(display-p3 1 0 0)');
    expect(serializeColorValue(
      parseColorValue('color(display-p3 1 0 0 / 0.123456789)')!,
    )).toBe('color(display-p3 1 0 0 / 0.123457)');

    const nan = resolveColorValue(
      parseColorValue('color(display-p3 1 0 0 / calc(NaN))')!,
      ValueStage.Computed,
    );

    expect(serializeColorValue(nan)).toBe('color(display-p3 1 0 0 / 0)');
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
      space: SPACES.hsl,
      components: [20, undefined, 30],
      alpha: undefined,
      isLegacySrgb: false,
    })).toBe('hsl(20 none 30% / none)');
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: SPACES.hwb,
      components: [20, undefined, 30],
      alpha: 1,
      isLegacySrgb: false,
    })).toBe('hwb(20 none 30%)');
  });

  it('serializes absolute HSL and HWB colors without converting their spaces', () => {
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: SPACES.hsl,
      components: [20, 40, 30],
      alpha: 1,
      isLegacySrgb: false,
    })).toBe('hsl(20 40% 30%)');
    expect(serializeColorValue({
      kind: ColorKind.Absolute,
      space: SPACES.hwb,
      components: [20, 40, 30],
      alpha: 1,
      isLegacySrgb: false,
    })).toBe('hwb(20 40% 30%)');
  });

  it('serializes absolute wide-gamut colors in their notation', () => {
    const cases: [AbsoluteColor, string][] = [
      [{
        kind: ColorKind.Absolute,
        space: SPACES.lab,
        components: [56.2, 0, 83.6],
        alpha: 1,
        isLegacySrgb: false,
      }, 'lab(56.2 0 83.6)'],
      [{
        kind: ColorKind.Absolute,
        space: SPACES.lch,
        components: [56.2, 83.6, 357.4],
        alpha: 0.93,
        isLegacySrgb: false,
      }, 'lch(56.2 83.6 357.4 / 0.93)'],
      [{
        kind: ColorKind.Absolute,
        space: SPACES.oklab,
        components: [0.54, -0.1, -0.02],
        alpha: 1,
        isLegacySrgb: false,
      }, 'oklab(0.54 -0.1 -0.02)'],
      [{
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.5385, 0.1725, 320.67],
        alpha: 0.7,
        isLegacySrgb: false,
      }, 'oklch(0.5385 0.1725 320.67 / 0.7)'],
      [{
        kind: ColorKind.Absolute,
        space: SPACES['display-p3'],
        components: [0.28, 0.403, 0.423],
        alpha: 0.85,
        isLegacySrgb: false,
      }, 'color(display-p3 0.28 0.403 0.423 / 0.85)'],
    ];

    for (const [color, serialized] of cases) {
      expect(serializeColorValue(color)).toBe(serialized);
    }
  });

  // CSS Color 4 section 10 examples.
  it.each([
    [
      'sRGB and linear-light sRGB',
      'color(srgb 0.691 0.139 0.259)',
      'color(srgb-linear 0.435 0.017 0.055)',
    ],
    [
      'Display P3 and linear-light Display P3',
      'color(display-p3 0.591 0.123 0.264)',
      'color(display-p3-linear 0.3081 0.014 0.0567)',
    ],
    [
      'D50 and D65 XYZ',
      'color(xyz-d50 0.2005 0.14089 0.4472)',
      'color(xyz-d65 0.21661 0.14602 0.59452)',
    ],
    [
      'D50 and D65 white',
      'color(xyz-d50 0.9643 1 0.8251)',
      'color(xyz-d65 0.9505 1 1.089)',
    ],
  ])('matches the equivalent %s example', (_, first, second) => {
    const firstColor = parseColorValue(first) as AbsoluteColor;
    const secondColor = parseColorValue(second) as AbsoluteColor;

    expectColorCloseTo(firstColor, secondColor);
  });

  it('matches the Rec.2020 out-of-gamut conversion example', () => {
    const rec2020 = parseColorValue(
      'color(rec2020 0.42053 0.979780 0.00579)',
    ) as AbsoluteColor;
    const lch = convertAbsoluteColor(rec2020, 'lch');
    const displayP3 = convertAbsoluteColor(rec2020, 'display-p3');

    expectComponentsCloseTo(lch.components, [85.9017, 166.116, 138.207], 3);
    expectComponentsCloseTo(
      displayP3.components,
      [-0.350289, 1.00707, -0.144209],
      5,
    );
  });

  // The linked Rec.2020 WPT still uses the former piecewise transfer function;
  // the current gamma-2.4 conversion is covered by the example above.
  it.each([
    ['srgb-linear', [0, 0.21586, 0]],
    ['display-p3', [0.21604, 0.49418, 0.13151]],
    ['display-p3-linear', [0.0383, 0.2087, 0.0156]],
    ['a98-rgb', [0.281363, 0.498012, 0.116746]],
    ['prophoto-rgb', [0.230479, 0.395789, 0.129968]],
    ['xyz-d50', [0.08312, 0.154746, 0.020961]],
    ['xyz-d65', [0.07719, 0.15438, 0.02573]],
  ] as const)(
    'matches the %s green WPT conversion reference',
    (space, components) => {
      const converted = convertAbsoluteColor({
        kind: ColorKind.Absolute,
        space: SPACES[space],
        components: [...components],
        alpha: 1,
        isLegacySrgb: false,
      }, 'srgb');

      expectColorCloseTo(converted, [0, 128 / 255, 0]);
    },
  );

  it.each([
    'srgb',
    'display-p3',
    'a98-rgb',
    'prophoto-rgb',
    'rec2020',
  ] as const)('extends the %s transfer function out of gamut', (space) => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES[space],
      components: [-0.25, 0.5, 1.25],
      alpha: 1,
      isLegacySrgb: false,
    };
    const xyz = convertAbsoluteColor(
      color,
      space === 'prophoto-rgb' ? 'xyz-d50' : 'xyz-d65',
    );
    const roundTrip = convertAbsoluteColor(xyz, space);

    expect(xyz.components.every(Number.isFinite)).toBe(true);
    expectComponentsCloseTo(roundTrip.components, color.components, 12);
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
        space: SPACES.srgb,
        components: [...rgb],
        alpha: 1,
        isLegacySrgb: false,
      };
      const displayP3: AbsoluteColor = {
        ...srgb,
        space: SPACES['display-p3'],
      };
      const actualSrgbXyz = convertAbsoluteColor(srgb, 'xyz-d65');
      const actualSrgbLch = convertAbsoluteColor(srgb, 'lch');
      const actualDisplayP3Xyz = convertAbsoluteColor(displayP3, 'xyz-d65');
      const actualDisplayP3Lch = convertAbsoluteColor(displayP3, 'lch');

      expect(actualSrgbXyz.space.name).toBe('xyz-d65');
      expectColorCloseTo(actualSrgbXyz, {
        kind: ColorKind.Absolute,
        space: SPACES['xyz-d65'],
        components: [...srgbXyz],
        alpha: 1,
        isLegacySrgb: false,
      });
      expect(actualSrgbLch.space.name).toBe('lch');
      expectColorCloseTo(actualSrgbLch, {
        kind: ColorKind.Absolute,
        space: SPACES.lch,
        components: [...srgbLch],
        alpha: 1,
        isLegacySrgb: false,
      });
      expect(actualDisplayP3Xyz.space.name).toBe('xyz-d65');
      expectColorCloseTo(actualDisplayP3Xyz, {
        kind: ColorKind.Absolute,
        space: SPACES['xyz-d65'],
        components: [...displayP3Xyz],
        alpha: 1,
        isLegacySrgb: false,
      });
      expect(actualDisplayP3Lch.space.name).toBe('lch');
      expectColorCloseTo(actualDisplayP3Lch, {
        kind: ColorKind.Absolute,
        space: SPACES.lch,
        components: [...displayP3Lch],
        alpha: 1,
        isLegacySrgb: false,
      });
    },
  );

  it('converts absolute HSL and HWB colors to sRGB', () => {
    const hsl: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.hsl,
      components: [120, 100, 50],
      alpha: 0.5,
      isLegacySrgb: false,
    };
    const hwb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.hwb,
      components: [120, 0, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    };

    expect(convertAbsoluteColor(hsl, 'srgb')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 1, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(convertAbsoluteColor(hwb, 'srgb')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 1, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
  });

  it('normalizes 8-bit sRGB values before color conversion', () => {
    const color = parseColorValue('#ff0080cc') as AbsoluteColor;

    expect(convertAbsoluteColor(color, 'srgb')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 128 / 255],
      alpha: 0.8,
      isLegacySrgb: false,
    });
  });

  it('converts absolute sRGB colors to HSL and HWB', () => {
    const rgb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 1, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    };

    expect(convertAbsoluteColor(rgb, 'hsl')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.hsl,
      components: [120, 100, 50],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(convertAbsoluteColor(rgb, 'hwb')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.hwb,
      components: [120, 0, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
  });

  it('corrects negative saturation when converting out-of-gamut sRGB to HSL', () => {
    const rgb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [2, 1.5, 1.5],
      alpha: 0.5,
      isLegacySrgb: false,
    };
    const hsl = convertAbsoluteColor(rgb, 'hsl');

    expectComponentsCloseTo(hsl.components, [180, 100 / 3, 175], 12);
    expectColorCloseTo(convertAbsoluteColor(hsl, 'srgb'), rgb);
  });

  it('replaces missing components with zero during color conversion', () => {
    const hsl: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.hsl,
      components: [undefined, 100, 50],
      alpha: undefined,
      isLegacySrgb: false,
    };
    const gray: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0.5, 0.5],
      alpha: 1,
      isLegacySrgb: false,
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
          space: SPACES[source],
          components: [...components],
          alpha: 1,
          isLegacySrgb: false,
        },
        target,
      );

      expect(converted.components[hueIndex]).toBeUndefined();
    },
  );

  it.each([
    ['LCH', 'lch', 'lab', 0.0015],
    ['OKLCH', 'oklch', 'oklab', 0.000004],
  ] as const)(
    'applies the %s powerless-hue epsilon inclusively',
    (_, target, source, epsilon) => {
      const atBoundary = convertAbsoluteColor(
        {
          kind: ColorKind.Absolute,
          space: SPACES[source],
          components: [0.5, epsilon, 0],
          alpha: 1,
          isLegacySrgb: false,
        },
        target,
      );
      const aboveBoundary = convertAbsoluteColor(
        {
          kind: ColorKind.Absolute,
          space: SPACES[source],
          components: [0.5, epsilon * 1.0001, 0],
          alpha: 1,
          isLegacySrgb: false,
        },
        target,
      );

      expect(atBoundary.components[2]).toBeUndefined();
      expect(aboveBoundary.components[2]).toBe(0);
    },
  );

  it('routes absolute color conversion through sRGB', () => {
    const hsl: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.hsl,
      components: [120, 100, 50],
      alpha: 0.5,
      isLegacySrgb: false,
    };

    expect(convertAbsoluteColor(hsl, 'hwb')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.hwb,
      components: [120, 0, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(convertAbsoluteColor(hsl, 'srgb')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0, 1, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
  });

  it('converts Lab and Oklab between rectangular and polar forms', () => {
    const lab: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.lab,
      components: [50, 0, 40],
      alpha: 0.5,
      isLegacySrgb: false,
    };
    const oklab: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0.5, 0.1, 0],
      alpha: 0.25,
      isLegacySrgb: false,
    };

    expect(convertAbsoluteColor(lab, 'lch')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.lch,
      components: [50, 40, 90],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    const labRoundTrip = convertAbsoluteColor(
      convertAbsoluteColor(lab, 'lch'),
      'lab',
    );

    expect(labRoundTrip.space.name).toBe('lab');
    expect(labRoundTrip.alpha).toBe(lab.alpha);
    expectComponentsCloseTo(labRoundTrip.components, [50, 0, 40], 12);
    expect(convertAbsoluteColor(oklab, 'oklch')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [0.5, 0.1, 0],
      alpha: 0.25,
      isLegacySrgb: false,
    });
    const oklabRoundTrip = convertAbsoluteColor(
      convertAbsoluteColor(oklab, 'oklch'),
      'oklab',
    );

    expect(oklabRoundTrip.space.name).toBe('oklab');
    expect(oklabRoundTrip.alpha).toBe(oklab.alpha);
    expectComponentsCloseTo(oklabRoundTrip.components, [0.5, 0.1, 0], 12);
  });

  it('replaces a missing polar hue with zero rectangular components', () => {
    const lch: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.lch,
      components: [50, 40, undefined],
      alpha: 0.5,
      isLegacySrgb: false,
    };
    const oklch: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [0.5, 0.1, undefined],
      alpha: 0.25,
      isLegacySrgb: false,
    };

    expect(convertAbsoluteColor(lch, 'lab')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.lab,
      components: [50, 0, 0],
      alpha: 0.5,
      isLegacySrgb: false,
    });
    expect(convertAbsoluteColor(oklch, 'oklab')).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0.5, 0, 0],
      alpha: 0.25,
      isLegacySrgb: false,
    });
  });

  it('converts known sRGB and Display P3 primaries to XYZ D65', () => {
    const red: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    };
    const p3Red: AbsoluteColor = {
      ...red,
      space: SPACES['display-p3'],
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
      space: SPACES.lab,
      components: [100, 0, 0],
      alpha: 0.75,
      isLegacySrgb: false,
    };
    const srgb = convertAbsoluteColor(labWhite, 'srgb');

    expect(srgb.alpha).toBe(0.75);

    expectComponentsCloseTo(srgb.components, [1, 1, 1], 6);
  });

  it('round-trips absolute colors in every color space through XYZ', () => {
    const colors: PredefinedAbsoluteColor[] = [
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['srgb-linear'],
        components: [0.1, 0.3, 0.5],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.hsl,
        components: [210, 50, 40],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.hwb,
        components: [210, 20, 30],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.lab,
        components: [50, 20, -30],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.lch,
        components: [50, 36.0555127546, 303.690067526],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklab,
        components: [0.5, 0.1, -0.1],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.5, 0.1414213562, 315],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['display-p3'],
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['display-p3-linear'],
        components: [0.1, 0.3, 0.5],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['a98-rgb'],
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['prophoto-rgb'],
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.rec2020,
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['xyz-d50'],
        components: [0.3, 0.4, 0.2],
        alpha: 0.7,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['xyz-d65'],
        components: [0.3, 0.4, 0.2],
        alpha: 0.7,
        isLegacySrgb: false,
      },
    ];

    for (const color of colors) {
      const intermediate = color.space.name === 'xyz-d50'
        ? 'xyz-d65'
        : 'xyz-d50';
      const converted = convertAbsoluteColor(color, intermediate);
      const roundTrip = convertAbsoluteColor(converted, color.space.name);

      expect(roundTrip.space.name).toBe(color.space.name);
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
      space: SPACES['display-p3'],
      components: [1, 0, 0],
      alpha: 1,
      isLegacySrgb: false,
    };

    expect(convertAbsoluteColor(color, 'display-p3')).toBe(color);
  });

  it('calculates color difference as Euclidean distance in Oklab', () => {
    const reference: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0.5, 0.1, -0.2],
      alpha: 1,
      isLegacySrgb: false,
    };
    const sample: AbsoluteColor = {
      ...reference,
      components: [0.6, 0.3, -0.4],
    };

    expect(deltaEOK(reference, sample)).toBeCloseTo(0.3, 12);
  });

  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1],
    [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.001], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
    [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.001, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1],
    [[50, 2.5, 0], [50, 3.2972, 0], 1],
    [[50, 2.5, 0], [50, 1.8634, 0.5757], 1],
    [[50, 2.5, 0], [50, 3.2592, 0.335], 1],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
    [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ] as const)(
    'matches the Sharma ΔE2000 reference %j and %j',
    (reference, sample, expected) => {
      const color = (
        components: readonly [number, number, number]
      ): AbsoluteColor => ({
        kind: ColorKind.Absolute,
        space: SPACES.lab,
        components: [...components],
        alpha: 1,
        isLegacySrgb: false,
      });

      expect(deltaE2000(color(reference), color(sample)))
        .toBeCloseTo(expected, 4);
    },
  );

  it('compares same-space color components and alpha within epsilon', () => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0.5, 0.1, -0.2],
      alpha: 0.4,
      isLegacySrgb: false,
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

  it.each([
    'black',
    '#000',
    '#000f',
    'rgb(0 0 0)',
    'rgb(calc(5 - 5) 0 0)',
    'rgba(0, 0, 0, 1)',
    'rgb(-10 0 0)',
    'hwb(0 0 100)',
    'hsl(0 0 0)',
    'color(srgb 0 0 0)',
    'color(srgb-linear 0 0 0)',
    'color(display-p3 0 0 0)',
    'color(xyz-d65 0 0 0)',
    'lab(0 0 0)',
  ])('matches the section 12 equivalent-black WPT case %s', (input) => {
    const black = resolveColorValue(
      parseColorValue('black')!,
      ValueStage.Computed,
    ) as AbsoluteColor;
    const color = resolveColorValue(
      parseColorValue(input)!,
      ValueStage.Computed,
    ) as AbsoluteColor;

    expect(areColorsEquivalent(color, black)).toBe(true);
  });

  it.each([
    'hwb(none 0 100)',
    'hsl(none 0 0)',
    'color(srgb none 0 0)',
    'color(srgb-linear 0 none 0)',
    'oklch(0 0 none)',
    'oklab(0 none none)',
  ])('matches the section 12 non-equivalent-black WPT case %s', (input) => {
    const black = resolveColorValue(
      parseColorValue('black')!,
      ValueStage.Computed,
    ) as AbsoluteColor;
    const color = resolveColorValue(
      parseColorValue(input)!,
      ValueStage.Computed,
    ) as AbsoluteColor;

    expect(areColorsEquivalent(color, black)).toBe(false);
  });

  it('makes a powerless Oklch hue missing before comparison', () => {
    const black = resolveColorValue(
      parseColorValue('black')!,
      ValueStage.Computed,
    ) as AbsoluteColor;
    const oklch = resolveColorValue(
      parseColorValue('oklch(0 0 0)')!,
      ValueStage.Computed,
    ) as AbsoluteColor;

    expect(areColorsEquivalent(oklch, black)).toBe(false);
  });

  it('uses the standardized epsilon for different color spaces', () => {
    const srgb: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.2, 0.4, 0.6],
      alpha: 0.8,
      isLegacySrgb: false,
    };
    const oklab = convertAbsoluteColor(srgb, 'oklab');

    expect(areColorsEquivalent(srgb, {
      ...oklab,
      components: [
        oklab.components[0]! + 0.000009,
        oklab.components[1],
        oklab.components[2],
      ],
    })).toBe(true);
    expect(areColorsEquivalent(srgb, {
      ...oklab,
      components: [
        oklab.components[0]! + 0.00002,
        oklab.components[1],
        oklab.components[2],
      ],
    })).toBe(false);
    expect(areColorsEquivalent(srgb, {
      ...oklab,
      alpha: oklab.alpha! + 0.000009,
    })).toBe(true);
    expect(areColorsEquivalent(srgb, {
      ...oklab,
      alpha: oklab.alpha! + 0.00002,
    })).toBe(false);
  });

  it('only considers missing components equal to missing components', () => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [0.5, 0.2, undefined],
      alpha: undefined,
      isLegacySrgb: false,
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
        space: SPACES[space],
        components: [...components],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES[space],
        components: [...components],
        alpha: 1,
        isLegacySrgb: false,
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
      space: SPACES.hsl,
      components: [120, 0.001, 50],
      alpha: 1,
      isLegacySrgb: false,
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
      space: SPACES.hwb,
      components: [120, 49.999, 50],
      alpha: 1,
      isLegacySrgb: false,
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
      space: SPACES.lch,
      components: [50, 0.0015, 120],
      alpha: 1,
      isLegacySrgb: false,
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
      space: SPACES.oklch,
      components: [0.5, 0.000004, 120],
      alpha: 1,
      isLegacySrgb: false,
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
      space: SPACES.srgb,
      components: [0.8, 0.2, 0.4],
      alpha: 0.6,
      isLegacySrgb: false,
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
      space: SPACES.srgb,
      components: [undefined, 0.2, 0.4],
      alpha: 1,
      isLegacySrgb: false,
    };

    expect(areColorsEquivalent(missing, {
      ...missing,
      space: SPACES['display-p3'],
    })).toBe(false);
  });

  it('compares legacy and 8-bit sRGB colors as sRGB', () => {
    const legacy: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [255, 128, 0],
      alpha: 128,
      isLegacySrgb: true,
      is8Bit: true,
    };

    expect(areColorsEquivalent(legacy, {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 128 / 255, 0],
      alpha: 128 / 255,
      isLegacySrgb: false,
    })).toBe(true);
  });

  it('carries an analogous missing component into the interpolation space', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [undefined, 0.2, 0.4],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['xyz-d65'],
        components: [0.8, 0.3, 0.2],
        alpha: 1,
        isLegacySrgb: false,
      },
      0.5,
      'xyz-d65',
    );

    expect(result.space.name).toBe('xyz-d65');
    expect(result.components[0]).toBe(0.8);
  });

  it('carries an analogous hue between polar color spaces', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.lch,
        components: [50, 0.02, undefined],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.7, 0.2, 80],
        alpha: 1,
        isLegacySrgb: false,
      },
      0.5,
      'oklch',
    );

    expect(result.components[2]).toBe(80);
  });

  it.each([
    [[120, undefined, undefined], [75, 30, 40]],
    [[120, 10, undefined], [75, 20, 20]],
  ] as const)(
    'treats HWB whiteness and blackness as an analogous set',
    (components, expected) => {
      const result = interpolateColors(
        {
          kind: ColorKind.Absolute,
          space: SPACES.hwb,
          components: [...components],
          alpha: 1,
          isLegacySrgb: false,
        },
        {
          kind: ColorKind.Absolute,
          space: SPACES.hwb,
          components: [30, 30, 40],
          alpha: 1,
          isLegacySrgb: false,
        },
        0.5,
        'hwb',
      );

      expect(result.components).toEqual(expected);
    },
  );

  it('carries a wholly missing analogous set into the interpolation space', () => {
    const expected: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0.7, 0.1, -0.1],
      alpha: 0.6,
      isLegacySrgb: false,
    };
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [undefined, undefined, undefined],
        alpha: 0.4,
        isLegacySrgb: false,
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
        space: SPACES.srgb,
        components: [undefined, undefined, undefined],
        alpha: 0.4,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES['display-p3'],
        components: [undefined, undefined, undefined],
        alpha: 0.8,
        isLegacySrgb: false,
      },
      0.5,
      'oklab',
    );

    expect(result).toMatchObject({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [undefined, undefined, undefined],
      isLegacySrgb: false,
    });
    expect(result.alpha).toBeCloseTo(0.6, 12);
  });

  it('uses the other color value for a missing alpha component', () => {
    const color: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0.5, 0.1, -0.1],
      alpha: 0.6,
      isLegacySrgb: false,
    };

    expect(interpolateColors(
      { ...color, alpha: undefined },
      color,
      0.5,
      'oklab',
    )).toEqual(color);
  });

  it('restores a missing alpha before premultiplication', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.783, 0.108, 326.5],
        alpha: 0.5,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.392, 0.4, 0],
        alpha: undefined,
        isLegacySrgb: false,
      },
      0.5,
      'oklch',
    );

    expect(result.alpha).toBe(0.5);
    expectComponentsCloseTo(result.components, [0.5875, 0.254, 343.25], 12);
  });

  it('converts an uncarried missing component as zero', () => {
    const source: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [undefined, 0.2, 0.4],
      alpha: 1,
      isLegacySrgb: false,
    };
    const expected = convertAbsoluteColor({
      ...source,
      components: [0, 0.2, 0.4],
    }, 'oklab');
    const result = interpolateColors(
      source,
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklab,
        components: [0.8, 0.1, 0.1],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES.srgb,
        components: [0.24, 0.12, 0.98],
        alpha: 0.4,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [0.62, 0.26, 0.64],
        alpha: 0.6,
        isLegacySrgb: false,
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
        space: SPACES.lab,
        components: [66.927, 4.873, 68.622],
        alpha: 0.4,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.lab,
        components: [53.503, 82.672, -33.901],
        alpha: 0.6,
        isLegacySrgb: false,
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
        space: SPACES.lch,
        components: [66.93, 68.79, 85.94],
        alpha: 0.4,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.lch,
        components: [53.5, 89.35, 337.7],
        alpha: 0.6,
        isLegacySrgb: false,
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
        space: SPACES.oklab,
        components: [0.2, 0.1, -0.1],
        alpha: undefined,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklab,
        components: [0.6, 0.3, 0.1],
        alpha: undefined,
        isLegacySrgb: false,
      },
      0.5,
      'oklab',
    );

    expect(result).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0.4, 0.2, 0],
      alpha: undefined,
      isLegacySrgb: false,
    });
  });

  it('does not unpremultiply a zero-alpha result', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklab,
        components: [0.2, 0.1, -0.1],
        alpha: 0,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklab,
        components: [0.6, 0.3, 0.1],
        alpha: 0,
        isLegacySrgb: false,
      },
      0.5,
      'oklab',
    );

    expect(result).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0, 0, 0],
      alpha: 0,
      isLegacySrgb: false,
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
          space: SPACES[space],
          components: [...a],
          alpha: 1,
          isLegacySrgb: false,
        },
        {
          kind: ColorKind.Absolute,
          space: SPACES[space],
          components: [...b],
          alpha: 1,
          isLegacySrgb: false,
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
          space: SPACES.oklch,
          components: [...a],
          alpha: 1,
          isLegacySrgb: false,
        },
        {
          kind: ColorKind.Absolute,
          space: SPACES.oklch,
          components: [...b],
          alpha: 1,
          isLegacySrgb: false,
        },
        0.5,
        'oklch',
        method,
      );

      expect(result.alpha).toBe(1);

      expectComponentsCloseTo(result.components, expected, 12);
    },
  );

  it.each([
    ['shorter', 0, 180, 90],
    ['shorter', 180, 0, 90],
    ['longer', 0, 180, 90],
    ['longer', 180, 0, 90],
    ['increasing', 180, 0, 270],
    ['decreasing', 0, 180, 270],
  ] as const)(
    'handles the 180-degree boundary for %s hue interpolation',
    (method, hueA, hueB, expected) => {
      const result = interpolateColors(
        {
          kind: ColorKind.Absolute,
          space: SPACES.oklch,
          components: [0.5, 0.1, hueA],
          alpha: 1,
          isLegacySrgb: false,
        },
        {
          kind: ColorKind.Absolute,
          space: SPACES.oklch,
          components: [0.5, 0.1, hueB],
          alpha: 1,
          isLegacySrgb: false,
        },
        0.5,
        'oklch',
        method,
      );

      expect(result.components[2]).toBe(expected);
    },
  );

  it('takes a full circle for longer interpolation between equal hues', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.4, 0.1, 30],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.8, 0.1, 30],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES.oklch,
        components: [0.2, 0.1, undefined],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.8, 0.4, 180],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES.oklch,
        components: [0.2, 0.1, undefined],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.8, 0.4, undefined],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES[space],
        components: [...a],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES[space],
        components: [...b],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES.srgb,
        components: [0.2, 0.4, 0.6],
        alpha: 1,
        isLegacySrgb: true,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [0.8, 0.6, 0.4],
        alpha: 1,
        isLegacySrgb: true,
      },
      0.5,
    );

    expect(result).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.5, 0.5, 0.5],
      alpha: 1,
      isLegacySrgb: false,
    });
  });

  it('defaults to Oklab when either color is not legacy', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [0, 0, 0],
        alpha: 1,
        isLegacySrgb: true,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [1, 1, 1],
        alpha: 1,
        isLegacySrgb: false,
      },
      0.5,
    );

    expect(result.space.name).toBe('oklab');
    expectComponentsCloseTo(result.components, [0.5, 0, 0], 7);
  });

  it('takes an individual missing component from the other color', () => {
    const result = interpolateColors(
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [0.5, 0, 0],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [undefined, 0.5, 0.5],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES.lab,
        components: [50, undefined, undefined],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.lch,
        components: [70, undefined, undefined],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES.srgb,
        components: [0, 0, 0],
        alpha: 0,
        isLegacySrgb: true,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [0.8, 0.2, 120],
        alpha: 1,
        isLegacySrgb: false,
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
        space: SPACES.srgb,
        components: [-1, 2, 3],
        alpha: 1,
        isLegacySrgb: false,
      },
      {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [3, 4, -1],
        alpha: 1,
        isLegacySrgb: false,
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
      const mapped = gamutMapColor({
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [...oklch],
        alpha: 1,
        isLegacySrgb: false,
      }, 'srgb');

      expect(mapped.space.name).toBe('srgb');
      expectColorCloseTo(mapped, {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [...srgb],
        alpha: 1,
        isLegacySrgb: false,
      });
    },
  );

  it('returns the clipped color below the just-noticeable difference', () => {
    const mapped = gamutMapColor({
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [0.7, 0.2, 30],
      alpha: 0.5,
      isLegacySrgb: false,
    }, 'srgb');

    expectColorCloseTo(mapped, {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [1, 0.38019885544225046, 0.3010433350997795],
      alpha: 0.5,
      isLegacySrgb: false,
    });
  });

  it('supports clipping as an explicit gamut-mapping method', () => {
    const mapped = gamutMapColor({
      kind: ColorKind.Absolute,
      space: SPACES['srgb-linear'],
      components: [0.5, 1, 3],
      alpha: 0.4,
      isLegacySrgb: false,
    }, 'srgb-linear', 'clip');

    expect(mapped).toEqual({
      kind: ColorKind.Absolute,
      space: SPACES['srgb-linear'],
      components: [0.5, 1, 1],
      alpha: 0.4,
      isLegacySrgb: false,
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
      const mapped = gamutMapColor({
        kind: ColorKind.Absolute,
        space: SPACES.oklch,
        components: [...oklch],
        alpha: 0.4,
        isLegacySrgb: false,
      }, 'srgb');

      expectColorCloseTo(mapped, {
        kind: ColorKind.Absolute,
        space: SPACES.srgb,
        components: [...srgb],
        alpha: 0.4,
        isLegacySrgb: false,
      });
    }
  });

  it('leaves in-gamut colors colorimetrically unchanged', () => {
    const origin: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: [0.2, 0.4, 0.6],
      alpha: 0.35,
      isLegacySrgb: false,
    };
    const mapped = gamutMapColor(origin, 'srgb');

    expect(mapped.space.name).toBe('srgb');
    expectColorCloseTo(mapped, origin);
  });

  it('converts without mapping when the destination has no gamut limits', () => {
    const origin: AbsoluteColor = {
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [0.7, 0.8, 40],
      alpha: 0.6,
      isLegacySrgb: false,
    };

    expect(gamutMapColor(origin, 'xyz-d65'))
      .toEqual(convertAbsoluteColor(origin, 'xyz-d65'));
  });

  it.each([
    'srgb',
    'srgb-linear',
    'display-p3',
    'display-p3-linear',
    'a98-rgb',
    'prophoto-rgb',
    'rec2020',
  ] as const)('returns an in-gamut color in %s', (destination) => {
    const mapped = gamutMapColor({
      kind: ColorKind.Absolute,
      space: SPACES.oklch,
      components: [0.7, 0.8, 40],
      alpha: 0.25,
      isLegacySrgb: false,
    }, destination);

    expect(mapped.space.name).toBe(destination);
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
