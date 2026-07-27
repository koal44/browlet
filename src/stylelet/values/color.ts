import { asciiLower } from '../../shared/css';
import { assertNever, clamp } from '../../shared/util';
import type { ComponentCursor } from '../parser/component-cursor';
import {
  createDelimConsumer, createFunctionalNotationConsumer,
  tryConsumeHashToken,
} from '../parser/component-consumers';
import {
  commaRepeat, one, oneOf, opt, repeat, sequenceOf,
  withComponentTrivia,
} from '../parser/component-grammar';
import {
  isBad, ok, type TryComponentConsumer,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import { isAtOrBeyondValueStage, type ValueStage } from '../value-processing';
import { resolveAngle, serializeAngle, tryConsumeAngle, type AngleValue } from './angle';
import { tryCoercePercentageToNumber, type MathContext } from './math-value';
import { tryConsumeIdent } from './ident';
import { createKeywordConsumer } from './keyword';
import { resolveAngle as resolveAngleLiteral } from './numeric-literal/angle';
import { serializeCssNumber, type NumberLiteral } from './numeric-literal/number';
import { resolveNumber, serializeNumber, tryConsumeNumber, type NumberValue } from './number';
import {
  resolvePercentage, serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';

/*
 * <color> = <color-base> | currentColor | <system-color>
 *
 * <color-base> = <hex-color> | <color-function> | <named-color>
 *
 * <color-function> = <rgb()> | <rgba()> |
 *                    <hsl()> | <hsla()> | <hwb()> |
 *                    <lab()> | <lch()> | <oklab()> | <oklch()> |
 *                    <color()>
 *
 * <alpha-value> = <number> | <percentage>
 * <hue> = <number> | <angle>
 */

export type ColorValue =
  | AbsoluteColor
  | ColorBase
  | CurrentColor
  | SystemColor
  | DeprecatedColor;

// Canonical representation of an absolute color. Undefined components
// represent the `none` keyword.
export type AbsoluteColor = {
  kind: ColorKind.Absolute;
  space: AbsoluteColorSpace;
  components: ColorComponents;
  alpha: number | undefined;
  is8Bit?: true;
};

type AbsoluteColorSpace =
  // Internal variant for colors serialized with rgb() or rgba().
  | 'srgb-legacy'
  | ColorSpace;

type ColorSpace = RectangularColorSpace | PolarColorSpace;

type RectangularColorSpace =
  | 'srgb'
  | 'srgb-linear'
  | 'lab'
  | 'oklab'
  | 'display-p3'
  | 'display-p3-linear'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020'
  | 'xyz-d50'
  | 'xyz-d65';

type PolarColorSpace =
  | 'hsl'
  | 'hwb'
  | 'lch'
  | 'oklch';

export type HueInterpolationMethod =
  | 'shorter'
  | 'longer'
  | 'increasing'
  | 'decreasing';

export type ColorInterpolationMethod =
  | {
    space: RectangularColorSpace;
    hue?: never;
  }
  | {
    space: PolarColorSpace;
    hue?: HueInterpolationMethod;
  };

type ColorComponent = number | undefined;

type ColorComponents = [
  ColorComponent,
  ColorComponent,
  ColorComponent,
];

export type ColorBase =
  | HexColor
  | ColorFunction
  | NamedColor;

export type ColorFunction =
  | RgbColor
  | HslColor
  | HwbColor
  | LabColor
  | LchColor
  | OklabColor
  | OklchColor
  | PredefinedColor;

export enum ColorKind {
  Named = 1,
  CurrentColor,
  System,
  Deprecated,
  Hex,
  Rgb,
  Hsl,
  Hwb,
  Lab,
  Lch,
  Oklab,
  Oklch,
  Color,
  Absolute,
}

type AlphaValue = NumberValue | PercentageValue;
type HueValue = NumberValue | AngleValue;

export function parseColorValue(
  input: ParserInput,
  context: ColorResolutionContext = {},
): ColorValue | null {
  const result = parseAsComponentGrammar(
    input,
    withComponentTrivia(tryConsumeColor),
    context,
  );

  return result === null || isBad(result)
    ? null
    : result.value;
}

export function tryConsumeColor(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorValue> {
  const result = consumeColor(c);

  return result === null || isBad(result)
    ? result
    : ok(resolveColorValue(
      result.value,
      colorResolutionContextFor(c.context),
    ));
}

const consumeColor: TryComponentConsumer<ColorValue> = oneOf(
  [
    one(tryConsumeColorBase),
    one(tryConsumeCurrentColor),
    one(tryConsumeSystemColor),
    one(tryConsumeDeprecatedColor),
  ],
  ([value]) => ok(value),
);

function tryConsumeColorBase(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorBase> {
  return consumeColorBase(c);
}

const consumeColorBase: TryComponentConsumer<ColorBase> = oneOf(
  [
    one(tryConsumeHexColor),
    one(tryConsumeColorFunction),
    one(tryConsumeNamedColor),
  ],
  ([value]) => ok(value),
);

function tryConsumeColorFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFunction> {
  return consumeColorFunction(c);
}

const consumeColorFunction: TryComponentConsumer<ColorFunction> = oneOf(
  [
    one(tryConsumeRgbFunction),
    one(tryConsumeRgbaFunction),
    one(tryConsumeHslFunction),
    one(tryConsumeHslaFunction),
    one(tryConsumeHwbFunction),
    one(tryConsumeLabFunction),
    one(tryConsumeLchFunction),
    one(tryConsumeOklabFunction),
    one(tryConsumeOklchFunction),
    one(tryConsumeColorFunctionNotation),
  ],
  ([value]) => ok(value),
);

/*
 * <rgb()> = [ <legacy-rgb-syntax> | <modern-rgb-syntax> ]
 * <rgba()> = [ <legacy-rgba-syntax> | <modern-rgba-syntax> ]
 *
 * <legacy-rgb-syntax> = rgb( <percentage>#{3} , <alpha-value>? ) |
 *                       rgb( <number>#{3} , <alpha-value>? )
 * <legacy-rgba-syntax> = rgba( <percentage>#{3} , <alpha-value>? ) |
 *                        rgba( <number>#{3} , <alpha-value>? )
 *
 * <modern-rgb-syntax> = rgb(
 *   [ <number> | <percentage> | none ]{3}
 *   [ / [ <alpha-value> | none ] ]? )
 * <modern-rgba-syntax> = rgba(
 *   [ <number> | <percentage> | none ]{3}
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type RgbColor = {
  kind: ColorKind.Rgb;
  syntax: 'legacy' | 'modern';
  components: [RgbComponent, RgbComponent, RgbComponent];
  alpha?: AlphaValue | 'none';
};

type RgbComponent = NumberValue | PercentageValue | 'none';

function tryConsumeRgbFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbColor> {
  return consumeRgbFunction(c);
}

const consumeRgbFunction = createRgbFunctionConsumer('rgb');

function tryConsumeRgbaFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbColor> {
  return consumeRgbaFunction(c);
}

const consumeRgbaFunction = createRgbFunctionConsumer('rgba');

function createRgbFunctionConsumer(
  name: 'rgb' | 'rgba',
): TryComponentConsumer<RgbColor> {
  return createFunctionalNotationConsumer(
    name,
    tryConsumeRgbArguments,
    (color) => color,
  );
}

function tryConsumeRgbArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbColor> {
  return consumeRgbArguments(c);
}

const consumeRgbArguments: TryComponentConsumer<RgbColor> = oneOf(
  [
    one(tryConsumeLegacyPercentageRgbArguments),
    one(tryConsumeLegacyNumberRgbArguments),
    one(tryConsumeModernRgbArguments),
  ],
  ([source]) => ok(source),
);

function tryConsumeLegacyPercentageRgbArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbColor> {
  return consumeLegacyPercentageRgbArguments(c);
}

const consumeLegacyPercentageRgbArguments =
  createLegacyRgbArgumentsConsumer(tryConsumePercentage);

function tryConsumeLegacyNumberRgbArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbColor> {
  return consumeLegacyNumberRgbArguments(c);
}

const consumeLegacyNumberRgbArguments =
  createLegacyRgbArgumentsConsumer(tryConsumeNumber);

function createLegacyRgbArgumentsConsumer<
  Component extends NumberValue | PercentageValue,
>(
  tryConsumeComponent: TryComponentConsumer<Component>,
): TryComponentConsumer<RgbColor> {
  return sequenceOf(
    [
      commaRepeat(tryConsumeComponent, 3, 3),
      opt(tryConsumeLegacyAlpha),
    ],
    ([components, alpha]) => ok({
      kind: ColorKind.Rgb,
      syntax: 'legacy',
      components,
      alpha: alpha[0],
    }),
  );
}

function tryConsumeLegacyAlpha(
  c: ComponentCursor,
): TryComponentConsumerResult<AlphaValue> {
  return consumeLegacyAlpha(c);
}

const consumeLegacyAlpha: TryComponentConsumer<AlphaValue> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeComma)),
    one(withComponentTrivia(tryConsumeAlphaValue)),
  ],
  ([, [alpha]]) => ok(alpha),
);

function tryConsumeModernRgbArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbColor> {
  return consumeModernRgbArguments(c);
}

const consumeModernRgbArguments: TryComponentConsumer<RgbColor> = sequenceOf(
  [
    repeat(withComponentTrivia(tryConsumeRgbComponent), 3, 3),
    opt(tryConsumeModernAlpha),
  ],
  ([components, alpha]) => ok({
    kind: ColorKind.Rgb,
    syntax: 'modern',
    components,
    alpha: alpha[0],
  }),
);

function tryConsumeModernAlpha(
  c: ComponentCursor,
): TryComponentConsumerResult<AlphaValue | 'none'> {
  return consumeModernAlpha(c);
}

const consumeModernAlpha: TryComponentConsumer<AlphaValue | 'none'> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeSlash)),
    one(withComponentTrivia(tryConsumeAlphaOrNone)),
  ],
  ([, [alpha]]) => ok(alpha),
);

function tryConsumeRgbComponent(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbComponent> {
  return consumeRgbComponent(c);
}

const consumeRgbComponent: TryComponentConsumer<RgbComponent> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumePercentage),
    one(tryConsumeNone),
  ],
  ([component]) => ok(component),
);

function tryConsumeAlphaOrNone(
  c: ComponentCursor,
): TryComponentConsumerResult<AlphaValue | 'none'> {
  return consumeAlphaOrNone(c);
}

const consumeAlphaOrNone: TryComponentConsumer<AlphaValue | 'none'> = oneOf(
  [
    one(tryConsumeAlphaValue),
    one(tryConsumeNone),
  ],
  ([alpha]) => ok(alpha),
);

function tryConsumeAlphaValue(
  c: ComponentCursor,
): TryComponentConsumerResult<AlphaValue> {
  return consumeAlphaValue(c);
}

const consumeAlphaValue: TryComponentConsumer<AlphaValue> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumePercentage),
  ],
  ([alpha]) => ok(alpha),
);

function tryConsumeNone(
  c: ComponentCursor,
): TryComponentConsumerResult<'none'> {
  return consumeNone(c);
}

const consumeNone = createKeywordConsumer('none');

function tryConsumeSlash(
  c: ComponentCursor,
): TryComponentConsumerResult<'/'> {
  return consumeSlash(c);
}

const consumeSlash = createDelimConsumer('/');

function tryConsumeComma(
  c: ComponentCursor,
): TryComponentConsumerResult<','> {
  return c.match(TokenKind.Comma) ? ok(',') : null;
}

/*
 * <hex-color> = <hash-token> whose value consists of
 *               3, 4, 6, or 8 hexadecimal digits
 */

export type HexColor = {
  kind: ColorKind.Hex;
  text: string;
};

function tryConsumeHexColor(
  c: ComponentCursor,
): TryComponentConsumerResult<HexColor> {
  const start = c.pos();
  const result = tryConsumeHashToken(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const token = result.value;

  if (!isHexColorValue(token.value)) {
    c.restore(start);
    return null;
  }

  return ok({
    kind: ColorKind.Hex,
    text: `#${token.value}`,
  });
}

function isHexColorValue(value: string): boolean {
  return (
    [3, 4, 6, 8].includes(value.length) &&
    /^[\da-f]+$/i.test(value)
  );
}

/*
 * <named-color>
 *
 * Named colors are CSS identifiers with entries in ColorRgba.
 */

export type NamedColor = {
  kind: ColorKind.Named;
  name: ColorName;
};

export type ColorName = keyof typeof ColorRgba;

function tryConsumeNamedColor(
  c: ComponentCursor,
): TryComponentConsumerResult<NamedColor> {
  const start = c.pos();
  const ident = tryConsumeIdent(c);

  if (ident === null || isBad(ident)) {
    return ident;
  }

  const name = asciiLower(ident.value.value);
  const rgba = Object.hasOwn(ColorRgba, name)
    ? ColorRgba[name as keyof typeof ColorRgba]
    : undefined;

  if (rgba === undefined) {
    c.restore(start);
    return null;
  }

  return ok({
    kind: ColorKind.Named,
    name: name as ColorName,
  });
}

export const ColorRgba = {
  transparent: 0x00000000,
  aliceblue: opaque(0xf0f8ff),
  antiquewhite: opaque(0xfaebd7),
  aqua: opaque(0x00ffff),
  aquamarine: opaque(0x7fffd4),
  azure: opaque(0xf0ffff),
  beige: opaque(0xf5f5dc),
  bisque: opaque(0xffe4c4),
  black: opaque(0x000000),
  blanchedalmond: opaque(0xffebcd),
  blue: opaque(0x0000ff),
  blueviolet: opaque(0x8a2be2),
  brown: opaque(0xa52a2a),
  burlywood: opaque(0xdeb887),
  cadetblue: opaque(0x5f9ea0),
  chartreuse: opaque(0x7fff00),
  chocolate: opaque(0xd2691e),
  coral: opaque(0xff7f50),
  cornflowerblue: opaque(0x6495ed),
  cornsilk: opaque(0xfff8dc),
  crimson: opaque(0xdc143c),
  cyan: opaque(0x00ffff),
  darkblue: opaque(0x00008b),
  darkcyan: opaque(0x008b8b),
  darkgoldenrod: opaque(0xb8860b),
  darkgray: opaque(0xa9a9a9),
  darkgreen: opaque(0x006400),
  darkgrey: opaque(0xa9a9a9),
  darkkhaki: opaque(0xbdb76b),
  darkmagenta: opaque(0x8b008b),
  darkolivegreen: opaque(0x556b2f),
  darkorange: opaque(0xff8c00),
  darkorchid: opaque(0x9932cc),
  darkred: opaque(0x8b0000),
  darksalmon: opaque(0xe9967a),
  darkseagreen: opaque(0x8fbc8f),
  darkslateblue: opaque(0x483d8b),
  darkslategray: opaque(0x2f4f4f),
  darkslategrey: opaque(0x2f4f4f),
  darkturquoise: opaque(0x00ced1),
  darkviolet: opaque(0x9400d3),
  deeppink: opaque(0xff1493),
  deepskyblue: opaque(0x00bfff),
  dimgray: opaque(0x696969),
  dimgrey: opaque(0x696969),
  dodgerblue: opaque(0x1e90ff),
  firebrick: opaque(0xb22222),
  floralwhite: opaque(0xfffaf0),
  forestgreen: opaque(0x228b22),
  fuchsia: opaque(0xff00ff),
  gainsboro: opaque(0xdcdcdc),
  ghostwhite: opaque(0xf8f8ff),
  gold: opaque(0xffd700),
  goldenrod: opaque(0xdaa520),
  gray: opaque(0x808080),
  green: opaque(0x008000),
  greenyellow: opaque(0xadff2f),
  grey: opaque(0x808080),
  honeydew: opaque(0xf0fff0),
  hotpink: opaque(0xff69b4),
  indianred: opaque(0xcd5c5c),
  indigo: opaque(0x4b0082),
  ivory: opaque(0xfffff0),
  khaki: opaque(0xf0e68c),
  lavender: opaque(0xe6e6fa),
  lavenderblush: opaque(0xfff0f5),
  lawngreen: opaque(0x7cfc00),
  lemonchiffon: opaque(0xfffacd),
  lightblue: opaque(0xadd8e6),
  lightcoral: opaque(0xf08080),
  lightcyan: opaque(0xe0ffff),
  lightgoldenrodyellow: opaque(0xfafad2),
  lightgray: opaque(0xd3d3d3),
  lightgreen: opaque(0x90ee90),
  lightgrey: opaque(0xd3d3d3),
  lightpink: opaque(0xffb6c1),
  lightsalmon: opaque(0xffa07a),
  lightseagreen: opaque(0x20b2aa),
  lightskyblue: opaque(0x87cefa),
  lightslategray: opaque(0x778899),
  lightslategrey: opaque(0x778899),
  lightsteelblue: opaque(0xb0c4de),
  lightyellow: opaque(0xffffe0),
  lime: opaque(0x00ff00),
  limegreen: opaque(0x32cd32),
  linen: opaque(0xfaf0e6),
  magenta: opaque(0xff00ff),
  maroon: opaque(0x800000),
  mediumaquamarine: opaque(0x66cdaa),
  mediumblue: opaque(0x0000cd),
  mediumorchid: opaque(0xba55d3),
  mediumpurple: opaque(0x9370db),
  mediumseagreen: opaque(0x3cb371),
  mediumslateblue: opaque(0x7b68ee),
  mediumspringgreen: opaque(0x00fa9a),
  mediumturquoise: opaque(0x48d1cc),
  mediumvioletred: opaque(0xc71585),
  midnightblue: opaque(0x191970),
  mintcream: opaque(0xf5fffa),
  mistyrose: opaque(0xffe4e1),
  moccasin: opaque(0xffe4b5),
  navajowhite: opaque(0xffdead),
  navy: opaque(0x000080),
  oldlace: opaque(0xfdf5e6),
  olive: opaque(0x808000),
  olivedrab: opaque(0x6b8e23),
  orange: opaque(0xffa500),
  orangered: opaque(0xff4500),
  orchid: opaque(0xda70d6),
  palegoldenrod: opaque(0xeee8aa),
  palegreen: opaque(0x98fb98),
  paleturquoise: opaque(0xafeeee),
  palevioletred: opaque(0xdb7093),
  papayawhip: opaque(0xffefd5),
  peachpuff: opaque(0xffdab9),
  peru: opaque(0xcd853f),
  pink: opaque(0xffc0cb),
  plum: opaque(0xdda0dd),
  powderblue: opaque(0xb0e0e6),
  purple: opaque(0x800080),
  rebeccapurple: opaque(0x663399),
  red: opaque(0xff0000),
  rosybrown: opaque(0xbc8f8f),
  royalblue: opaque(0x4169e1),
  saddlebrown: opaque(0x8b4513),
  salmon: opaque(0xfa8072),
  sandybrown: opaque(0xf4a460),
  seagreen: opaque(0x2e8b57),
  seashell: opaque(0xfff5ee),
  sienna: opaque(0xa0522d),
  silver: opaque(0xc0c0c0),
  skyblue: opaque(0x87ceeb),
  slateblue: opaque(0x6a5acd),
  slategray: opaque(0x708090),
  slategrey: opaque(0x708090),
  snow: opaque(0xfffafa),
  springgreen: opaque(0x00ff7f),
  steelblue: opaque(0x4682b4),
  tan: opaque(0xd2b48c),
  teal: opaque(0x008080),
  thistle: opaque(0xd8bfd8),
  tomato: opaque(0xff6347),
  turquoise: opaque(0x40e0d0),
  violet: opaque(0xee82ee),
  wheat: opaque(0xf5deb3),
  white: opaque(0xffffff),
  whitesmoke: opaque(0xf5f5f5),
  yellow: opaque(0xffff00),
  yellowgreen: opaque(0x9acd32),
} as const satisfies Record<string, number>;

function opaque(rgb: number): number {
  return (((rgb & 0xffffff) << 8) | 0xff) >>> 0;
}

/*
 * <system-color>
 *
 * System colors are CSS identifiers listed in SystemColorNames.
 * This type includes the <deprecated-color> subtype defined separately below.
 */

export type SystemColor = {
  kind: ColorKind.System;
  name: SystemColorName;
};

export type SystemColorName = typeof SystemColorNames[number];

function tryConsumeSystemColor(
  c: ComponentCursor,
): TryComponentConsumerResult<SystemColor> {
  const start = c.pos();
  const ident = tryConsumeIdent(c);

  if (ident === null || isBad(ident)) {
    return ident;
  }

  const name = asciiLower(ident.value.value);

  if (!SystemColorNameSet.has(name)) {
    c.restore(start);
    return null;
  }

  return ok({
    kind: ColorKind.System,
    name: name as SystemColorName,
  });
}

const SystemColorNames = [
  'accentcolor', 'accentcolortext', 'activetext',
  'buttonborder', 'buttonface', 'buttontext',
  'canvas', 'canvastext',
  'field', 'fieldtext',
  'graytext',
  'highlight', 'highlighttext',
  'linktext',
  'mark', 'marktext',
  'selecteditem', 'selecteditemtext',
  'visitedtext',
] as const;

const SystemColorNameSet: ReadonlySet<string> = new Set(SystemColorNames);

/*
 * <deprecated-color>
 *
 * Deprecated system colors map to modern system colors at computed-value time.
 */

export type DeprecatedColor = {
  kind: ColorKind.Deprecated;
  name: DeprecatedColorName;
};

export type DeprecatedColorName = keyof typeof DeprecatedColorSystemName;

function tryConsumeDeprecatedColor(
  c: ComponentCursor,
): TryComponentConsumerResult<DeprecatedColor> {
  const start = c.pos();
  const ident = tryConsumeIdent(c);

  if (ident === null || isBad(ident)) {
    return ident;
  }

  const name = asciiLower(ident.value.value);

  if (!Object.hasOwn(DeprecatedColorSystemName, name)) {
    c.restore(start);
    return null;
  }

  return ok({
    kind: ColorKind.Deprecated,
    name: name as DeprecatedColorName,
  });
}

const DeprecatedColorSystemName = {
  activeborder: 'buttonborder',
  activecaption: 'canvas',
  appworkspace: 'canvas',
  background: 'canvas',
  buttonhighlight: 'buttonface',
  buttonshadow: 'buttonface',
  captiontext: 'canvastext',
  inactiveborder: 'buttonborder',
  inactivecaption: 'canvas',
  inactivecaptiontext: 'graytext',
  infobackground: 'canvas',
  infotext: 'canvastext',
  menu: 'canvas',
  menutext: 'canvastext',
  scrollbar: 'canvas',
  threedarkshadow: 'buttonborder',
  threedface: 'buttonface',
  threedhighlight: 'buttonborder',
  threedlightshadow: 'buttonborder',
  threedshadow: 'buttonborder',
  window: 'canvas',
  windowframe: 'buttonborder',
  windowtext: 'canvastext',
} as const satisfies Record<string, SystemColorName>;

/*
 * currentcolor
 */

export type CurrentColor = {
  kind: ColorKind.CurrentColor;
};

function tryConsumeCurrentColor(
  c: ComponentCursor,
): TryComponentConsumerResult<CurrentColor> {
  const keyword = tryConsumeCurrentColorKeyword(c);

  if (keyword === null || isBad(keyword)) {
    return keyword;
  }

  return ok({
    kind: ColorKind.CurrentColor,
  });
}

const tryConsumeCurrentColorKeyword = createKeywordConsumer('currentcolor');

/*
 * <hsl()> = [ <legacy-hsl-syntax> | <modern-hsl-syntax> ]
 * <hsla()> = [ <legacy-hsla-syntax> | <modern-hsla-syntax> ]
 *
 * <modern-hsl-syntax> = hsl(
 *   [ <hue> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 * <modern-hsla-syntax> = hsla(
 *   [ <hue> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 *
 * <legacy-hsl-syntax> =
 *   hsl( <hue>, <percentage>, <percentage>, <alpha-value>? )
 * <legacy-hsla-syntax> =
 *   hsla( <hue>, <percentage>, <percentage>, <alpha-value>? )
 */

export type HslColor = {
  kind: ColorKind.Hsl;
  syntax: 'legacy' | 'modern';
  hue: HueValue | 'none';
  saturation: HslComponent;
  lightness: HslComponent;
  alpha?: AlphaValue | 'none';
};

type HslComponent = NumberValue | PercentageValue | 'none';

function tryConsumeHslFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<HslColor> {
  return consumeHslFunction(c);
}

const consumeHslFunction = createHslFunctionConsumer('hsl');

function tryConsumeHslaFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<HslColor> {
  return consumeHslaFunction(c);
}

const consumeHslaFunction = createHslFunctionConsumer('hsla');

function createHslFunctionConsumer(
  name: 'hsl' | 'hsla',
): TryComponentConsumer<HslColor> {
  return createFunctionalNotationConsumer(
    name,
    tryConsumeHslArguments,
    (color) => color,
  );
}

function tryConsumeHslArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<HslColor> {
  return consumeHslArguments(c);
}

const consumeHslArguments: TryComponentConsumer<HslColor> = oneOf(
  [
    one(tryConsumeLegacyHslArguments),
    one(tryConsumeModernHslArguments),
  ],
  ([source]) => ok(source),
);

function tryConsumeLegacyHslArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<HslColor> {
  return consumeLegacyHslArguments(c);
}

const consumeLegacyHslArguments: TryComponentConsumer<HslColor> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeHue)),
    one(tryConsumeLegacyHslPercentage),
    one(tryConsumeLegacyHslPercentage),
    opt(tryConsumeLegacyAlpha),
  ],
  ([[hue], [saturation], [lightness], alpha]) => ok({
    kind: ColorKind.Hsl,
    syntax: 'legacy',
    hue,
    saturation,
    lightness,
    alpha: alpha[0],
  }),
);

function tryConsumeLegacyHslPercentage(
  c: ComponentCursor,
): TryComponentConsumerResult<PercentageValue> {
  return consumeLegacyHslPercentage(c);
}

const consumeLegacyHslPercentage: TryComponentConsumer<PercentageValue> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeComma)),
    one(withComponentTrivia(tryConsumePercentage)),
  ],
  ([, [percentage]]) => ok(percentage),
);

function tryConsumeModernHslArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<HslColor> {
  return consumeModernHslArguments(c);
}

const consumeModernHslArguments: TryComponentConsumer<HslColor> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeHueOrNone)),
    one(withComponentTrivia(tryConsumeHslComponent)),
    one(withComponentTrivia(tryConsumeHslComponent)),
    opt(tryConsumeModernAlpha),
  ],
  ([[hue], [saturation], [lightness], alpha]) => ok({
    kind: ColorKind.Hsl,
    syntax: 'modern',
    hue,
    saturation,
    lightness,
    alpha: alpha[0],
  }),
);

function tryConsumeHueOrNone(
  c: ComponentCursor,
): TryComponentConsumerResult<HueValue | 'none'> {
  return consumeHueOrNone(c);
}

const consumeHueOrNone: TryComponentConsumer<HueValue | 'none'> = oneOf(
  [
    one(tryConsumeHue),
    one(tryConsumeNone),
  ],
  ([hue]) => ok(hue),
);

function tryConsumeHue(
  c: ComponentCursor,
): TryComponentConsumerResult<HueValue> {
  return consumeHue(c);
}

const consumeHue: TryComponentConsumer<HueValue> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumeAngle),
  ],
  ([hue]) => ok(hue),
);

function tryConsumeHslComponent(
  c: ComponentCursor,
): TryComponentConsumerResult<HslComponent> {
  return consumeHslComponent(c);
}

