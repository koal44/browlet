import { describe, expect, it } from 'vitest';
import {
  ColorKind, convertNumericColor, deltaEOK, gamutMapNumericColor,
  parseColorValue, serializeColorValue, type NumericColor,
} from '../../../../src/stylelet/values/color';
import { ColorName, colorNameFromText, namedColorRgba, SystemColorName } from '../../../../src/stylelet/values/color-keywords';

type ColorVector = readonly [number, number, number];

function expectColorEquivalent(
  actual: NumericColor,
  expected: NumericColor,
): void {
  expect(actual.alpha).toBe(expected.alpha);
  expect(deltaEOK(actual, expected)).toBeLessThan(0.001);
}

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

  it('serializes parsed color functions with canonical spelling and spacing', () => {
    const cases = [
      [
        ' RGBa( 1 ,  2, 3 , 50% ) ',
        'rgba(1, 2, 3, 0.5)',
      ],
      [
        ' HSLa( .5turn , 25% , 75% , 20% ) ',
        'hsla(180, 25, 75, 0.2)',
      ],
      [
        ' HWB( .5turn   20%  30% / 50% ) ',
        'hwb(180 20 30 / 0.5)',
      ],
      [
        ' LAB( 50%  20  -30% / 40% ) ',
        'lab(50 20 -37.5 / 0.4)',
      ],
      [
        ' OKLAB( 50%  20%  -30% / 40% ) ',
        'oklab(0.5 0.08 -0.12 / 0.4)',
      ],
      [
        ' LCH( 50%  40%  270deg / 25% ) ',
        'lch(50 60 270 / 0.25)',
      ],
      [
        ' OKLCH( .5  20%  .25turn / 25% ) ',
        'oklch(0.5 0.08 90 / 0.25)',
      ],
      [
        ' COLOR( DISPLAY-P3  .1  20%  none / 25% ) ',
        'color(display-p3 0.1 0.2 none / 0.25)',
      ],
      [
        ' COLOR( XYZ  0  0  0 ) ',
        'color(xyz-d65 0 0 0)',
      ],
    ];

    for (const [input, serialized] of cases) {
      const color = parseColorValue(input);

      expect(color).not.toBeNull();
      expect(serializeColorValue(color!)).toBe(serialized);
    }
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
    const color = parseColorValue(
      'color(display-p3 calc(.1 + .2) 0 0 / calc(.25 + .25))',
    )!;

    expect(serializeColorValue(color))
      .toBe('color(display-p3 calc(0.3) 0 0 / calc(0.5))');
    expect(serializeColorValue(color, { stage: 'computed' }))
      .toBe('color(display-p3 0.3 0 0 / 0.5)');
  });

  it('serializes keyword colors in lowercase', () => {
    expect(serializeColorValue({
      kind: ColorKind.Named,
      name: ColorName.rebeccapurple,
    })).toBe('rebeccapurple');
    expect(serializeColorValue({
      kind: ColorKind.Named,
      name: ColorName.transparent,
    })).toBe('transparent');
    expect(serializeColorValue({
      kind: ColorKind.System,
      name: SystemColorName.CanvasText,
    })).toBe('canvastext');
    expect(serializeColorValue({
      kind: ColorKind.CurrentColor,
    })).toBe('currentcolor');
  });

  it('serializes numerical sRGB colors in legacy rgb form', () => {
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'srgb-legacy',
      components: [1, 0.5, 0],
      alpha: 1,
    })).toBe('rgb(255, 127.5, 0)');
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'srgb-legacy',
      components: [1.2, -0.1, 0],
      alpha: 0.5,
    })).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('preserves missing numerical sRGB components through color()', () => {
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'srgb-legacy',
      components: [undefined, 0.5, 0],
      alpha: undefined,
    })).toBe('color(srgb none 0.5 0 / none)');
  });

  it('keeps color(srgb) distinct from rgb()', () => {
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'srgb',
      components: [1, 0, 0],
      alpha: 1,
    })).toBe('color(srgb 1 0 0)');
  });

  it('clamps and rounds numerical alpha values', () => {
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: 2,
    })).toBe('color(display-p3 1 0 0)');
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: 0.123456789,
    })).toBe('color(display-p3 1 0 0 / 0.123457)');
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: Number.NaN,
    })).toBe('color(display-p3 1 0 0 / 0)');
  });

  it('serializes numerical HSL and HWB colors with missing components', () => {
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'hsl',
      components: [20, undefined, 30],
      alpha: undefined,
    })).toBe('hsl(20 none 30% / none)');
    expect(serializeColorValue({
      kind: ColorKind.Numeric,
      space: 'hwb',
      components: [20, undefined, 30],
      alpha: 1,
    })).toBe('hwb(20 none 30%)');
  });

  it('serializes numerical wide-gamut colors in their notation', () => {
    const cases: [NumericColor, string][] = [
      [{
        kind: ColorKind.Numeric,
        space: 'lab',
        components: [56.2, 0, 83.6],
        alpha: 1,
      }, 'lab(56.2 0 83.6)'],
      [{
        kind: ColorKind.Numeric,
        space: 'lch',
        components: [56.2, 83.6, 357.4],
        alpha: 0.93,
      }, 'lch(56.2 83.6 357.4 / 0.93)'],
      [{
        kind: ColorKind.Numeric,
        space: 'oklab',
        components: [0.54, -0.1, -0.02],
        alpha: 1,
      }, 'oklab(0.54 -0.1 -0.02)'],
      [{
        kind: ColorKind.Numeric,
        space: 'oklch',
        components: [0.5385, 0.1725, 320.67],
        alpha: 0.7,
      }, 'oklch(0.5385 0.1725 320.67 / 0.7)'],
      [{
        kind: ColorKind.Numeric,
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
    rgb: ColorVector,
    srgbLch: ColorVector,
    srgbXyz: ColorVector,
    displayP3Lch: ColorVector,
    displayP3Xyz: ColorVector,
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
      const srgb: NumericColor = {
        kind: ColorKind.Numeric,
        space: 'srgb',
        components: [...rgb],
        alpha: 1,
      };
      const displayP3: NumericColor = {
        ...srgb,
        space: 'display-p3',
      };
      const actualSrgbXyz = convertNumericColor(srgb, 'xyz-d65');
      const actualSrgbLch = convertNumericColor(srgb, 'lch');
      const actualDisplayP3Xyz = convertNumericColor(displayP3, 'xyz-d65');
      const actualDisplayP3Lch = convertNumericColor(displayP3, 'lch');

      expect(actualSrgbXyz.space).toBe('xyz-d65');
      expectColorEquivalent(actualSrgbXyz, {
        kind: ColorKind.Numeric,
        space: 'xyz-d65',
        components: [...srgbXyz],
        alpha: 1,
      });
      expect(actualSrgbLch.space).toBe('lch');
      expectColorEquivalent(actualSrgbLch, {
        kind: ColorKind.Numeric,
        space: 'lch',
        components: [...srgbLch],
        alpha: 1,
      });
      expect(actualDisplayP3Xyz.space).toBe('xyz-d65');
      expectColorEquivalent(actualDisplayP3Xyz, {
        kind: ColorKind.Numeric,
        space: 'xyz-d65',
        components: [...displayP3Xyz],
        alpha: 1,
      });
      expect(actualDisplayP3Lch.space).toBe('lch');
      expectColorEquivalent(actualDisplayP3Lch, {
        kind: ColorKind.Numeric,
        space: 'lch',
        components: [...displayP3Lch],
        alpha: 1,
      });
    },
  );

  it('converts numerical HSL and HWB colors to sRGB', () => {
    const hsl: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'hsl',
      components: [120, 100, 50],
      alpha: 0.5,
    };
    const hwb: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'hwb',
      components: [120, 0, 0],
      alpha: 0.5,
    };

    expect(convertNumericColor(hsl, 'srgb')).toEqual({
      kind: ColorKind.Numeric,
      space: 'srgb',
      components: [0, 1, 0],
      alpha: 0.5,
    });
    expect(convertNumericColor(hwb, 'srgb')).toEqual({
      kind: ColorKind.Numeric,
      space: 'srgb',
      components: [0, 1, 0],
      alpha: 0.5,
    });
  });

  it('converts numerical sRGB colors to HSL and HWB', () => {
    const rgb: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'srgb',
      components: [0, 1, 0],
      alpha: 0.5,
    };

    expect(convertNumericColor(rgb, 'hsl')).toEqual({
      kind: ColorKind.Numeric,
      space: 'hsl',
      components: [120, 100, 50],
      alpha: 0.5,
    });
    expect(convertNumericColor(rgb, 'hwb')).toEqual({
      kind: ColorKind.Numeric,
      space: 'hwb',
      components: [120, 0, 0],
      alpha: 0.5,
    });
  });

  it('replaces missing components with zero during color conversion', () => {
    const hsl: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'hsl',
      components: [undefined, 100, 50],
      alpha: undefined,
    };
    const gray: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'srgb',
      components: [0.5, 0.5, 0.5],
      alpha: 1,
    };

    expect(convertNumericColor(hsl, 'srgb').components).toEqual([1, 0, 0]);
    expect(convertNumericColor(gray, 'hsl').components[0]).toBeUndefined();
    expect(convertNumericColor(gray, 'hwb').components[0]).toBeUndefined();
  });

  it('routes numerical color conversion through sRGB', () => {
    const hsl: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'hsl',
      components: [120, 100, 50],
      alpha: 0.5,
    };

    expect(convertNumericColor(hsl, 'hwb')).toEqual({
      kind: ColorKind.Numeric,
      space: 'hwb',
      components: [120, 0, 0],
      alpha: 0.5,
    });
    expect(convertNumericColor(hsl, 'srgb-legacy')).toEqual({
      kind: ColorKind.Numeric,
      space: 'srgb-legacy',
      components: [0, 1, 0],
      alpha: 0.5,
    });
  });

  it('converts Lab and Oklab between rectangular and polar forms', () => {
    const lab: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'lab',
      components: [50, 0, 40],
      alpha: 0.5,
    };
    const oklab: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'oklab',
      components: [0.5, 0.1, 0],
      alpha: 0.25,
    };

    expect(convertNumericColor(lab, 'lch')).toEqual({
      kind: ColorKind.Numeric,
      space: 'lch',
      components: [50, 40, 90],
      alpha: 0.5,
    });
    const labRoundTrip = convertNumericColor(
      convertNumericColor(lab, 'lch'),
      'lab',
    );

    expect(labRoundTrip.space).toBe('lab');
    expect(labRoundTrip.alpha).toBe(lab.alpha);
    expect(labRoundTrip.components[0]).toBeCloseTo(50, 12);
    expect(labRoundTrip.components[1]).toBeCloseTo(0, 12);
    expect(labRoundTrip.components[2]).toBeCloseTo(40, 12);
    expect(convertNumericColor(oklab, 'oklch')).toEqual({
      kind: ColorKind.Numeric,
      space: 'oklch',
      components: [0.5, 0.1, 0],
      alpha: 0.25,
    });
    const oklabRoundTrip = convertNumericColor(
      convertNumericColor(oklab, 'oklch'),
      'oklab',
    );

    expect(oklabRoundTrip.space).toBe('oklab');
    expect(oklabRoundTrip.alpha).toBe(oklab.alpha);
    expect(oklabRoundTrip.components[0]).toBeCloseTo(0.5, 12);
    expect(oklabRoundTrip.components[1]).toBeCloseTo(0.1, 12);
    expect(oklabRoundTrip.components[2]).toBeCloseTo(0, 12);
  });

  it('replaces a missing polar hue with zero rectangular components', () => {
    const lch: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'lch',
      components: [50, 40, undefined],
      alpha: 0.5,
    };
    const oklch: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'oklch',
      components: [0.5, 0.1, undefined],
      alpha: 0.25,
    };

    expect(convertNumericColor(lch, 'lab')).toEqual({
      kind: ColorKind.Numeric,
      space: 'lab',
      components: [50, 0, 0],
      alpha: 0.5,
    });
    expect(convertNumericColor(oklch, 'oklab')).toEqual({
      kind: ColorKind.Numeric,
      space: 'oklab',
      components: [0.5, 0, 0],
      alpha: 0.25,
    });
  });

  it('converts known sRGB and Display P3 primaries to XYZ D65', () => {
    const red: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'srgb',
      components: [1, 0, 0],
      alpha: 1,
    };
    const p3Red: NumericColor = {
      ...red,
      space: 'display-p3',
    };
    const srgbXyz = convertNumericColor(red, 'xyz-d65').components;
    const p3Xyz = convertNumericColor(p3Red, 'xyz-d65').components;

    expect(srgbXyz[0]).toBeCloseTo(0.4123907993, 9);
    expect(srgbXyz[1]).toBeCloseTo(0.2126390059, 9);
    expect(srgbXyz[2]).toBeCloseTo(0.0193308187, 9);
    expect(p3Xyz[0]).toBeCloseTo(0.4865709486, 9);
    expect(p3Xyz[1]).toBeCloseTo(0.2289745641, 9);
    expect(p3Xyz[2]).toBe(0);
  });

  it('converts colors across D50 and D65 spaces', () => {
    const labWhite: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'lab',
      components: [100, 0, 0],
      alpha: 0.75,
    };
    const srgb = convertNumericColor(labWhite, 'srgb');

    expect(srgb.alpha).toBe(0.75);

    for (const component of srgb.components) {
      expect(component).toBeCloseTo(1, 6);
    }
  });

  it('round-trips every numerical color space through XYZ', () => {
    const colors: NumericColor[] = [
      {
        kind: ColorKind.Numeric,
        space: 'srgb-legacy',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'srgb',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'srgb-linear',
        components: [0.1, 0.3, 0.5],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'hsl',
        components: [210, 50, 40],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'hwb',
        components: [210, 20, 30],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'lab',
        components: [50, 20, -30],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'lch',
        components: [50, 36.0555127546, 303.690067526],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'oklab',
        components: [0.5, 0.1, -0.1],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'oklch',
        components: [0.5, 0.1414213562, 315],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'display-p3',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'display-p3-linear',
        components: [0.1, 0.3, 0.5],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'a98-rgb',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'prophoto-rgb',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'rec2020',
        components: [0.2, 0.4, 0.6],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'xyz-d50',
        components: [0.3, 0.4, 0.2],
        alpha: 0.7,
      },
      {
        kind: ColorKind.Numeric,
        space: 'xyz-d65',
        components: [0.3, 0.4, 0.2],
        alpha: 0.7,
      },
    ];

    for (const color of colors) {
      const intermediate = color.space === 'xyz-d50'
        ? 'xyz-d65'
        : 'xyz-d50';
      const converted = convertNumericColor(color, intermediate);
      const roundTrip = convertNumericColor(converted, color.space);

      expect(roundTrip.space).toBe(color.space);
      expect(roundTrip.alpha).toBe(color.alpha);

      for (let index = 0; index < 3; index++) {
        expect(roundTrip.components[index])
          .toBeCloseTo(color.components[index]!, 7);
      }
    }
  });

  it('returns an unchanged numerical color conversion by identity', () => {
    const color: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'display-p3',
      components: [1, 0, 0],
      alpha: 1,
    };

    expect(convertNumericColor(color, 'display-p3')).toBe(color);
  });

  it('calculates color difference as Euclidean distance in Oklab', () => {
    const reference: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'oklab',
      components: [0.5, 0.1, -0.2],
      alpha: 1,
    };
    const sample: NumericColor = {
      ...reference,
      components: [0.6, 0.3, -0.4],
    };

    expect(deltaEOK(reference, sample)).toBeCloseTo(0.3, 12);
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
    oklch: ColorVector,
    srgb: ColorVector,
  ])[];

  it.each(binarySearchGamutMappingReferences)(
    'matches the WPT binary-search gamut mapping reference %j',
    (oklch, srgb) => {
      const mapped = gamutMapNumericColor({
        kind: ColorKind.Numeric,
        space: 'oklch',
        components: [...oklch],
        alpha: 1,
      }, 'srgb');

      expect(mapped.space).toBe('srgb');
      expectColorEquivalent(mapped, {
        kind: ColorKind.Numeric,
        space: 'srgb',
        components: [...srgb],
        alpha: 1,
      });
    },
  );

  it('returns the clipped color below the just-noticeable difference', () => {
    const mapped = gamutMapNumericColor({
      kind: ColorKind.Numeric,
      space: 'oklch',
      components: [0.7, 0.2, 30],
      alpha: 0.5,
    }, 'srgb');

    expectColorEquivalent(mapped, {
      kind: ColorKind.Numeric,
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
      oklch: ColorVector,
      srgb: ColorVector,
    ])[];

    for (const [oklch, srgb] of cases) {
      const mapped = gamutMapNumericColor({
        kind: ColorKind.Numeric,
        space: 'oklch',
        components: [...oklch],
        alpha: 0.4,
      }, 'srgb');

      expectColorEquivalent(mapped, {
        kind: ColorKind.Numeric,
        space: 'srgb',
        components: [...srgb],
        alpha: 0.4,
      });
    }
  });

  it('leaves in-gamut colors colorimetrically unchanged', () => {
    const origin: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'srgb',
      components: [0.2, 0.4, 0.6],
      alpha: 0.35,
    };
    const mapped = gamutMapNumericColor(origin, 'srgb');

    expect(mapped.space).toBe('srgb');
    expectColorEquivalent(mapped, origin);
  });

  it('converts without mapping when the destination has no gamut limits', () => {
    const origin: NumericColor = {
      kind: ColorKind.Numeric,
      space: 'oklch',
      components: [0.7, 0.8, 40],
      alpha: 0.6,
    };

    expect(gamutMapNumericColor(origin, 'xyz-d65'))
      .toEqual(convertNumericColor(origin, 'xyz-d65'));
  });

  it('returns an in-gamut color in the requested RGB destination', () => {
    const mapped = gamutMapNumericColor({
      kind: ColorKind.Numeric,
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