const consumeHslComponent: TryComponentConsumer<HslComponent> = oneOf(
  [
    one(tryConsumePercentage),
    one(tryConsumeNumber),
    one(tryConsumeNone),
  ],
  ([component]) => ok(component),
);

/*
 * <hwb()> = hwb(
 *   [ <hue> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type HwbColor = {
  kind: ColorKind.Hwb;
  hue: HueValue | 'none';
  whiteness: HwbComponent;
  blackness: HwbComponent;
  alpha?: AlphaValue | 'none';
};

type HwbComponent = NumberValue | PercentageValue | 'none';

function tryConsumeHwbFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<HwbColor> {
  return consumeHwbFunction(c);
}

const consumeHwbFunction = createFunctionalNotationConsumer(
  'hwb',
  tryConsumeHwbArguments,
  (color) => color,
);

function tryConsumeHwbArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<HwbColor> {
  return consumeHwbArguments(c);
}

const consumeHwbArguments: TryComponentConsumer<HwbColor> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeHueOrNone)),
    one(withComponentTrivia(tryConsumeHwbComponent)),
    one(withComponentTrivia(tryConsumeHwbComponent)),
    opt(tryConsumeModernAlpha),
  ],
  ([[hue], [whiteness], [blackness], alpha]) => ok({
    kind: ColorKind.Hwb,
    hue,
    whiteness,
    blackness,
    alpha: alpha[0],
  }),
);

function tryConsumeHwbComponent(
  c: ComponentCursor,
): TryComponentConsumerResult<HwbComponent> {
  return consumeHwbComponent(c);
}

const consumeHwbComponent: TryComponentConsumer<HwbComponent> = oneOf(
  [
    one(tryConsumePercentage),
    one(tryConsumeNumber),
    one(tryConsumeNone),
  ],
  ([component]) => ok(component),
);

/*
 * <lab()> = lab(
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 *
 * <oklab()> = oklab(
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type LabColor = {
  kind: ColorKind.Lab;
  lightness: LabComponent;
  a: LabComponent;
  b: LabComponent;
  alpha?: AlphaValue | 'none';
};

export type OklabColor = {
  kind: ColorKind.Oklab;
  lightness: LabComponent;
  a: LabComponent;
  b: LabComponent;
  alpha?: AlphaValue | 'none';
};

type LabComponent = NumberValue | PercentageValue | 'none';

type LabArguments = {
  lightness: LabComponent;
  a: LabComponent;
  b: LabComponent;
  alpha?: AlphaValue | 'none';
};

function tryConsumeLabFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<LabColor> {
  return consumeLabFunction(c);
}

const consumeLabFunction: TryComponentConsumer<LabColor> =
  createFunctionalNotationConsumer(
    'lab',
    tryConsumeLabArguments,
    (arguments_) => ({
      kind: ColorKind.Lab,
      ...arguments_,
    }),
  );

function tryConsumeOklabFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<OklabColor> {
  return consumeOklabFunction(c);
}

const consumeOklabFunction: TryComponentConsumer<OklabColor> =
  createFunctionalNotationConsumer(
    'oklab',
    tryConsumeLabArguments,
    (arguments_) => ({
      kind: ColorKind.Oklab,
      ...arguments_,
    }),
  );

function tryConsumeLabArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<LabArguments> {
  return consumeLabArguments(c);
}

const consumeLabArguments: TryComponentConsumer<LabArguments> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeLabComponent)),
    one(withComponentTrivia(tryConsumeLabComponent)),
    one(withComponentTrivia(tryConsumeLabComponent)),
    opt(tryConsumeModernAlpha),
  ],
  ([[lightness], [a], [b], alpha]) => ok({
    lightness,
    a,
    b,
    alpha: alpha[0],
  }),
);

function tryConsumeLabComponent(
  c: ComponentCursor,
): TryComponentConsumerResult<LabComponent> {
  return consumeLabComponent(c);
}

const consumeLabComponent: TryComponentConsumer<LabComponent> = oneOf(
  [
    one(tryConsumePercentage),
    one(tryConsumeNumber),
    one(tryConsumeNone),
  ],
  ([component]) => ok(component),
);

/*
 * <lch()> = lch(
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <hue> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 *
 * <oklch()> = oklch(
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <hue> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type LchColor = {
  kind: ColorKind.Lch;
  lightness: LchComponent;
  chroma: LchComponent;
  hue: HueValue | 'none';
  alpha?: AlphaValue | 'none';
};

export type OklchColor = {
  kind: ColorKind.Oklch;
  lightness: LchComponent;
  chroma: LchComponent;
  hue: HueValue | 'none';
  alpha?: AlphaValue | 'none';
};

type LchComponent = NumberValue | PercentageValue | 'none';

type LchArguments = {
  lightness: LchComponent;
  chroma: LchComponent;
  hue: HueValue | 'none';
  alpha?: AlphaValue | 'none';
};

function tryConsumeLchFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<LchColor> {
  return consumeLchFunction(c);
}

const consumeLchFunction: TryComponentConsumer<LchColor> =
  createFunctionalNotationConsumer(
    'lch',
    tryConsumeLchArguments,
    (arguments_) => ({
      kind: ColorKind.Lch,
      ...arguments_,
    }),
  );

function tryConsumeOklchFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<OklchColor> {
  return consumeOklchFunction(c);
}

const consumeOklchFunction: TryComponentConsumer<OklchColor> =
  createFunctionalNotationConsumer(
    'oklch',
    tryConsumeLchArguments,
    (arguments_) => ({
      kind: ColorKind.Oklch,
      ...arguments_,
    }),
  );

function tryConsumeLchArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<LchArguments> {
  return consumeLchArguments(c);
}

const consumeLchArguments: TryComponentConsumer<LchArguments> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeLchComponent)),
    one(withComponentTrivia(tryConsumeLchComponent)),
    one(withComponentTrivia(tryConsumeHueOrNone)),
    opt(tryConsumeModernAlpha),
  ],
  ([[lightness], [chroma], [hue], alpha]) => ok({
    lightness,
    chroma,
    hue,
    alpha: alpha[0],
  }),
);

function tryConsumeLchComponent(
  c: ComponentCursor,
): TryComponentConsumerResult<LchComponent> {
  return consumeLchComponent(c);
}

const consumeLchComponent: TryComponentConsumer<LchComponent> = oneOf(
  [
    one(tryConsumePercentage),
    one(tryConsumeNumber),
    one(tryConsumeNone),
  ],
  ([component]) => ok(component),
);

/*
 * <color()> = color( <colorspace-params>
 *                    [ / [ <alpha-value> | none ] ]? )
 *
 * <colorspace-params> = [ <predefined-rgb-params> | <xyz-params> ]
 *
 * <predefined-rgb-params> =
 *   <predefined-rgb> [ <number> | <percentage> | none ]{3}
 *
 * <predefined-rgb> = srgb | srgb-linear |
 *                    display-p3 | display-p3-linear |
 *                    a98-rgb | prophoto-rgb | rec2020
 *
 * <xyz-params> = <xyz-space> [ <number> | <percentage> | none ]{3}
 * <xyz-space> = xyz | xyz-d50 | xyz-d65
 */

export type PredefinedColor = {
  kind: ColorKind.Color;
  space: PredefinedColorSpace;
  components: ColorFunctionComponents;
  alpha?: AlphaValue | 'none';
};

type PredefinedColorSpace = PredefinedRgb | XyzSpace;

type PredefinedRgb =
  | 'srgb'
  | 'srgb-linear'
  | 'display-p3'
  | 'display-p3-linear'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020';

type XyzSpace = 'xyz' | 'xyz-d50' | 'xyz-d65';

type ColorFunctionComponent = NumberValue | PercentageValue | 'none';

type ColorFunctionComponents = [
  ColorFunctionComponent,
  ColorFunctionComponent,
  ColorFunctionComponent,
];

type ColorSpaceParams = {
  space: PredefinedColorSpace;
  components: ColorFunctionComponents;
};

function tryConsumeColorFunctionNotation(
  c: ComponentCursor,
): TryComponentConsumerResult<PredefinedColor> {
  return consumeColorFunctionNotation(c);
}

const consumeColorFunctionNotation: TryComponentConsumer<PredefinedColor> =
  createFunctionalNotationConsumer(
    'color',
    tryConsumeColorFunctionArguments,
    (color) => color,
  );

function tryConsumeColorFunctionArguments(
  c: ComponentCursor,
): TryComponentConsumerResult<PredefinedColor> {
  return consumeColorFunctionArguments(c);
}

const consumeColorFunctionArguments: TryComponentConsumer<PredefinedColor> =
  sequenceOf(
    [
      one(tryConsumeColorSpaceParams),
      opt(tryConsumeModernAlpha),
    ],
    ([[params], alpha]) => ok({
      kind: ColorKind.Color,
      ...params,
      alpha: alpha[0],
    }),
  );

function tryConsumeColorSpaceParams(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorSpaceParams> {
  return consumeColorSpaceParams(c);
}

const consumeColorSpaceParams: TryComponentConsumer<ColorSpaceParams> = oneOf(
  [
    one(tryConsumePredefinedRgbParams),
    one(tryConsumeXyzParams),
  ],
  ([params]) => ok(params),
);

function tryConsumePredefinedRgbParams(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorSpaceParams> {
  return consumePredefinedRgbParams(c);
}

const consumePredefinedRgbParams: TryComponentConsumer<ColorSpaceParams> =
  sequenceOf(
    [
      one(withComponentTrivia(tryConsumePredefinedRgb)),
      repeat(withComponentTrivia(tryConsumeColorFunctionComponent), 3, 3),
    ],
    ([[space], components]) => ok({
      space,
      components,
    }),
  );

function tryConsumePredefinedRgb(
  c: ComponentCursor,
): TryComponentConsumerResult<PredefinedRgb> {
  return consumePredefinedRgb(c);
}

const consumePredefinedRgb = createKeywordConsumer(
  'srgb',
  'srgb-linear',
  'display-p3',
  'display-p3-linear',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
);

function tryConsumeXyzParams(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorSpaceParams> {
  return consumeXyzParams(c);
}

const consumeXyzParams: TryComponentConsumer<ColorSpaceParams> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeXyzSpace)),
    repeat(withComponentTrivia(tryConsumeColorFunctionComponent), 3, 3),
  ],
  ([[space], components]) => ok({
    space,
    components,
  }),
);

function tryConsumeXyzSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<XyzSpace> {
  return consumeXyzSpace(c);
}

const consumeXyzSpace = createKeywordConsumer('xyz', 'xyz-d50', 'xyz-d65');

function tryConsumeColorFunctionComponent(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFunctionComponent> {
  return consumeColorFunctionComponent(c);
}

const consumeColorFunctionComponent: TryComponentConsumer<ColorFunctionComponent> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumePercentage),
    one(tryConsumeNone),
  ],
  ([component]) => ok(component),
);

/*
 * <color-space> = <rectangular-color-space> | <polar-color-space>
 *
 * <rectangular-color-space> = srgb | srgb-linear |
 *                             display-p3 | display-p3-linear |
 *                             a98-rgb | prophoto-rgb | rec2020 |
 *                             lab | oklab | <xyz-space>
 *
 * <polar-color-space> = hsl | hwb | lch | oklch
 *
 * <hue-interpolation-method> =
 *   [ shorter | longer | increasing | decreasing ] hue
 *
 * <color-interpolation-method> =
 *   in [ <rectangular-color-space> |
 *        <polar-color-space> <hue-interpolation-method>? ]
 */

export function parseColorInterpolationMethod(
  input: ParserInput,
  context: unknown = undefined,
): ColorInterpolationMethod | null {
  const result = parseAsComponentGrammar(
    input,
    withComponentTrivia(tryConsumeColorInterpolationMethod),
    context,
  );

  return result === null || isBad(result) ? null : result.value;
}

export function tryConsumeColorInterpolationMethod(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorInterpolationMethod> {
  return consumeColorInterpolationMethod(c);
}

const consumeColorInterpolationMethod: TryComponentConsumer<ColorInterpolationMethod> =
  sequenceOf(
    [
      one(createKeywordConsumer('in')),
      one(withComponentTrivia(tryConsumeColorInterpolationSpace)),
    ],
    ([, [method]]) => ok(method),
  );

function tryConsumeColorInterpolationSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorInterpolationMethod> {
  return consumeColorInterpolationSpace(c);
}

const consumeColorInterpolationSpace: TryComponentConsumer<ColorInterpolationMethod> =
  oneOf(
    [
      one(tryConsumeRectangularColorSpace),
      one(tryConsumePolarColorInterpolation),
    ],
    ([value]) => ok(typeof value === 'string' ? { space: value } : value),
  );

function tryConsumeRectangularColorSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<RectangularColorSpace> {
  const result = consumeRectangularColorSpace(c);

  return result === null || isBad(result)
    ? result
    : ok(result.value === 'xyz' ? 'xyz-d65' : result.value);
}

const consumeRectangularColorSpace = createKeywordConsumer(
  'srgb',
  'srgb-linear',
  'display-p3',
  'display-p3-linear',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'lab',
  'oklab',
  'xyz',
  'xyz-d50',
  'xyz-d65',
);

function tryConsumePolarColorInterpolation(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorInterpolationMethod> {
  return consumePolarColorInterpolation(c);
}

const consumePolarColorInterpolation: TryComponentConsumer<ColorInterpolationMethod> =
  sequenceOf(
    [
      one(tryConsumePolarColorSpace),
      opt(withComponentTrivia(tryConsumeHueInterpolationMethod)),
    ],
    ([[space], hue]) => ok({
      space,
      hue: hue[0],
    }),
  );

function tryConsumePolarColorSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<PolarColorSpace> {
  return consumePolarColorSpace(c);
}

const consumePolarColorSpace =
  createKeywordConsumer('hsl', 'hwb', 'lch', 'oklch');

function tryConsumeHueInterpolationMethod(
  c: ComponentCursor,
): TryComponentConsumerResult<HueInterpolationMethod> {
  return consumeHueInterpolationMethod(c);
}

const consumeHueInterpolationMethod: TryComponentConsumer<HueInterpolationMethod> =
  sequenceOf(
    [
      one(createKeywordConsumer(
        'shorter',
        'longer',
        'increasing',
        'decreasing',
      )),
      one(withComponentTrivia(createKeywordConsumer('hue'))),
    ],
    ([[method]]) => ok(method),
  );



// ████████  ████████  ██████   ███████  ██       ██     ██ ████████
// ██     ██ ██       ██    ██ ██     ██ ██       ██     ██ ██
// ██     ██ ██       ██       ██     ██ ██       ██     ██ ██
// ████████  ██████    ██████  ██     ██ ██       ██     ██ ██████
// ██   ██   ██             ██ ██     ██ ██        ██   ██  ██
// ██    ██  ██       ██    ██ ██     ██ ██         ██ ██   ██
// ██     ██ ████████  ██████   ███████  ████████    ███    ████████

export function resolveColorValue(
  value: ColorValue,
  context: ColorResolutionContext = {},
): ColorValue {
  const stage = context.stage ?? 'declared';

  switch (value.kind) {
    case ColorKind.Absolute:
      return value;
    case ColorKind.Named:
      return isComputedColorStage(stage)
        ? resolveNamedColor(value)
        : value;
    case ColorKind.CurrentColor:
      return isUsedColorStage(stage)
        ? context.currentColor ?? value
        : value;
    case ColorKind.System:
      return isComputedColorStage(stage)
        ? context.systemColors?.get(value.name) ?? value
        : value;
    case ColorKind.Deprecated: {
      if (!isComputedColorStage(stage)) {
        return value;
      }

      const system: SystemColor = {
        kind: ColorKind.System,
        name: DeprecatedColorSystemName[value.name],
      };

      return context.systemColors?.get(system.name) ?? system;
    }
    case ColorKind.Hex:
      return resolveHexColor(value);
    case ColorKind.Rgb:
    case ColorKind.Hsl:
    case ColorKind.Hwb:
    case ColorKind.Lab:
    case ColorKind.Lch:
    case ColorKind.Oklab:
    case ColorKind.Oklch:
    case ColorKind.Color:
      return resolveColorFunction(value, context);
    default:
      return assertNever(value);
  }
}

export type ColorResolutionContext = MathContext & {
  currentColor?: AbsoluteColor;
  systemColors?: ReadonlyMap<SystemColorName, AbsoluteColor>;
};

function isComputedColorStage(stage: ValueStage): boolean {
  return isAtOrBeyondValueStage(stage, 'computed');
}

function isUsedColorStage(stage: ValueStage): boolean {
  return isAtOrBeyondValueStage(stage, 'used');
}

function resolveNamedColor(value: NamedColor): AbsoluteColor {
  return absoluteColorFromRgba(ColorRgba[value.name]);
}

function resolveHexColor(value: HexColor): AbsoluteColor {
  const text = value.text.slice(1);
  const expanded = text.length <= 4
    ? [...text].map((digit) => digit.repeat(2)).join('')
    : text;
  const rgba = expanded.length === 6
    ? ((Number.parseInt(expanded, 16) << 8) | 0xff) >>> 0
    : Number.parseInt(expanded, 16) >>> 0;

  return absoluteColorFromRgba(rgba);
}

function resolveColorFunction(
  value: ColorFunction,
  context: ColorResolutionContext,
): ColorValue {
  const resolvedAlpha = resolveColorAlphaValue(value.alpha, context);
  const alpha = absoluteColorAlpha(resolvedAlpha);

  if (alpha === null) {
    return resolvedAlpha === value.alpha
      ? value
      : { ...value, alpha: resolvedAlpha };
  }

  let absolute: AbsoluteColor | null;

  switch (value.kind) {
    case ColorKind.Rgb:
      absolute = resolveRgbColor(value, alpha, context);
      break;
    case ColorKind.Hsl:
      absolute = resolveHslColor(value, alpha, context);
      break;
    case ColorKind.Hwb:
      absolute = resolveHwbColor(value, alpha, context);
      break;
    case ColorKind.Lab:
      absolute = resolveLabColor(value, alpha, context, false);
      break;
    case ColorKind.Oklab:
      absolute = resolveLabColor(value, alpha, context, true);
      break;
    case ColorKind.Lch:
      absolute = resolveLchColor(value, alpha, context, false);
      break;
    case ColorKind.Oklch:
      absolute = resolveLchColor(value, alpha, context, true);
      break;
    case ColorKind.Color:
      absolute = resolvePredefinedColor(value, alpha, context);
      break;
    default:
      return assertNever(value);
  }

  return absolute === null
    ? value
    : absolute;
}

function resolveRgbColor(
  value: RgbColor,
  alpha: number | undefined,
  context: MathContext,
): AbsoluteColor | null {
  const { components: values } = value;

  if (alpha === 1 && is8BitRgbComponents(values)) {
    return {
      kind: ColorKind.Absolute,
      space: 'srgb-legacy',
      components: values.map(
        (component) => component.value,
      ) as ColorComponents,
      alpha: 0xff,
      is8Bit: true,
    };
  }

  const components = resolveColorComponents(
    values,
    1 / 0xff,
    1 / 100,
    context,
  );

  if (components === null) {
    return null;
  }

  const clamped = clampColorComponents(
    components,
    [[0, 1], [0, 1], [0, 1]],
    context,
    'declared',
  );

  if (clamped === null) {
    return null;
  }

  return {
    kind: ColorKind.Absolute,
    space: 'srgb-legacy',
    components: clamped,
    alpha,
  };
}

function is8BitRgbComponents(
  values: RgbColor['components'],
): values is [NumberLiteral, NumberLiteral, NumberLiteral] {
  return values.every(is8BitRgbComponent);
}

function is8BitRgbComponent(
  value: RgbComponent,
): value is NumberLiteral {
  return (
    value !== 'none' &&
    value.type === 'number' &&
    Number.isInteger(value.value) &&
    value.value >= 0 &&
    value.value <= 0xff
  );
}

function resolveHslColor(
  value: HslColor,
  alpha: number | undefined,
  context: MathContext,
): AbsoluteColor | null {
  const hue = resolveHue(value.hue, context);
  const components = resolveColorComponents(
    [value.saturation, value.lightness],
    1,
    1,
    context,
  );

  if (hue === null || components === null) {
    return null;
  }

  const clamped = clampColorComponents(
    [hue, ...components],
    [null, [0, Infinity], null],
    context,
    'declared',
  );

  if (clamped === null) {
    return null;
  }

  const [rawHue, saturation, lightness] = clamped;
  const absolute: AbsoluteColor = {
    kind: ColorKind.Absolute,
    space: 'hsl',
    components: [
      rawHue === undefined ? rawHue : normalizeHue(rawHue),
      saturation,
      lightness,
    ],
    alpha,
  };

  return hasMissingColorComponent(absolute)
    ? absolute
    : convertAbsoluteColor(absolute, 'srgb-legacy');
}

function resolveHwbColor(
  value: HwbColor,
  alpha: number | undefined,
  context: MathContext,
): AbsoluteColor | null {
  const hue = resolveHue(value.hue, context);
  const components = resolveColorComponents(
    [value.whiteness, value.blackness],
    1,
    1,
    context,
  );

  if (hue === null || components === null) {
    return null;
  }

  const clamped = clampColorComponents(
    [hue, ...components],
    [null, null, null],
    context,
    'declared',
  );

  if (clamped === null) {
    return null;
  }

  const [rawHue, whiteness, blackness] = clamped;
  const absolute: AbsoluteColor = {
    kind: ColorKind.Absolute,
    space: 'hwb',
    components: [
      rawHue === undefined ? rawHue : normalizeHue(rawHue),
      whiteness,
      blackness,
    ],
    alpha,
  };

  return hasMissingColorComponent(absolute)
    ? absolute
    : convertAbsoluteColor(absolute, 'srgb-legacy');
}

function resolveLabColor(
  value: LabColor | OklabColor,
  alpha: number | undefined,
  context: MathContext,
  ok: boolean,
): AbsoluteColor | null {
  const components = resolveColorComponents(
    [value.lightness, value.a, value.b],
    1,
    ok ? [1 / 100, 0.4 / 100, 0.4 / 100] : [1, 1.25, 1.25],
    context,
  );

  if (components === null) {
    return null;
  }

  const clamped = clampColorComponents(
    components,
    [[0, ok ? 1 : 100], null, null],
    context,
  );

  if (clamped === null) {
    return null;
  }

  return {
    kind: ColorKind.Absolute,
    space: ok ? 'oklab' : 'lab',
    components: clamped,
    alpha,
  };
}

function resolveLchColor(
  value: LchColor | OklchColor,
  alpha: number | undefined,
  context: MathContext,
  ok: boolean,
): AbsoluteColor | null {
  const components = resolveColorComponents(
    [value.lightness, value.chroma],
    1,
    ok ? [1 / 100, 0.4 / 100] : [1, 1.5],
    context,
  );
  const hue = resolveHue(value.hue, context);

  if (components === null || hue === null) {
    return null;
  }

  const resolved: ColorComponents = [...components, hue];
  const clamped = clampColorComponents(
    resolved,
    [[0, ok ? 1 : 100], [0, Infinity], null],
    context,
  );

  if (clamped === null) {
    return null;
  }

  const [lightness, chroma, rawHue] = clamped;

  return {
    kind: ColorKind.Absolute,
    space: ok ? 'oklch' : 'lch',
    components: [
      lightness,
      chroma,
      rawHue === undefined ? rawHue : normalizeHue(rawHue),
    ],
    alpha,
  };
}

function resolvePredefinedColor(
  value: PredefinedColor,
  alpha: number | undefined,
  context: MathContext,
): AbsoluteColor | null {
  const components = resolveColorComponents(
    value.components,
    1,
    1 / 100,
    context,
  );

  if (components === null) {
    return null;
  }

  const clamped = clampColorComponents(
    components,
    [null, null, null],
    context,
  );

  if (clamped === null) {
    return null;
  }

  return {
    kind: ColorKind.Absolute,
    space: value.space === 'xyz' ? 'xyz-d65' : value.space,
    components: clamped,
    alpha,
  };
}

function resolveColorComponents<
  const Values extends (NumberValue | PercentageValue | 'none')[],
>(
  values: Values,
  numberScale: number | readonly number[],
  percentageScale: number | readonly number[],
  context: MathContext,
): { [Index in keyof Values]: ColorComponent } | null {
  const components: ColorComponent[] = [];

  for (const [index, value] of values.entries()) {
    const component = resolveColorComponent(
      value,
      scaleAt(numberScale, index),
      scaleAt(percentageScale, index),
      context,
    );

    if (component === null) {
      return null;
    }

    components.push(component);
  }

  return components as { [Index in keyof Values]: ColorComponent };
}

function resolveColorComponent(
  value: NumberValue | PercentageValue | 'none',
  numberScale: number,
  percentageScale: number,
  context: MathContext,
): ColorComponent | null {
  if (value === 'none') {
    return undefined;
  }

  const resolved = resolveColorNumericValue(value, context, 'declared');

  if (resolved.type === 'math') {
    return null;
  }

  return resolved.type === 'percentage'
    ? resolved.value * percentageScale
    : resolved.value * numberScale;
}

function resolveColorAlphaValue(
  value: AlphaValue | 'none' | undefined,
  context: ColorResolutionContext,
): AlphaValue | 'none' | undefined {
  if (value === undefined || value === 'none') {
    return value;
  }

  const calculationContext = colorCalculationContext(context, 'computed');

  if (isNumberValue(value)) {
    return resolveNumber(value, calculationContext);
  }

  const resolved = resolvePercentage(value, calculationContext);

  return resolved.type === 'math'
    ? tryCoercePercentageToNumber(resolved) ?? resolved
    : resolved;
}

function absoluteColorAlpha(
  value: AlphaValue | 'none' | undefined,
): number | undefined | null {
  if (value === undefined) {
    return 1;
  }

  if (value === 'none') {
    return undefined;
  }

  if (value.type === 'math') {
    return null;
  }

  const alpha = value.type === 'percentage'
    ? value.value / 100
    : value.value;
  const clampableAlpha = Number.isNaN(alpha) || Object.is(alpha, -0)
    ? 0
    : alpha;

  return clamp(clampableAlpha, 0, 1);
}

function resolveHue(
  value: HueValue | 'none',
  context: MathContext,
): ColorComponent | null {
  if (value === 'none') {
    return undefined;
  }

  const calculationContext = colorCalculationContext(context, 'declared');
  const resolved = isNumberValue(value)
    ? resolveNumber(value, calculationContext)
    : resolveAngle(value, calculationContext);

  if (resolved.type === 'math') {
    return null;
  }

  return resolved.type === 'angle'
    ? resolveAngleLiteral(resolved).value
    : resolved.value;
}

function resolveColorNumericValue(
  value: NumberValue | PercentageValue,
  context: MathContext,
  unwrapMathAt: ValueStage,
): NumberValue | PercentageValue {
  const calculationContext = colorCalculationContext(
    context,
    unwrapMathAt,
  );

  return isNumberValue(value)
    ? resolveNumber(value, calculationContext)
    : resolvePercentage(value, calculationContext);
}

function colorCalculationContext(
  context: MathContext,
  unwrapMathAt: ValueStage,
): MathContext {
  return {
    ...context,
    unwrapMathAt: context.unwrapMathAt ?? unwrapMathAt,
  };
}

function isNumberValue(
  value: NumberValue | PercentageValue | AngleValue,
): value is NumberValue {
  return value.type === 'number' ||
    (value.type === 'math' && value.valueType === 'number');
}

type ColorComponentRange = [
  minimum: number,
  maximum: number,
];

type ColorComponentRanges = [
  ColorComponentRange | null,
  ColorComponentRange | null,
  ColorComponentRange | null,
];

function clampColorComponents(
  components: ColorComponents,
  ranges: ColorComponentRanges,
  context: MathContext,
  nonFiniteClampStage: ValueStage = 'computed',
): ColorComponents | null {
  if (
    !isAtOrBeyondValueStage(
      context.stage ?? 'declared',
      nonFiniteClampStage,
    ) &&
    components.some(
      (component) => component !== undefined && !Number.isFinite(component),
    )
  ) {
    return null;
  }

  return components.map(
    (component, index) => {
      if (component === undefined) {
        return component;
      }

      const clampable = Number.isNaN(component) || Object.is(component, -0)
        ? 0
        : component;
      const range = ranges[index] ?? null;

      return range === null
        ? clampable
        : clamp(clampable, ...range);
    },
  ) as ColorComponents;
}

function normalizeHue(value: number): number {
  return Number.isFinite(value)
    ? ((value % 360) + 360) % 360
    : 0;
}

function hasMissingColorComponent(value: AbsoluteColor): boolean {
  return value.alpha === undefined ||
    value.components.some((component) => component === undefined);
}

function scaleAt(
  scale: number | readonly number[],
  index: number,
): number {
  return typeof scale === 'number' ? scale : scale[index]!;
}

function absoluteColorFromRgba(rgba: number): AbsoluteColor {
  return {
    kind: ColorKind.Absolute,
    space: 'srgb-legacy',
    components: [
      rgba >>> 24,
      (rgba >>> 16) & 0xff,
      (rgba >>> 8) & 0xff,
    ],
    alpha: rgba & 0xff,
    is8Bit: true,
  };
}

function colorResolutionContextFor(context: unknown): ColorResolutionContext {
  return context === null || context === undefined
    ? {}
    : context;
}



//  ██████  ████████ ████████  ████    ███    ██
// ██    ██ ██       ██     ██  ██    ██ ██   ██
// ██       ██       ██     ██  ██   ██   ██  ██
//  ██████  ██████   ████████   ██  ██     ██ ██
//       ██ ██       ██   ██    ██  █████████ ██
// ██    ██ ██       ██    ██   ██  ██     ██ ██
//  ██████  ████████ ██     ██ ████ ██     ██ ████████

export function serializeColorValue(
  value: ColorValue,
  htmlCompatible = false,
): string {
  switch (value.kind) {
    case ColorKind.Absolute:
      return serializeAbsoluteColor(value, htmlCompatible);
    case ColorKind.Hex:
      throw new TypeError('Hex colors must be resolved before serialization');
    case ColorKind.Rgb:
    case ColorKind.Hsl:
    case ColorKind.Hwb:
    case ColorKind.Lab:
    case ColorKind.Lch:
    case ColorKind.Oklab:
    case ColorKind.Oklch:
    case ColorKind.Color:
      return serializeColorFunction(value);
    case ColorKind.Named:
      return value.name;
    case ColorKind.CurrentColor:
      return 'currentcolor';
    case ColorKind.System:
    case ColorKind.Deprecated:
      return value.name;
    default:
      return assertNever(value);
  }
}

function serializeColorFunction(
  value: ColorFunction,
): string {
  switch (value.kind) {
    case ColorKind.Rgb:
      return serializeRgbColor(value);
    case ColorKind.Hsl:
      return serializeHslColor(value);
    case ColorKind.Hwb:
      return serializeModernColorFunction(
        'hwb',
        [
          serializeHue(value.hue),
          serializeColorComponent(value.whiteness, 100),
          serializeColorComponent(value.blackness, 100),
        ],
        value.alpha,
      );
    case ColorKind.Lab:
    case ColorKind.Oklab: {
      const oklab = value.kind === ColorKind.Oklab;

      return serializeModernColorFunction(
        oklab ? 'oklab' : 'lab',
        [
          serializeColorComponent(value.lightness, oklab ? 1 : 100),
          serializeColorComponent(value.a, oklab ? 0.4 : 125),
          serializeColorComponent(value.b, oklab ? 0.4 : 125),
        ],
        value.alpha,
      );
    }
    case ColorKind.Lch:
    case ColorKind.Oklch: {
      const oklch = value.kind === ColorKind.Oklch;

      return serializeModernColorFunction(
        oklch ? 'oklch' : 'lch',
        [
          serializeColorComponent(value.lightness, oklch ? 1 : 100),
          serializeColorComponent(value.chroma, oklch ? 0.4 : 150),
          serializeHue(value.hue),
        ],
        value.alpha,
      );
    }
    case ColorKind.Color:
      return serializeModernColorFunction(
        'color',
        [
          value.space === 'xyz' ? 'xyz-d65' : value.space,
          ...value.components.map(
            (component) => serializeColorComponent(component, 1),
          ),
        ],
        value.alpha,
      );
    default:
      return assertNever(value);
  }
}

function serializeRgbColor(
  value: RgbColor,
): string {
  const components = value.components.map(
    (component) => serializeColorComponent(component, 255),
  );

  return value.syntax === 'legacy'
    ? serializeLegacyColorFunction('rgb', components, value.alpha)
    : serializeModernColorFunction('rgb', components, value.alpha);
}

function serializeHslColor(
  value: HslColor,
): string {
  const components = [
    serializeHue(value.hue),
    serializeColorComponent(value.saturation, 100),
    serializeColorComponent(value.lightness, 100),
  ];

  return value.syntax === 'legacy'
    ? serializeLegacyColorFunction('hsl', components, value.alpha)
    : serializeModernColorFunction('hsl', components, value.alpha);
}

function serializeLegacyColorFunction(
  name: 'rgb' | 'hsl',
  components: string[],
  alphaValue: AlphaValue | 'none' | undefined,
): string {
  const alpha = serializeColorAlpha(alphaValue);

  return alpha === null
    ? `${name}(${components.join(', ')})`
    : `${name}a(${components.join(', ')}, ${alpha})`;
}

function serializeModernColorFunction(
  name: string,
  components: string[],
  alphaValue: AlphaValue | 'none' | undefined,
): string {
  const alpha = serializeColorAlpha(alphaValue);

  return alpha === null
    ? `${name}(${components.join(' ')})`
    : `${name}(${components.join(' ')} / ${alpha})`;
}

function serializeHue(
  value: HueValue | 'none',
): string {
  if (value === 'none') {
    return value;
  }

  if (value.type === 'math') {
    return isNumberValue(value)
      ? serializeNumber(value)
      : serializeAngle(value);
  }

  if (value.type === 'angle') {
    return serializeCssNumber(resolveAngleLiteral(value).value);
  }

  return serializeColorComponent(value, 1);
}

function serializeColorComponent(
  value: NumberValue | PercentageValue | 'none',
  percentageReference: number,
): string {
  if (value === 'none') {
    return value;
  }

  if (value.type === 'percentage') {
    return serializeCssNumber(
      value.value * percentageReference / 100,
    );
  }

  return isNumberValue(value)
    ? serializeNumber(value)
    : serializePercentage(value);
}

function serializeColorAlpha(
  value: AlphaValue | 'none' | undefined,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (value === 'none') {
    return value;
  }

  if (value.type === 'math') {
    return isNumberValue(value)
      ? serializeNumber(value)
      : serializePercentage(value);
  }

  const alpha = value.type === 'percentage'
    ? value.value / 100
    : value.value;

  return alpha === 1
    ? null
    : serializeCssNumber(alpha);
}

function serializeAbsoluteColor(
  value: AbsoluteColor,
  htmlCompatible: boolean,
): string {
  switch (value.space) {
    case 'srgb-legacy':
      return serializeAbsoluteRgb(value, htmlCompatible);
    case 'hsl':
      return serializeAbsoluteHsl(value);
    case 'hwb':
      return serializeAbsoluteHwb(value);
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch':
      return serializeAbsoluteColorComponents(value.space, value);
    case 'srgb':
    case 'srgb-linear':
    case 'display-p3':
    case 'display-p3-linear':
    case 'a98-rgb':
    case 'prophoto-rgb':
    case 'rec2020':
    case 'xyz-d50':
    case 'xyz-d65':
      return `color(${value.space} ${serializeAbsoluteColorComponentsBody(value)})`;
    default:
      return assertNever(value.space);
  }
}

function serializeAbsoluteRgb(
  value: AbsoluteColor,
  htmlCompatible: boolean,
): string {
  if (htmlCompatible) {
    const serialized = serializeHtmlCompatibleRgb(value);

    if (serialized !== null) {
      return serialized;
    }
  }

  if (
    value.components.some((component) => component === undefined) ||
    value.alpha === undefined
  ) {
    return `color(srgb ${serializeAbsoluteColorComponentsBody(
      normalizeColorEncoding(value),
    )})`;
  }

  const components = value.components.map(
    (component) => serializeCssNumber(value.is8Bit
      ? clamp(component!, 0, 0xff)
      : clamp(component!, 0, 1) * 0xff),
  );
  const alpha = value.is8Bit
    ? serialize8BitAlpha(value.alpha)
    : serializeAbsoluteColorAlpha(value.alpha);

  return alpha === null
    ? `rgb(${components.join(', ')})`
    : `rgba(${components.join(', ')}, ${alpha})`;
}

function serializeHtmlCompatibleRgb(value: AbsoluteColor): string | null {
  if (!value.is8Bit || value.alpha !== 0xff) {
    return null;
  }

  let serialized = '#';

  for (const component of value.components) {
    if (
      component === undefined ||
      !Number.isInteger(component) ||
      component < 0 ||
      component > 0xff
    ) {
      return null;
    }

    serialized += component.toString(16).padStart(2, '0');
  }

  return serialized;
}

function serialize8BitAlpha(value: number): string | null {
  const alpha = clamp(value, 0, 0xff);

  if (alpha === 0xff) {
    return null;
  }

  for (let percentage = 0; percentage <= 100; percentage++) {
    if (Math.round(percentage * 0xff / 100) === alpha) {
      return serializeCssNumber(percentage / 100);
    }
  }

  return serializeCssNumber(Math.round(alpha / 0.255) / 1000);
}

function serializeAbsoluteHsl(
  value: AbsoluteColor,
): string {
  const [hue, saturation, lightness] = value.components;
  const components = [
    serializeAbsoluteColorComponent(hue),
    serializeAbsoluteColorPercentage(saturation),
    serializeAbsoluteColorPercentage(lightness),
  ];

  return serializeAbsoluteColorFunction('hsl', components, value.alpha);
}

function serializeAbsoluteHwb(
  value: AbsoluteColor,
): string {
  const [hue, whiteness, blackness] = value.components;
  const components = [
    serializeAbsoluteColorComponent(hue),
    serializeAbsoluteColorPercentage(whiteness),
    serializeAbsoluteColorPercentage(blackness),
  ];

  return serializeAbsoluteColorFunction('hwb', components, value.alpha);
}

function serializeAbsoluteColorComponents(
  name: 'lab' | 'lch' | 'oklab' | 'oklch',
  value: AbsoluteColor,
): string {
  return serializeAbsoluteColorFunction(
    name,
    value.components.map(serializeAbsoluteColorComponent),
    value.alpha,
  );
}

function serializeAbsoluteColorComponentsBody(value: AbsoluteColor): string {
  const components = value.components
    .map(serializeAbsoluteColorComponent)
    .join(' ');
  const alpha = serializeAbsoluteColorAlpha(value.alpha);

  return alpha === null
    ? components
    : `${components} / ${alpha}`;
}

function serializeAbsoluteColorFunction(
  name: string,
  components: string[],
  alphaValue: number | undefined,
): string {
  const alpha = serializeAbsoluteColorAlpha(alphaValue);

  return alpha === null
    ? `${name}(${components.join(' ')})`
    : `${name}(${components.join(' ')} / ${alpha})`;
}

function serializeAbsoluteColorComponent(value: ColorComponent): string {
  return value === undefined
    ? 'none'
    : serializeCssNumber(value);
}

function serializeAbsoluteColorPercentage(value: ColorComponent): string {
  return value === undefined
    ? 'none'
    : `${serializeCssNumber(value)}%`;
}

function serializeAbsoluteColorAlpha(value: number | undefined): string | null {
  if (value === undefined) {
    return 'none';
  }

  const alpha = Number.isNaN(value)
    ? 0
    : clamp(value, 0, 1);

  return alpha === 1
    ? null
    : serializeCssNumber(alpha);
}



//  ██████   ███████  ██    ██ ██     ██ ████████ ████████  ████████
// ██    ██ ██     ██ ███   ██ ██     ██ ██       ██     ██    ██
// ██       ██     ██ ████  ██ ██     ██ ██       ██     ██    ██
// ██       ██     ██ ██ ██ ██ ██     ██ ██████   ████████     ██
// ██       ██     ██ ██  ████  ██   ██  ██       ██   ██      ██
// ██    ██ ██     ██ ██   ███   ██ ██   ██       ██    ██     ██
//  ██████   ███████  ██    ██    ███    ████████ ██     ██    ██

type WhitePoint = 'd50' | 'd65';

type ColorVector = [number, number, number];

type ColorMatrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export function convertAbsoluteColor(
  value: AbsoluteColor,
  target: AbsoluteColorSpace,
): AbsoluteColor {
  if (value.space === target) {
    return value;
  }

  const source = replaceMissingComponents(
    prepareAbsoluteColorForConversion(value),
  );
  const rectangularTarget = rectangularColorSpace(target);
  let converted: AbsoluteColor;

  if (source.space === rectangularTarget) {
    converted = source;
  } else {
    let xyz = convertAbsoluteColorToXyz(source);
    const targetWhitePoint = colorSpaceWhitePoint(rectangularTarget);

    if (colorSpaceWhitePoint(source.space) !== targetWhitePoint) {
      xyz = targetWhitePoint === 'd50'
        ? adaptD65ToD50(xyz)
        : adaptD50ToD65(xyz);
    }

    converted = convertXyzToAbsoluteColor(xyz, rectangularTarget);
  }

  return convertRectangularAbsoluteColor(converted, target);
}

function prepareAbsoluteColorForConversion(
  value: AbsoluteColor,
): AbsoluteColor {
  const normalized = normalizeColorEncoding(value);

  switch (normalized.space) {
    case 'srgb-legacy':
      return { ...normalized, space: 'srgb' };
    case 'hsl':
      return convertHslToRgb(normalized);
    case 'hwb':
      return convertHwbToRgb(normalized);
    case 'lch':
      return convertLchToLab(normalized);
    case 'oklch':
      return convertOklchToOklab(normalized);
    default:
      return normalized;
  }
}

function normalizeColorEncoding(value: AbsoluteColor): AbsoluteColor {
  if (!value.is8Bit) {
    return value;
  }

  return {
    kind: ColorKind.Absolute,
    space: value.space,
    components: value.components.map(
      (component) => component === undefined
        ? component
        : component / 0xff,
    ) as ColorComponents,
    alpha: value.alpha === undefined
      ? value.alpha
      : value.alpha / 0xff,
  };
}

const POWERLESS_HUE_EPSILON = {
  hsl: 0.001,
  hwb: 99.999,
  lch: 0.0015,
  oklch: 0.000004,
} as const;

function replacePowerlessComponents(value: AbsoluteColor): AbsoluteColor {
  const [firstComp, secondComp, thirdComp] = value.components;
  const second = secondComp ?? 0;
  const third = thirdComp ?? 0;

  // Comparison uses the exact powerless conditions. The epsilon thresholds
  // apply only when color space conversion produces a polar hue.
  switch (value.space) {
    case 'hsl':
      return second === 0 && firstComp !== undefined
        ? { ...value, components: [undefined, second, third] }
        : value;
    case 'hwb':
      return second + third >= 100 && firstComp !== undefined
        ? { ...value, components: [undefined, second, third] }
        : value;
    case 'lch':
    case 'oklch':
      return second === 0 && thirdComp !== undefined
        ? { ...value, components: [firstComp, second, undefined] }
        : value;
    default:
      return value;
  }
}

function replaceMissingComponents(value: AbsoluteColor): AbsoluteColor {
  return {
    ...value,
    components: componentsForConversion(value),
  };
}

function rectangularColorSpace(
  value: AbsoluteColorSpace,
): RectangularColorSpace {
  switch (value) {
    case 'srgb-legacy':
    case 'hsl':
    case 'hwb':
      return 'srgb';
    case 'lch':
      return 'lab';
    case 'oklch':
      return 'oklab';
    default:
      return value;
  }
}

function colorSpaceWhitePoint(value: AbsoluteColorSpace): WhitePoint {
  switch (rectangularColorSpace(value)) {
    case 'lab':
    case 'prophoto-rgb':
    case 'xyz-d50':
      return 'd50';
    default:
      return 'd65';
  }
}

function convertAbsoluteColorToXyz(value: AbsoluteColor): AbsoluteColor {
  const components = componentsForConversion(value);
  let xyz: ColorVector;
  let space: 'xyz-d50' | 'xyz-d65';

  switch (value.space) {
    case 'srgb':
      xyz = linearSrgbToXyz(linearizeSrgb(components));
      space = 'xyz-d65';
      break;
    case 'srgb-linear':
      xyz = linearSrgbToXyz(components);
      space = 'xyz-d65';
      break;
    case 'display-p3':
      xyz = linearDisplayP3ToXyz(linearizeDisplayP3(components));
      space = 'xyz-d65';
      break;
    case 'display-p3-linear':
      xyz = linearDisplayP3ToXyz(components);
      space = 'xyz-d65';
      break;
    case 'a98-rgb':
      xyz = linearA98RgbToXyz(linearizeA98Rgb(components));
      space = 'xyz-d65';
      break;
    case 'prophoto-rgb':
      xyz = linearProphotoRgbToXyz(linearizeProphotoRgb(components));
      space = 'xyz-d50';
      break;
    case 'rec2020':
      xyz = linearRec2020ToXyz(linearizeRec2020(components));
      space = 'xyz-d65';
      break;
    case 'lab':
      xyz = labToXyz(components);
      space = 'xyz-d50';
      break;
    case 'oklab':
      xyz = oklabToXyz(components);
      space = 'xyz-d65';
      break;
    case 'xyz-d50':
    case 'xyz-d65':
      return value;
    default:
      throw new Error(`Cannot convert ${value.space} directly to XYZ`);
  }

  return {
    kind: ColorKind.Absolute,
    space,
    components: xyz,
    alpha: value.alpha,
  };
}

function convertXyzToAbsoluteColor(
  value: AbsoluteColor,
  target: RectangularColorSpace,
): AbsoluteColor {
  const xyz = componentsForConversion(value);
  let components: ColorVector;

  switch (target) {
    case 'srgb':
      components = encodeSrgb(xyzToLinearSrgb(xyz));
      break;
    case 'srgb-linear':
      components = xyzToLinearSrgb(xyz);
      break;
    case 'display-p3':
      components = encodeDisplayP3(xyzToLinearDisplayP3(xyz));
      break;
    case 'display-p3-linear':
      components = xyzToLinearDisplayP3(xyz);
      break;
    case 'a98-rgb':
      components = encodeA98Rgb(xyzToLinearA98Rgb(xyz));
      break;
    case 'prophoto-rgb':
      components = encodeProphotoRgb(xyzToLinearProphotoRgb(xyz));
      break;
    case 'rec2020':
      components = encodeRec2020(xyzToLinearRec2020(xyz));
      break;
    case 'lab':
      components = xyzToLab(xyz);
      break;
    case 'oklab':
      components = xyzToOklab(xyz);
      break;
    case 'xyz-d50':
    case 'xyz-d65':
      components = xyz;
      break;
    default:
      return assertNever(target);
  }

  return {
    kind: ColorKind.Absolute,
    space: target,
    components,
    alpha: value.alpha,
  };
}

function convertRectangularAbsoluteColor(
  value: AbsoluteColor,
  target: AbsoluteColorSpace,
): AbsoluteColor {
  switch (target) {
    case 'srgb-legacy':
      return { ...value, space: target };
    case 'hsl':
      return convertRgbToHsl(value);
    case 'hwb':
      return convertRgbToHwb(value);
    case 'lch':
      return convertLabToLch(value);
    case 'oklch':
      return convertOklabToOklch(value);
    default:
      return value;
  }
}

function convertHslToRgb(value: AbsoluteColor): AbsoluteColor {
  const components = componentsForConversion(value);

  return {
    kind: ColorKind.Absolute,
    space: 'srgb',
    components: hslToRgb(...components),
    alpha: value.alpha,
  };
}

function convertRgbToHsl(value: AbsoluteColor): AbsoluteColor {
  const [red, green, blue] = componentsForConversion(value);
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue);

  return {
    kind: ColorKind.Absolute,
    space: 'hsl',
    components: [
      Number.isNaN(hue) ? undefined : hue,
      saturation,
      lightness,
    ],
    alpha: value.alpha,
  };
}

function convertHwbToRgb(value: AbsoluteColor): AbsoluteColor {
  const components = componentsForConversion(value);

  return {
    kind: ColorKind.Absolute,
    space: 'srgb',
    components: hwbToRgb(...components),
    alpha: value.alpha,
  };
}

function convertRgbToHwb(value: AbsoluteColor): AbsoluteColor {
  const [red, green, blue] = componentsForConversion(value);
  const [hue, whiteness, blackness] = rgbToHwb(red, green, blue);

  return {
    kind: ColorKind.Absolute,
    space: 'hwb',
    components: [
      Number.isNaN(hue) ? undefined : hue,
      whiteness,
      blackness,
    ],
    alpha: value.alpha,
  };
}

function convertLabToLch(value: AbsoluteColor): AbsoluteColor {
  const [lightness, chroma, hue] = labToLch(
    componentsForConversion(value),
  );

  return {
    kind: ColorKind.Absolute,
    space: 'lch',
    components: [
      lightness,
      chroma,
      Number.isNaN(hue) ? undefined : hue,
    ],
    alpha: value.alpha,
  };
}

function convertLchToLab(value: AbsoluteColor): AbsoluteColor {
  const [lightness = 0, chroma = 0, hue] = value.components;

  return {
    kind: ColorKind.Absolute,
    space: 'lab',
    components: hue === undefined
      ? [lightness, 0, 0]
      : lchToLab([lightness, chroma, hue]),
    alpha: value.alpha,
  };
}

function convertOklabToOklch(value: AbsoluteColor): AbsoluteColor {
  const [lightness, chroma, hue] = oklabToOklch(
    componentsForConversion(value),
  );

  return {
    kind: ColorKind.Absolute,
    space: 'oklch',
    components: [
      lightness,
      chroma,
      Number.isNaN(hue) ? undefined : hue,
    ],
    alpha: value.alpha,
  };
}

function convertOklchToOklab(value: AbsoluteColor): AbsoluteColor {
  const [lightness = 0, chroma = 0, hue] = value.components;

  return {
    kind: ColorKind.Absolute,
    space: 'oklab',
    components: hue === undefined
      ? [lightness, 0, 0]
      : oklchToOklab([lightness, chroma, hue]),
    alpha: value.alpha,
  };
}

function componentsForConversion(
  value: AbsoluteColor,
): [number, number, number] {
  const [first = 0, second = 0, third = 0] = value.components;

  return [first, second, third];
}

function hslToRgb(
  hue: number,
  sat: number,
  light: number,
): [number, number, number] {
  sat /= 100;
  light /= 100;

  function f(n: number): number {
    const k = (n + hue / 30) % 12;
    const a = sat * Math.min(light, 1 - light);

    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  }

  return [f(0), f(8), f(4)];
}

function rgbToHsl(
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = Number.NaN;
  let sat = 0;
  const light = (min + max) / 2;
  const d = max - min;

  if (d !== 0) {
    sat = light === 0 || light === 1
      ? 0
      : (max - light) / Math.min(light, 1 - light);

    switch (max) {
      case red:
        hue = (green - blue) / d + (green < blue ? 6 : 0);
        break;
      case green:
        hue = (blue - red) / d + 2;
        break;
      case blue:
        hue = (red - green) / d + 4;
        break;
    }

    hue *= 60;
  }

  // Very out-of-gamut colors can produce negative saturation. If so, rotate
  // the hue by 180 degrees and use a positive saturation.
  if (sat < 0) {
    hue += 180;
    sat = Math.abs(sat);
  }

  if (hue >= 360) {
    hue -= 360;
  }

  sat *= 100;

  if (sat <= POWERLESS_HUE_EPSILON.hsl) {
    hue = Number.NaN;
  }

  return [hue, sat, light * 100];
}

function hwbToRgb(
  hue: number,
  white: number,
  black: number,
): [number, number, number] {
  white /= 100;
  black /= 100;

  if (white + black >= 1) {
    const gray = white / (white + black);

    return [gray, gray, gray];
  }

  const rgb = hslToRgb(hue, 100, 50);

  for (let i = 0; i < 3; i++) {
    rgb[i]! *= 1 - white - black;
    rgb[i]! += white;
  }

  return rgb;
}

function rgbToHue(red: number, green: number, blue: number): number {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = Number.NaN;
  const d = max - min;

  if (d !== 0) {
    switch (max) {
      case red:
        hue = (green - blue) / d + (green < blue ? 6 : 0);
        break;
      case green:
        hue = (blue - red) / d + 2;
        break;
      case blue:
        hue = (red - green) / d + 4;
        break;
    }

    hue *= 60;
  }

  if (hue >= 360) {
    hue -= 360;
  }

  return hue;
}

function rgbToHwb(
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  let hue = rgbToHue(red, green, blue);
  const white = Math.min(red, green, blue) * 100;
  const black = (1 - Math.max(red, green, blue)) * 100;

  if (white + black >= POWERLESS_HUE_EPSILON.hwb) {
    hue = Number.NaN;
  }

  return [hue, white, black];
}

function linearizeSrgb(value: ColorVector): ColorVector {
  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;
    const absolute = Math.abs(component);

    if (absolute <= 0.04045) {
      return component / 12.92;
    }

    return sign * ((absolute + 0.055) / 1.055) ** 2.4;
  });
}

function encodeSrgb(value: ColorVector): ColorVector {
  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;
    const absolute = Math.abs(component);

    if (absolute > 0.0031308) {
      return sign * (1.055 * absolute ** (1 / 2.4) - 0.055);
    }

    return 12.92 * component;
  });
}

const LINEAR_SRGB_TO_XYZ: ColorMatrix = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];

function linearSrgbToXyz(value: ColorVector): ColorVector {
  return transformColorVector(LINEAR_SRGB_TO_XYZ, value);
}

const XYZ_TO_LINEAR_SRGB: ColorMatrix = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];

function xyzToLinearSrgb(value: ColorVector): ColorVector {
  return transformColorVector(XYZ_TO_LINEAR_SRGB, value);
}

function linearizeDisplayP3(value: ColorVector): ColorVector {
  return linearizeSrgb(value);
}

function encodeDisplayP3(value: ColorVector): ColorVector {
  return encodeSrgb(value);
}

const LINEAR_DISPLAY_P3_TO_XYZ: ColorMatrix = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];

function linearDisplayP3ToXyz(value: ColorVector): ColorVector {
  return transformColorVector(LINEAR_DISPLAY_P3_TO_XYZ, value);
}

const XYZ_TO_LINEAR_DISPLAY_P3: ColorMatrix = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];

function xyzToLinearDisplayP3(value: ColorVector): ColorVector {
  return transformColorVector(XYZ_TO_LINEAR_DISPLAY_P3, value);
}

function linearizeProphotoRgb(value: ColorVector): ColorVector {
  const threshold = 16 / 512;

  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;
    const absolute = Math.abs(component);

    if (absolute <= threshold) {
      return component / 16;
    }

    return sign * absolute ** 1.8;
  });
}

function encodeProphotoRgb(value: ColorVector): ColorVector {
  const threshold = 1 / 512;

  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;
    const absolute = Math.abs(component);

    if (absolute >= threshold) {
      return sign * absolute ** (1 / 1.8);
    }

    return 16 * component;
  });
}

const LINEAR_PROPHOTO_RGB_TO_XYZ: ColorMatrix = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];

function linearProphotoRgbToXyz(value: ColorVector): ColorVector {
  return transformColorVector(LINEAR_PROPHOTO_RGB_TO_XYZ, value);
}

const XYZ_TO_LINEAR_PROPHOTO_RGB: ColorMatrix = [
  [1.3457868816471583, -0.25557208737979464, -0.05110186497554526],
  [-0.5446307051249019, 1.5082477428451468, 0.02052744743642139],
  [0, 0, 1.2119675456389452],
];

function xyzToLinearProphotoRgb(value: ColorVector): ColorVector {
  return transformColorVector(XYZ_TO_LINEAR_PROPHOTO_RGB, value);
}

function linearizeA98Rgb(value: ColorVector): ColorVector {
  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;

    return sign * Math.abs(component) ** (563 / 256);
  });
}

function encodeA98Rgb(value: ColorVector): ColorVector {
  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;

    return sign * Math.abs(component) ** (256 / 563);
  });
}

const LINEAR_A98_RGB_TO_XYZ: ColorMatrix = [
  [573536 / 994567, 263643 / 1420810, 187206 / 994567],
  [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
  [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
];

function linearA98RgbToXyz(value: ColorVector): ColorVector {
  return transformColorVector(LINEAR_A98_RGB_TO_XYZ, value);
}

const XYZ_TO_LINEAR_A98_RGB: ColorMatrix = [
  [1829569 / 896150, -506331 / 896150, -308931 / 896150],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [16779 / 1248040, -147721 / 1248040, 1266979 / 1248040],
];

function xyzToLinearA98Rgb(value: ColorVector): ColorVector {
  return transformColorVector(XYZ_TO_LINEAR_A98_RGB, value);
}

function linearizeRec2020(value: ColorVector): ColorVector {
  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;

    return sign * Math.abs(component) ** 2.4;
  });
}

function encodeRec2020(value: ColorVector): ColorVector {
  return mapColorVector(value, (component) => {
    const sign = component < 0 ? -1 : 1;

    return sign * Math.abs(component) ** (1 / 2.4);
  });
}

const LINEAR_REC2020_TO_XYZ: ColorMatrix = [
  [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
  [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
  [0, 19567812 / 697040785, 295819943 / 278816314],
];

function linearRec2020ToXyz(value: ColorVector): ColorVector {
  return transformColorVector(LINEAR_REC2020_TO_XYZ, value);
}

const XYZ_TO_LINEAR_REC2020: ColorMatrix = [
  [30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100],
  [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200],
  [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125],
];

function xyzToLinearRec2020(value: ColorVector): ColorVector {
  return transformColorVector(XYZ_TO_LINEAR_REC2020, value);
}

const D65_TO_D50: ColorMatrix = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];

function adaptD65ToD50(value: AbsoluteColor): AbsoluteColor {
  return {
    ...value,
    space: 'xyz-d50',
    components: transformColorVector(
      D65_TO_D50,
      componentsForConversion(value),
    ),
  };
}

const D50_TO_D65: ColorMatrix = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];

function adaptD50ToD65(value: AbsoluteColor): AbsoluteColor {
  return {
    ...value,
    space: 'xyz-d65',
    components: transformColorVector(
      D50_TO_D65,
      componentsForConversion(value),
    ),
  };
}

function xyzToLab(value: ColorVector): ColorVector {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const d50: ColorVector = [
    0.3457 / 0.3585,
    1,
    (1 - 0.3457 - 0.3585) / 0.3585,
  ];
  const xyz = mapColorVector(
    value,
    (component, index) => component / d50[index],
  );
  const f = mapColorVector(
    xyz,
    (component) => component > epsilon
      ? Math.cbrt(component)
      : (kappa * component + 16) / 116,
  );

  return [
    116 * f[1] - 16,
    500 * (f[0] - f[1]),
    200 * (f[1] - f[2]),
  ];
}

function labToXyz(value: ColorVector): ColorVector {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const f1 = (value[0] + 16) / 116;
  const f: ColorVector = [
    value[1] / 500 + f1,
    f1,
    f1 - value[2] / 200,
  ];
  const xyz: ColorVector = [
    f[0] ** 3 > epsilon ? f[0] ** 3 : (116 * f[0] - 16) / kappa,
    value[0] > kappa * epsilon
      ? ((value[0] + 16) / 116) ** 3
      : value[0] / kappa,
    f[2] ** 3 > epsilon ? f[2] ** 3 : (116 * f[2] - 16) / kappa,
  ];
  const d50: ColorVector = [
    0.3457 / 0.3585,
    1,
    (1 - 0.3457 - 0.3585) / 0.3585,
  ];

  return mapColorVector(
    xyz,
    (component, index) => component * d50[index],
  );
}

function labToLch(value: ColorVector): ColorVector {
  const chroma = Math.sqrt(value[1] ** 2 + value[2] ** 2);
  let hue = Math.atan2(value[2], value[1]) * 180 / Math.PI;

  if (hue < 0) {
    hue += 360;
  }

  if (chroma <= POWERLESS_HUE_EPSILON.lch) {
    hue = Number.NaN;
  }

  return [value[0], chroma, hue];
}

function lchToLab(value: ColorVector): ColorVector {
  return [
    value[0],
    value[1] * Math.cos(value[2] * Math.PI / 180),
    value[1] * Math.sin(value[2] * Math.PI / 180),
  ];
}

const XYZ_TO_LMS: ColorMatrix = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];

const LMS_TO_OKLAB: ColorMatrix = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];

function xyzToOklab(value: ColorVector): ColorVector {
  const lms = transformColorVector(XYZ_TO_LMS, value);

  return transformColorVector(
    LMS_TO_OKLAB,
    mapColorVector(lms, (component) => Math.cbrt(component)),
  );
}

const LMS_TO_XYZ: ColorMatrix = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

const OKLAB_TO_LMS: ColorMatrix = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];

function oklabToXyz(value: ColorVector): ColorVector {
  const nonlinearLms = transformColorVector(OKLAB_TO_LMS, value);

  return transformColorVector(
    LMS_TO_XYZ,
    mapColorVector(nonlinearLms, (component) => component ** 3),
  );
}

function oklabToOklch(value: ColorVector): ColorVector {
  const chroma = Math.sqrt(value[1] ** 2 + value[2] ** 2);
  let hue = Math.atan2(value[2], value[1]) * 180 / Math.PI;

  if (hue < 0) {
    hue += 360;
  }

  if (chroma <= POWERLESS_HUE_EPSILON.oklch) {
    hue = Number.NaN;
  }

  return [value[0], chroma, hue];
}

function oklchToOklab(value: ColorVector): ColorVector {
  return [
    value[0],
    value[1] * Math.cos(value[2] * Math.PI / 180),
    value[1] * Math.sin(value[2] * Math.PI / 180),
  ];
}

function mapColorVector(
  value: ColorVector,
  transform: (component: number, index: 0 | 1 | 2) => number,
): ColorVector {
  return [
    transform(value[0], 0),
    transform(value[1], 1),
    transform(value[2], 2),
  ];
}

function transformColorVector(
  matrix: ColorMatrix,
  value: ColorVector,
): ColorVector {
  const [x, y, z] = value;

  return matrix.map(
    ([a, b, c]) => a * x + b * y + c * z,
  ) as ColorVector;
}



//  ██████      ███    ██     ██ ██     ██    ███
// ██    ██    ██ ██   ███   ███ ███   ███   ██ ██
// ██         ██   ██  ████ ████ ████ ████  ██   ██
// ██   ████ ██     ██ ██ ███ ██ ██ ███ ██ ██     ██
// ██    ██  █████████ ██     ██ ██     ██ █████████
// ██    ██  ██     ██ ██     ██ ██     ██ ██     ██
//  ██████   ██     ██ ██     ██ ██     ██ ██     ██

const GAMUT_MAPPING_JND = 0.02;
const GAMUT_MAPPING_EPSILON = 0.0001;

export function gamutMapAbsoluteColor(
  origin: AbsoluteColor,
  destination: ColorSpace,
): AbsoluteColor {
  if (!hasGamutLimits(destination)) {
    return convertAbsoluteColor(origin, destination);
  }

  const originOklch = convertAbsoluteColorToOklch(origin);
  const [lightness, originChroma, hue] =
    componentsForConversion(originOklch);

  if (lightness >= 1) {
    return convertAbsoluteColor({
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [1, 0, 0],
      alpha: origin.alpha,
    }, destination);
  }

  if (lightness <= 0) {
    return convertAbsoluteColor({
      kind: ColorKind.Absolute,
      space: 'oklab',
      components: [0, 0, 0],
      alpha: origin.alpha,
    }, destination);
  }

  if (isAbsoluteColorInGamut(originOklch, destination)) {
    return convertAbsoluteColor(originOklch, destination);
  }

  let current: AbsoluteColor = {
    ...originOklch,
    components: [lightness, originChroma, hue],
  };
  let clipped = clipAbsoluteColorToGamut(current, destination);
  let difference = deltaEOK(clipped, current);

  if (difference < GAMUT_MAPPING_JND) {
    return clipped;
  }

  let min = 0;
  let max = originChroma;
  let minInGamut = true;

  while (max - min > GAMUT_MAPPING_EPSILON) {
    const chroma = (min + max) / 2;

    current = {
      ...current,
      components: [lightness, chroma, hue],
    };

    if (minInGamut && isAbsoluteColorInGamut(current, destination)) {
      min = chroma;
      continue;
    }

    clipped = clipAbsoluteColorToGamut(current, destination);
    difference = deltaEOK(clipped, current);

    if (difference < GAMUT_MAPPING_JND) {
      if (GAMUT_MAPPING_JND - difference < GAMUT_MAPPING_EPSILON) {
        return clipped;
      }

      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }

  return clipped;
}

function hasGamutLimits(space: ColorSpace): boolean {
  switch (space) {
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch':
    case 'xyz-d50':
    case 'xyz-d65':
      return false;
    default:
      return true;
  }
}

function convertAbsoluteColorToOklch(value: AbsoluteColor): AbsoluteColor {
  const prepared = replaceMissingComponents(
    prepareAbsoluteColorForConversion(value),
  );

  return prepared.space === 'oklab'
    ? convertOklabToOklch(prepared)
    : convertAbsoluteColor(prepared, 'oklch');
}

function isAbsoluteColorInGamut(
  value: AbsoluteColor,
  destination: ColorSpace,
): boolean {
  const gamutSpace = destination === 'hsl' || destination === 'hwb'
    ? 'srgb'
    : destination;
  const converted = convertAbsoluteColor(value, gamutSpace);

  return converted.components.every(
    (component) =>
      component !== undefined
      && component >= 0
      && component <= 1,
  );
}

function clipAbsoluteColorToGamut(
  value: AbsoluteColor,
  destination: ColorSpace,
): AbsoluteColor {
  const converted = convertAbsoluteColor(value, destination);
  const [first, second, third] = converted.components;

  switch (destination) {
    case 'hsl':
    case 'hwb':
      return {
        ...converted,
        components: [
          first,
          clamp(second ?? 0, 0, 100),
          clamp(third ?? 0, 0, 100),
        ],
      };
    default:
      return {
        ...converted,
        components: mapColorVector(
          componentsForConversion(converted),
          (component) => clamp(component, 0, 1),
        ),
      };
  }
}

export function deltaEOK(one: AbsoluteColor, two: AbsoluteColor): number {
  const [lightness1, a1, b1] = componentsForConversion(
    convertAbsoluteColor(one, 'oklab'),
  );
  const [lightness2, a2, b2] = componentsForConversion(
    convertAbsoluteColor(two, 'oklab'),
  );
  const deltaLightness = lightness1 - lightness2;
  const deltaA = a1 - a2;
  const deltaB = b1 - b2;

  return Math.sqrt(
    deltaLightness ** 2
    + deltaA ** 2
    + deltaB ** 2,
  );
}

export function areColorsEquivalent(
  a: AbsoluteColor,
  b: AbsoluteColor,
): boolean {
  const preparedA = prepareAbsoluteColorForComparison(a);
  const preparedB = prepareAbsoluteColorForComparison(b);

  if (preparedA.space === preparedB.space) {
    return areColorComponentsEquivalent(preparedA, preparedB);
  }

  if (
    hasMissingColorComponent(preparedA)
    || hasMissingColorComponent(preparedB)
  ) {
    return false;
  }

  return areColorComponentsEquivalent(
    convertAbsoluteColor(preparedA, 'oklab'),
    convertAbsoluteColor(preparedB, 'oklab'),
  );
}

function prepareAbsoluteColorForComparison(
  value: AbsoluteColor,
): AbsoluteColor {
  const prepared = replacePowerlessComponents(
    normalizeColorEncoding(value),
  );

  return prepared.space === 'srgb-legacy'
    ? { ...prepared, space: 'srgb' }
    : prepared;
}

function areColorComponentsEquivalent(
  a: AbsoluteColor,
  b: AbsoluteColor,
): boolean {
  return (
    a.components.every(
      (component, index) =>
        areColorComponentValuesEquivalent(component, b.components[index]),
    )
    && areColorComponentValuesEquivalent(a.alpha, b.alpha)
  );
}

function areColorComponentValuesEquivalent(
  a: ColorComponent,
  b: ColorComponent,
  epsilon = 0.00001,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }

  return Math.abs(a - b) <= epsilon;
}



// ████ ██    ██ ████████ ████████ ████████  ████████   ███████  ██          ███    ████████ ████████
//  ██  ███   ██    ██    ██       ██     ██ ██     ██ ██     ██ ██         ██ ██      ██    ██
//  ██  ████  ██    ██    ██       ██     ██ ██     ██ ██     ██ ██        ██   ██     ██    ██
//  ██  ██ ██ ██    ██    ██████   ████████  ████████  ██     ██ ██       ██     ██    ██    ██████
//  ██  ██  ████    ██    ██       ██   ██   ██        ██     ██ ██       █████████    ██    ██
//  ██  ██   ███    ██    ██       ██    ██  ██        ██     ██ ██       ██     ██    ██    ██
// ████ ██    ██    ██    ████████ ██     ██ ██         ███████  ████████ ██     ██    ██    ████████

export function interpolateColors(
  a: AbsoluteColor,
  b: AbsoluteColor,
  progress: number,
  space?: ColorSpace,
  hue: HueInterpolationMethod = 'shorter',
): AbsoluteColor {
  space ??= (a.space === 'srgb-legacy' && b.space === 'srgb-legacy'
    ? 'srgb'
    : 'oklab');

  const carriedA = findCarriedForwardComponents(a, space);
  const carriedB = findCarriedForwardComponents(b, space);

  const normalizedA = normalizeColorEncoding(a);
  const convertedA = convertAbsoluteColor(replaceMissingComponents(normalizedA), space);

  const normalizedB = normalizeColorEncoding(b);
  const convertedB = convertAbsoluteColor(replaceMissingComponents(normalizedB), space);

  const [restoredA, restoredB] = restoreCarriedForwardComponents(
    convertedA, convertedB, carriedA, carriedB,
  );

  const [fixedA, fixedB] = fixupColorHues(restoredA, restoredB, hue);

  const premultipliedA = premultiplyColor(fixedA);
  const premultipliedB = premultiplyColor(fixedB);

  const interpolated = interpolatePremultipliedColors(
    premultipliedA,
    premultipliedB,
    progress,
  );

  return unpremultiplyColor(interpolated);
}

type CarriedColorComponents = {
  components: [boolean, boolean, boolean];
  alpha: boolean;
};

type ColorComponentCategory =
  | 'red'
  | 'green'
  | 'blue'
  | 'lightness'
  | 'colorfulness'
  | 'hue'
  | 'opponent-a'
  | 'opponent-b';

// Section 13.2, "Interpolating with Missing Components."
function findCarriedForwardComponents(
  value: AbsoluteColor,
  space: ColorSpace,
): CarriedColorComponents {
  const sourceCategories = componentCategories(value.space);
  const targetCategories = componentCategories(space);
  const carriedComps = targetCategories.map((category) => {
    if (category === undefined) {
      return false;
    }

    const sourceIndex = sourceCategories.indexOf(category);

    return sourceIndex !== -1 && value.components[sourceIndex] === undefined;
  }) as [boolean, boolean, boolean];

  const sourceSet = sourceCategories
    .map((category, index) =>
      category === undefined || !targetCategories.includes(category)
        ? index
        : undefined,
    )
    .filter((index) => index !== undefined);

  const targetSet = targetCategories
    .map((category, index) =>
      category === undefined || !sourceCategories.includes(category)
        ? index
        : undefined,
    )
    .filter((index) => index !== undefined);

  if (
    sourceSet.length > 0
    && sourceSet.every((index) => value.components[index] === undefined)
  ) {
    for (const index of targetSet) {
      carriedComps[index] = true;
    }
  }

  return {
    components: carriedComps,
    alpha: value.alpha === undefined,
  };
}

// Section 13.2, "Interpolating with Missing Components."
function restoreCarriedForwardComponents(
  a: AbsoluteColor,
  b: AbsoluteColor,
  carriedA: CarriedColorComponents,
  carriedB: CarriedColorComponents,
): [AbsoluteColor, AbsoluteColor] {
  const componentsA = a.components.map((component, index) =>
    carriedA.components[index]
      ? carriedB.components[index]
        ? undefined
        : b.components[index]
      : component,
  ) as ColorComponents;
  const componentsB = b.components.map((component, index) =>
    carriedB.components[index]
      ? carriedA.components[index]
        ? undefined
        : a.components[index]
      : component,
  ) as ColorComponents;

  return [
    {
      ...a,
      components: componentsA,
      alpha: carriedA.alpha
        ? carriedB.alpha ? undefined : b.alpha
        : a.alpha,
    },
    {
      ...b,
      components: componentsB,
      alpha: carriedB.alpha
        ? carriedA.alpha ? undefined : a.alpha
        : b.alpha,
    },
  ];
}

function componentCategories(space: AbsoluteColorSpace): [
  ColorComponentCategory | undefined,
  ColorComponentCategory | undefined,
  ColorComponentCategory | undefined,
] {
  switch (space) {
    case 'srgb-legacy':
    case 'srgb':
    case 'srgb-linear':
    case 'display-p3':
    case 'display-p3-linear':
    case 'a98-rgb':
    case 'prophoto-rgb':
    case 'rec2020':
    case 'xyz-d50':
    case 'xyz-d65':
      return ['red', 'green', 'blue'];
    case 'hsl':
      return ['hue', 'colorfulness', 'lightness'];
    case 'hwb':
      return ['hue', undefined, undefined];
    case 'lab':
    case 'oklab':
      return ['lightness', 'opponent-a', 'opponent-b'];
    case 'lch':
    case 'oklch':
      return ['lightness', 'colorfulness', 'hue'];
    default:
      return assertNever(space);
  }
}

// Section 13.4, "Hue Interpolation."
function fixupColorHues(
  a: AbsoluteColor,
  b: AbsoluteColor,
  method: HueInterpolationMethod,
): [AbsoluteColor, AbsoluteColor] {
  const hueIndex = colorHueIndex(a.space);

  if (hueIndex === undefined) {
    return [a, b];
  }

  let hueA = a.components[hueIndex];
  let hueB = b.components[hueIndex];

  if (hueA === undefined) {
    if (hueB === undefined) {
      return [a, b];
    }

    hueA = hueB;
  } else if (hueB === undefined) {
    hueB = hueA;
  }

  const difference = hueB - hueA;

  switch (method) {
    case 'shorter':
      if (difference > 180) {
        hueA += 360;
      } else if (difference < -180) {
        hueB += 360;
      }
      break;
    case 'longer':
      if (difference > 0 && difference < 180) {
        hueA += 360;
      } else if (difference > -180 && difference <= 0) {
        hueB += 360;
      }
      break;
    case 'increasing':
      if (hueB < hueA) {
        hueB += 360;
      }
      break;
    case 'decreasing':
      if (hueA < hueB) {
        hueA += 360;
      }
      break;
    default:
      assertNever(method);
  }

  const componentsA: ColorComponents = [...a.components];
  const componentsB: ColorComponents = [...b.components];
  componentsA[hueIndex] = hueA;
  componentsB[hueIndex] = hueB;

  return [
    { ...a, components: componentsA },
    { ...b, components: componentsB },
  ];
}

function premultiplyColor(value: AbsoluteColor): AbsoluteColor {
  if (value.alpha === undefined) {
    return value;
  }

  const alpha = value.alpha;
  const hueIndex = colorHueIndex(value.space);
  const components = componentsForConversion(value);
  const premultiplied = value.space === 'hsl'
    ? hslPremultiply(components, alpha)
    : hueIndex === undefined
      ? rectangularPremultiply(components, alpha)
      : polarPremultiply(components, alpha, hueIndex);

  return {
    ...value,
    components: restoreMissingComponents(value, premultiplied),
  };
}

function interpolatePremultipliedColors(
  a: AbsoluteColor,
  b: AbsoluteColor,
  progress: number,
): AbsoluteColor {
  const components: ColorComponents = [
    interpolateComponent(a.components[0], b.components[0], progress),
    interpolateComponent(a.components[1], b.components[1], progress),
    interpolateComponent(a.components[2], b.components[2], progress),
  ];
  const hueIndex = colorHueIndex(a.space);

  if (hueIndex !== undefined && components[hueIndex] !== undefined) {
    components[hueIndex] = normalizeHue(components[hueIndex]);
  }

  return {
    kind: ColorKind.Absolute,
    space: a.space,
    components,
    alpha: interpolateComponent(a.alpha, b.alpha, progress),
  };
}

function interpolateComponent(
  a: ColorComponent,
  b: ColorComponent,
  progress: number,
): ColorComponent {
  return a === undefined || b === undefined
    ? undefined
    : (1 - progress) * a + progress * b;
}

function unpremultiplyColor(value: AbsoluteColor): AbsoluteColor {
  if (value.alpha === undefined || value.alpha === 0) {
    return value;
  }

  const alpha = value.alpha;
  const hueIndex = colorHueIndex(value.space);
  const components = componentsForConversion(value);
  const unpremultiplied = hueIndex === undefined
    ? rectangularUnPremultiply(components, alpha)
    : polarUnPremultiply(components, alpha, hueIndex);

  return {
    ...value,
    components: restoreMissingComponents(value, unpremultiplied),
  };
}

function restoreMissingComponents(
  value: AbsoluteColor,
  components: ColorVector,
): ColorComponents {
  return [
    value.components[0] === undefined ? undefined : components[0],
    value.components[1] === undefined ? undefined : components[1],
    value.components[2] === undefined ? undefined : components[2],
  ];
}

function colorHueIndex(space: AbsoluteColorSpace): 0 | 2 | undefined {
  switch (space) {
    case 'hsl':
    case 'hwb':
      return 0;
    case 'lch':
    case 'oklch':
      return 2;
    default:
      return undefined;
  }
}

// Pre-multiplication and unpremultiplication functions

function rectangularPremultiply(
  color: ColorVector,
  alpha: number,
): ColorVector {
  return mapColorVector(color, (component) => component * alpha);
}

function rectangularUnPremultiply(
  color: ColorVector,
  alpha: number,
): ColorVector {
  if (alpha === 0) {
    return color;
  }

  return mapColorVector(color, (component) => component / alpha);
}

function polarPremultiply(
  color: ColorVector,
  alpha: number,
  hueIndex: 0 | 1 | 2,
): ColorVector {
  return mapColorVector(
    color,
    (component, index) => component * (hueIndex === index ? 1 : alpha),
  );
}

function polarUnPremultiply(
  color: ColorVector,
  alpha: number,
  hueIndex: 0 | 1 | 2,
): ColorVector {
  if (alpha === 0) {
    return color;
  }

  return mapColorVector(
    color,
    (component, index) => component / (hueIndex === index ? 1 : alpha),
  );
}

function hslPremultiply(
  color: ColorVector,
  alpha: number,
): ColorVector {
  return polarPremultiply(color, alpha, 0);
}
