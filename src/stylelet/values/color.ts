import { asciiLower } from '../../shared/css';
import { assertNever, clamp } from '../../shared/util';
import type { ComponentCursor } from '../parser/component-cursor';
import {
  createDelimConsumer, createFunctionalNotationConsumer,
  tryConsumeHashToken,
} from '../parser/component-consumers';
import {
  allOf, commaRepeat, one, oneOf, opt, repeat, sequenceOf,
  withComponentTrivia,
} from '../parser/component-grammar';
import {
  isBad, ok, type TryComponentConsumer,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { isTokenKind, parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { NumberTokenFlag, TokenKind } from '../parser/tokens';
import { isAtOrBeyondValueStage, type ValueStage } from '../value-processing';
import { resolveAngle, serializeAngle, tryConsumeAngle, type AngleValue } from './angle';
import { tryCoercePercentageToNumber, type MathContext } from './math-value';
import { tryConsumeIdent } from './ident';
import { createKeywordConsumer } from './keyword';
import { resolveAngle as resolveAngleLiteral } from './numeric-literal/angle';
import { serializeCssNumber, type NumberLiteral } from './numeric-literal/number';
import type { PercentageLiteral } from './numeric-literal/percentage';
import { resolveNumber, serializeNumber, tryConsumeNumber, type NumberValue } from './number';
import {
  createPercentageConsumer, resolvePercentage, serializePercentage, tryConsumePercentage,
  type PercentageValue,
} from './percentage';
import { normalizeMixPercentages } from './mix';

/*
 * <color> = <color-base> | currentColor | <system-color> | <quirky-color>
 *
 * <color-base> = <hex-color> | <color-function> | <named-color> |
 *                <color-mix()>
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
  space: ColorSpace;
  components: AbsoluteTriplet;
  alpha: number | undefined;
  // Retains legacy rgb()/rgba() serialization and interpolation behavior.
  isLegacySrgb?: true;
  // Components and alpha are stored as 8-bit integers.
  is8Bit?: true;
};

export type ColorSpace = RectangularColorSpace | PolarColorSpace;

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

type ColorTriplet<Value> = [Value, Value, Value];

type AbsoluteComponent = number | undefined;
type AbsoluteTriplet = ColorTriplet<AbsoluteComponent>;

type SyntaxColorComponent = NumberValue | PercentageValue | 'none';
type SyntaxTriplet = ColorTriplet<SyntaxColorComponent>;

type SyntaxAlphaComponent = AlphaValue | 'none';
type AlphaValue = NumberValue | PercentageValue;
type AlphaLiteral = NumberLiteral | PercentageLiteral;

type SyntaxHueComponent = HueValue | 'none';
type HueValue = NumberValue | AngleValue;

export type ColorBase =
  | HexColor
  | ColorFunction
  | NamedColor
  | ColorMixFn;

export type ColorFunction =
  | RgbFn
  | HslFn
  | HwbFn
  | LabFn
  | LchFn
  | OklabFn
  | OklchFn
  | ColorFn;

export enum ColorKind {
  Named = 1,
  CurrentColor,
  System,
  Deprecated,
  Hex,
  RgbFn,
  HslFn,
  HwbFn,
  LabFn,
  LchFn,
  OklabFn,
  OklchFn,
  ColorFn,
  Absolute,
  ColorMixFn,
}

export function parseColorValue(
  input: ParserInput,
  context: ColorResolutionContext = {},
  allowQuirkyColor = false,
): ColorValue | null {
  const result = parseAsComponentGrammar(
    input,
    withComponentTrivia((c) => tryConsumeColor(c, allowQuirkyColor)),
    context,
  );

  return result === null || isBad(result)
    ? null
    : result.value;
}

export function tryConsumeColor(
  c: ComponentCursor,
  allowQuirkyColor = false,
): TryComponentConsumerResult<ColorValue> {
  const result = (
    allowQuirkyColor
      ? consumeColorInQuirksMode
      : consumeColor
  )(c);

  return result === null || isBad(result)
    ? result
    : ok(resolveColorValue(
      result.value,
      colorResolutionContextFor(c.context),
    ));
}

// <color> = <color-base> | currentColor | <system-color>
const consumeColor: TryComponentConsumer<ColorValue> = oneOf(
  [
    one(tryConsumeColorBase),
    one(tryConsumeCurrentColor),
    one(tryConsumeSystemColor),
    one(tryConsumeDeprecatedColor),
  ],
  ([value]) => ok(value),
);

// <color> = <color-base> | currentColor | <system-color> | <quirky-color>
const consumeColorInQuirksMode: TryComponentConsumer<ColorValue> = oneOf(
  [
    one(tryConsumeColorBase),
    one(tryConsumeCurrentColor),
    one(tryConsumeSystemColor),
    one(tryConsumeDeprecatedColor),
    one(tryConsumeQuirkyColor),
  ],
  ([value]) => ok(value),
);

function tryConsumeColorBase(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorBase> {
  return consumeColorBase(c);
}

// <color-base> = <hex-color> | <color-function> | <named-color> | <color-mix()>
const consumeColorBase: TryComponentConsumer<ColorBase> = oneOf(
  [
    one(tryConsumeHexColor),
    one(tryConsumeColorFunction),
    one(tryConsumeNamedColor),
    one(tryConsumeColorMixFn),
  ],
  ([value]) => ok(value),
);

function tryConsumeColorFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFunction> {
  return consumeColorFunction(c);
}

// <color-function> = <rgb()> | <rgba()> | <hsl()> | <hsla()> | <hwb()> | <lab()> | <lch()> | <oklab()> | <oklch()> | <color()>
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

function tryConsumeModernAlpha(
  c: ComponentCursor,
): TryComponentConsumerResult<SyntaxAlphaComponent> {
  return consumeModernAlpha(c);
}

const consumeModernAlpha: TryComponentConsumer<SyntaxAlphaComponent> =
  sequenceOf(
    [
      one(withComponentTrivia(tryConsumeSlash)),
      one(withComponentTrivia(oneOf(
        [
          one(tryConsumeAlphaValue),
          one(tryConsumeNone),
        ],
        ([alpha]) => ok(alpha),
      ))),
    ],
    ([, [alpha]]) => ok(alpha),
  );

function tryConsumeAlphaValue(
  c: ComponentCursor,
): TryComponentConsumerResult<AlphaValue> {
  return consumeAlphaValue(c);
}

// <alpha-value> = <number> | <percentage>
const consumeAlphaValue: TryComponentConsumer<AlphaValue> =
  oneOf(
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
  return consumeHexColor(c);
}

// <hex-color> = <hash-token> whose value consists of 3, 4, 6, or 8 hexadecimal digits
const consumeHexColor: TryComponentConsumer<HexColor> = (c) => {
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
};

function isHexColorValue(value: string): boolean {
  return (
    [3, 4, 6, 8].includes(value.length) &&
    isHexadecimal(value)
  );
}

function isHexadecimal(value: string): boolean {
  return /^[\da-f]+$/i.test(value);
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
  return consumeNamedColor(c);
}

// <named-color>
const consumeNamedColor: TryComponentConsumer<NamedColor> = (c) => {
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
};

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
 * <color-mix()> = color-mix(
 *   <color-interpolation-method>? ,
 *   [ <color> && <percentage [0,100]>>? ]#)
 */

export type ColorMixFn = {
  kind: ColorKind.ColorMixFn;
  method?: ColorInterpolationMethod;
  items: [ColorMixItem, ...ColorMixItem[]];
};

export type ColorMixItem = {
  color: ColorValue;
  percentage?: PercentageValue;
};

function tryConsumeColorMixFn(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorMixFn> {
  return consumeColorMixFn(c);
}

const tryConsumeColorMixPercentage =
  createPercentageConsumer({ min: 0, max: 100 });

// <color-mix()> = color-mix(<color-interpolation-method>? , [ <color> && <percentage [0,100]>>? ]#)
const consumeColorMixFn: TryComponentConsumer<ColorMixFn> =
  createFunctionalNotationConsumer(
    'color-mix',
    sequenceOf(
      [
        opt(sequenceOf(
          [
            one(tryConsumeColorInterpolationMethod),
            one(withComponentTrivia(tryConsumeComma)),
          ],
          ([[method]]) => ok(method),
        )),
        commaRepeat(allOf(
          [
            one(withComponentTrivia(tryConsumeColor)),
            opt(withComponentTrivia(tryConsumeColorMixPercentage)),
          ],
          ([color, percentage]) => ok({
            color: color![0],
            percentage: percentage?.[0],
          }),
        )),
      ],
      ([method, items]) => ok({
        kind: ColorKind.ColorMixFn as const,
        method: method[0],
        items,
      }),
    ),
    (color) => color,
  );

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
  return consumeSystemColor(c);
}

// <system-color>
const consumeSystemColor: TryComponentConsumer<SystemColor> = (c) => {
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
};

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
  return consumeDeprecatedColor(c);
}

// <deprecated-color>
const consumeDeprecatedColor: TryComponentConsumer<DeprecatedColor> = (c) => {
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
};

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
 * <rgb()> = [ <legacy-rgb-syntax> | <modern-rgb-syntax> ]
 * <rgba()> = [ <legacy-rgba-syntax> | <modern-rgba-syntax> ]
 *
 * <legacy-rgb-syntax> = rgb( <percentage>#{3} , <alpha-value>? ) |
 *                       rgb( <number>#{3} , <alpha-value>? )
 * <legacy-rgba-syntax> = rgba( <percentage>#{3} , <alpha-value>? ) |
 *                        rgba( <number>#{3} , <alpha-value>? )
 *
 * <modern-rgb-syntax> = rgb(
 *   [ from <color> ]?
 *   [ <number> | <percentage> | none ]{3}
 *   [ / [ <alpha-value> | none ] ]? )
 * <modern-rgba-syntax> = rgba(
 *   [ from <color> ]?
 *   [ <number> | <percentage> | none ]{3}
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type RgbFn = {
  kind: ColorKind.RgbFn;
  syntax: 'legacy' | 'modern';
  components: SyntaxTriplet;
  alpha?: SyntaxAlphaComponent;
};

function tryConsumeRgbFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbFn> {
  return consumeRgbFunction(c);
}

// <rgb()> = <legacy-rgb-syntax> | <modern-rgb-syntax>
const consumeRgbFunction: TryComponentConsumer<RgbFn> =
  createFunctionalNotationConsumer(
    'rgb',
    oneOf(
      [
        one(tryConsumeLegacyRgbSyntax),
        one(tryConsumeModernRgbSyntax),
      ],
      ([color]) => ok(color),
    ),
    (color) => color,
  );

function tryConsumeRgbaFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbFn> {
  return consumeRgbaFunction(c);
}

// <rgba()> = <legacy-rgba-syntax> | <modern-rgba-syntax>
const consumeRgbaFunction: TryComponentConsumer<RgbFn> =
  createFunctionalNotationConsumer(
    'rgba',
    oneOf(
      [
        one(tryConsumeLegacyRgbaSyntax),
        one(tryConsumeModernRgbaSyntax),
      ],
      ([color]) => ok(color),
    ),
    (color) => color,
  );

function tryConsumeLegacyRgbSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbFn> {
  return consumeLegacyRgbSyntax(c);
}

// <legacy-rgb-syntax> = rgb(<percentage>#{3} [ , <alpha-value> ]?) | rgb(<number>#{3} [ , <alpha-value> ]?)
const consumeLegacyRgbSyntax = createLegacyRgbSyntaxConsumer();

function tryConsumeLegacyRgbaSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbFn> {
  return consumeLegacyRgbaSyntax(c);
}

// <legacy-rgba-syntax> = rgba(<percentage>#{3} [ , <alpha-value> ]?) | rgba(<number>#{3} [ , <alpha-value> ]?)
const consumeLegacyRgbaSyntax = createLegacyRgbSyntaxConsumer();

function createLegacyRgbSyntaxConsumer(
): TryComponentConsumer<RgbFn> {
  return oneOf(
    [
      one(sequenceOf(
        [
          commaRepeat(tryConsumePercentage, 3, 3),
          opt(sequenceOf(
            [
              one(withComponentTrivia(tryConsumeComma)),
              one(withComponentTrivia(tryConsumeAlphaValue)),
            ],
            ([, [alpha]]) => ok(alpha),
          )),
        ],
        ([components, alpha]) => ok({
          kind: ColorKind.RgbFn as const,
          syntax: 'legacy' as const,
          components,
          alpha: alpha[0],
        }),
      )),
      one(sequenceOf(
        [
          commaRepeat(tryConsumeNumber, 3, 3),
          opt(sequenceOf(
            [
              one(withComponentTrivia(tryConsumeComma)),
              one(withComponentTrivia(tryConsumeAlphaValue)),
            ],
            ([, [alpha]]) => ok(alpha),
          )),
        ],
        ([components, alpha]) => ok({
          kind: ColorKind.RgbFn as const,
          syntax: 'legacy' as const,
          components,
          alpha: alpha[0],
        }),
      )),
    ],
    ([color]) => ok(color),
  );
}

function tryConsumeModernRgbSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbFn> {
  return consumeModernRgbSyntax(c);
}

// <modern-rgb-syntax> = rgb([ from <color> ]? [ <number> | <percentage> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const consumeModernRgbSyntax = createModernRgbSyntaxConsumer();

function tryConsumeModernRgbaSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<RgbFn> {
  return consumeModernRgbaSyntax(c);
}

// <modern-rgba-syntax> = rgba([ from <color> ]? [ <number> | <percentage> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const consumeModernRgbaSyntax = createModernRgbSyntaxConsumer();

function createModernRgbSyntaxConsumer(
): TryComponentConsumer<RgbFn> {
  return sequenceOf(
    [
      repeat(withComponentTrivia(oneOf(
        [
          one(tryConsumeNumber),
          one(tryConsumePercentage),
          one(tryConsumeNone),
        ],
        ([component]) => ok(component),
      )), 3, 3),
      opt(tryConsumeModernAlpha),
    ],
    ([components, alpha]) => ok({
      kind: ColorKind.RgbFn,
      syntax: 'modern',
      components,
      alpha: alpha[0],
    }),
  );
}

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

export type HslFn = {
  kind: ColorKind.HslFn;
  syntax: 'legacy' | 'modern';
  hue: SyntaxHueComponent;
  saturation: SyntaxColorComponent;
  lightness: SyntaxColorComponent;
  alpha?: SyntaxAlphaComponent;
};

function tryConsumeHslFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeHslFunction(c);
}

// <hsl()> = <legacy-hsl-syntax> | <modern-hsl-syntax>
const consumeHslFunction: TryComponentConsumer<HslFn> =
  createFunctionalNotationConsumer(
    'hsl',
    oneOf(
      [
        one(tryConsumeLegacyHslSyntax),
        one(tryConsumeModernHslSyntax),
      ],
      ([color]) => ok(color),
    ),
    (color) => color,
  );

function tryConsumeHslaFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeHslaFunction(c);
}

// <hsla()> = <legacy-hsla-syntax> | <modern-hsla-syntax>
const consumeHslaFunction: TryComponentConsumer<HslFn> =
  createFunctionalNotationConsumer(
    'hsla',
    oneOf(
      [
        one(tryConsumeLegacyHslaSyntax),
        one(tryConsumeModernHslaSyntax),
      ],
      ([color]) => ok(color),
    ),
    (color) => color,
  );

function tryConsumeLegacyHslSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeLegacyHslSyntax(c);
}

// <legacy-hsl-syntax> = hsl(<hue>, <percentage>, <percentage> [ , <alpha-value> ]?)
const consumeLegacyHslSyntax = createLegacyHslSyntaxConsumer();

function tryConsumeLegacyHslaSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeLegacyHslaSyntax(c);
}

// <legacy-hsla-syntax> = hsla(<hue>, <percentage>, <percentage> [ , <alpha-value> ]?)
const consumeLegacyHslaSyntax = createLegacyHslSyntaxConsumer();

function createLegacyHslSyntaxConsumer(): TryComponentConsumer<HslFn> {
  return sequenceOf(
    [
      one(withComponentTrivia(tryConsumeHue)),
      one(sequenceOf(
        [
          one(withComponentTrivia(tryConsumeComma)),
          one(withComponentTrivia(tryConsumePercentage)),
        ],
        ([, [percentage]]) => ok(percentage),
      )),
      one(sequenceOf(
        [
          one(withComponentTrivia(tryConsumeComma)),
          one(withComponentTrivia(tryConsumePercentage)),
        ],
        ([, [percentage]]) => ok(percentage),
      )),
      opt(sequenceOf(
        [
          one(withComponentTrivia(tryConsumeComma)),
          one(withComponentTrivia(tryConsumeAlphaValue)),
        ],
        ([, [alpha]]) => ok(alpha),
      )),
    ],
    ([[hue], [saturation], [lightness], alpha]) => ok({
      kind: ColorKind.HslFn,
      syntax: 'legacy',
      hue,
      saturation,
      lightness,
      alpha: alpha[0],
    }),
  );
}

function tryConsumeModernHslSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeModernHslSyntax(c);
}

// <modern-hsl-syntax> = hsl([ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const consumeModernHslSyntax = createModernHslSyntaxConsumer();

function tryConsumeModernHslaSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeModernHslaSyntax(c);
}

// <modern-hsla-syntax> = hsla([ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const consumeModernHslaSyntax = createModernHslSyntaxConsumer();

function createModernHslSyntaxConsumer(): TryComponentConsumer<HslFn> {
  return sequenceOf(
    [
      one(withComponentTrivia(oneOf(
        [
          one(tryConsumeHue),
          one(tryConsumeNone),
        ],
        ([hue]) => ok(hue),
      ))),
      repeat(withComponentTrivia(oneOf(
        [
          one(tryConsumePercentage),
          one(tryConsumeNumber),
          one(tryConsumeNone),
        ],
        ([component]) => ok(component),
      )), 2, 2),
      opt(tryConsumeModernAlpha),
    ],
    ([[hue], [saturation, lightness], alpha]) => ok({
      kind: ColorKind.HslFn,
      syntax: 'modern',
      hue,
      saturation,
      lightness,
      alpha: alpha[0],
    }),
  );
}

function tryConsumeHue(
  c: ComponentCursor,
): TryComponentConsumerResult<HueValue> {
  return consumeHue(c);
}

// <hue> = <number> | <angle>
const consumeHue: TryComponentConsumer<HueValue> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumeAngle),
  ],
  ([hue]) => ok(hue),
);

/*
 * <hwb()> = hwb(
 *   [ <hue> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type HwbFn = {
  kind: ColorKind.HwbFn;
  hue: SyntaxHueComponent;
  whiteness: SyntaxColorComponent;
  blackness: SyntaxColorComponent;
  alpha?: SyntaxAlphaComponent;
};

function tryConsumeHwbFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<HwbFn> {
  return consumeHwbFunction(c);
}

// <hwb()> = hwb([ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const consumeHwbFunction: TryComponentConsumer<HwbFn> =
  createFunctionalNotationConsumer(
    'hwb',
    sequenceOf(
      [
        one(withComponentTrivia(oneOf(
          [
            one(tryConsumeHue),
            one(tryConsumeNone),
          ],
          ([hue]) => ok(hue),
        ))),
        repeat(withComponentTrivia(oneOf(
          [
            one(tryConsumePercentage),
            one(tryConsumeNumber),
            one(tryConsumeNone),
          ],
          ([component]) => ok(component),
        )), 2, 2),
        opt(tryConsumeModernAlpha),
      ],
      ([[hue], [whiteness, blackness], alpha]) => ok({
        kind: ColorKind.HwbFn as const,
        hue,
        whiteness,
        blackness,
        alpha: alpha[0],
      }),
    ),
    (color) => color,
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

export type LabFn = {
  kind: ColorKind.LabFn;
  lightness: SyntaxColorComponent;
  a: SyntaxColorComponent;
  b: SyntaxColorComponent;
  alpha?: SyntaxAlphaComponent;
};

export type OklabFn = {
  kind: ColorKind.OklabFn;
  lightness: SyntaxColorComponent;
  a: SyntaxColorComponent;
  b: SyntaxColorComponent;
  alpha?: SyntaxAlphaComponent;
};

type LabArguments = {
  lightness: SyntaxColorComponent;
  a: SyntaxColorComponent;
  b: SyntaxColorComponent;
  alpha?: SyntaxAlphaComponent;
};

function tryConsumeLabFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<LabFn> {
  return consumeLabFunction(c);
}

// <lab()> = lab([ <percentage> | <number> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const consumeLabFunction: TryComponentConsumer<LabFn> =
  createLabFunctionConsumer(
    'lab',
    (arguments_) => ({
      kind: ColorKind.LabFn,
      ...arguments_,
    }),
  );

function tryConsumeOklabFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<OklabFn> {
  return consumeOklabFunction(c);
}

// <oklab()> = oklab([ <percentage> | <number> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const consumeOklabFunction: TryComponentConsumer<OklabFn> =
  createLabFunctionConsumer(
    'oklab',
    (arguments_) => ({
      kind: ColorKind.OklabFn,
      ...arguments_,
    }),
  );

function createLabFunctionConsumer<Color extends LabFn | OklabFn>(
  name: 'lab' | 'oklab',
  project: (arguments_: LabArguments) => Color,
): TryComponentConsumer<Color> {
  return createFunctionalNotationConsumer(
    name,
    sequenceOf(
      [
        repeat(withComponentTrivia(oneOf(
          [
            one(tryConsumePercentage),
            one(tryConsumeNumber),
            one(tryConsumeNone),
          ],
          ([component]) => ok(component),
        )), 3, 3),
        opt(tryConsumeModernAlpha),
      ],
      ([components, alpha]) => ok({
        lightness: components[0],
        a: components[1],
        b: components[2],
        alpha: alpha[0],
      }),
    ),
    project,
  );
}

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

export type LchFn = {
  kind: ColorKind.LchFn;
  lightness: SyntaxColorComponent;
  chroma: SyntaxColorComponent;
  hue: SyntaxHueComponent;
  alpha?: SyntaxAlphaComponent;
};

export type OklchFn = {
  kind: ColorKind.OklchFn;
  lightness: SyntaxColorComponent;
  chroma: SyntaxColorComponent;
  hue: SyntaxHueComponent;
  alpha?: SyntaxAlphaComponent;
};

type LchArguments = {
  lightness: SyntaxColorComponent;
  chroma: SyntaxColorComponent;
  hue: SyntaxHueComponent;
  alpha?: SyntaxAlphaComponent;
};

function tryConsumeLchFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<LchFn> {
  return consumeLchFunction(c);
}

// <lch()> = lch([ <percentage> | <number> | none ]{2} [ <hue> | none ] [ / [ <alpha-value> | none ] ]?)
const consumeLchFunction: TryComponentConsumer<LchFn> =
  createLchFunctionConsumer(
    'lch',
    (arguments_) => ({
      kind: ColorKind.LchFn,
      ...arguments_,
    }),
  );

function tryConsumeOklchFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<OklchFn> {
  return consumeOklchFunction(c);
}

// <oklch()> = oklch([ <percentage> | <number> | none ]{2} [ <hue> | none ] [ / [ <alpha-value> | none ] ]?)
const consumeOklchFunction: TryComponentConsumer<OklchFn> =
  createLchFunctionConsumer(
    'oklch',
    (arguments_) => ({
      kind: ColorKind.OklchFn,
      ...arguments_,
    }),
  );

function createLchFunctionConsumer<Color extends LchFn | OklchFn>(
  name: 'lch' | 'oklch',
  project: (arguments_: LchArguments) => Color,
): TryComponentConsumer<Color> {
  return createFunctionalNotationConsumer(
    name,
    sequenceOf(
      [
        repeat(withComponentTrivia(oneOf(
          [
            one(tryConsumePercentage),
            one(tryConsumeNumber),
            one(tryConsumeNone),
          ],
          ([component]) => ok(component),
        )), 2, 2),
        one(withComponentTrivia(oneOf(
          [
            one(tryConsumeHue),
            one(tryConsumeNone),
          ],
          ([hue]) => ok(hue),
        ))),
        opt(tryConsumeModernAlpha),
      ],
      ([components, [hue], alpha]) => ok({
        lightness: components[0],
        chroma: components[1],
        hue,
        alpha: alpha[0],
      }),
    ),
    project,
  );
}

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

export type ColorFn = {
  kind: ColorKind.ColorFn;
  space: ColorFnSpace;
  components: SyntaxTriplet;
  alpha?: SyntaxAlphaComponent;
};

type ColorFnSpace = PredefinedRgbSpace | XyzSpace;

type PredefinedRgbSpace =
  | 'srgb'
  | 'srgb-linear'
  | 'display-p3'
  | 'display-p3-linear'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020';

type XyzSpace = 'xyz' | 'xyz-d50' | 'xyz-d65';

type ColorFnSpaceParams = {
  space: ColorFnSpace;
  components: SyntaxTriplet;
};

function tryConsumeColorFunctionNotation(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFn> {
  return consumeColorFunctionNotation(c);
}

// <color()> = color(<colorspace-params> [ / [ <alpha-value> | none ] ]?)
const consumeColorFunctionNotation: TryComponentConsumer<ColorFn> =
  createFunctionalNotationConsumer(
    'color',
    sequenceOf(
      [
        one(tryConsumeColorSpaceParams),
        opt(tryConsumeModernAlpha),
      ],
      ([[params], alpha]) => ok({
        kind: ColorKind.ColorFn as const,
        ...params,
        alpha: alpha[0],
      }),
    ),
    (color) => color,
  );

function tryConsumeColorSpaceParams(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFnSpaceParams> {
  return consumeColorSpaceParams(c);
}

// <colorspace-params> = <predefined-rgb-params> | <xyz-params>
const consumeColorSpaceParams: TryComponentConsumer<ColorFnSpaceParams> = oneOf(
  [
    one(tryConsumePredefinedRgbParams),
    one(tryConsumeXyzParams),
  ],
  ([params]) => ok(params),
);

function tryConsumePredefinedRgbParams(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFnSpaceParams> {
  return consumePredefinedRgbParams(c);
}

// <predefined-rgb-params> = <predefined-rgb> [ <number> | <percentage> | none ]{3}
const consumePredefinedRgbParams: TryComponentConsumer<ColorFnSpaceParams> =
  sequenceOf(
    [
      one(withComponentTrivia(tryConsumePredefinedRgb)),
      repeat(withComponentTrivia(oneOf(
        [
          one(tryConsumeNumber),
          one(tryConsumePercentage),
          one(tryConsumeNone),
        ],
        ([component]) => ok(component),
      )), 3, 3),
    ],
    ([[space], components]) => ok({
      space,
      components,
    }),
  );

function tryConsumePredefinedRgb(
  c: ComponentCursor,
): TryComponentConsumerResult<PredefinedRgbSpace> {
  return consumePredefinedRgb(c);
}

// <predefined-rgb> = srgb | srgb-linear | display-p3 | display-p3-linear | a98-rgb | prophoto-rgb | rec2020
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
): TryComponentConsumerResult<ColorFnSpaceParams> {
  return consumeXyzParams(c);
}

// <xyz-params> = <xyz-space> [ <number> | <percentage> | none ]{3}
const consumeXyzParams: TryComponentConsumer<ColorFnSpaceParams> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeXyzSpace)),
    repeat(withComponentTrivia(oneOf(
      [
        one(tryConsumeNumber),
        one(tryConsumePercentage),
        one(tryConsumeNone),
      ],
      ([component]) => ok(component),
    )), 3, 3),
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

// <xyz-space> = xyz | xyz-d50 | xyz-d65
const consumeXyzSpace = createKeywordConsumer('xyz', 'xyz-d50', 'xyz-d65');

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

export type ColorInterpolationMethod =
  | { space: RectangularColorSpace; hue?: never; }
  | { space: PolarColorSpace; hue?: HueInterpolationMethod; };

export type HueInterpolationMethod =
  | 'shorter'
  | 'longer'
  | 'increasing'
  | 'decreasing';

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

// <color-interpolation-method> = in [ <rectangular-color-space> | <polar-color-space> <hue-interpolation-method>? ]
const consumeColorInterpolationMethod: TryComponentConsumer<ColorInterpolationMethod> =
  sequenceOf(
    [
      one(createKeywordConsumer('in')),
      one(withComponentTrivia(tryConsumeColorSpace)),
      opt(withComponentTrivia(tryConsumeHueInterpolationMethod)),
    ],
    ([, [space], hue]): TryComponentConsumerResult<ColorInterpolationMethod> => {
      if (isPolarColorSpace(space)) {
        return ok({
          space,
          hue: hue[0],
        });
      }

      return hue.length === 0
        ? ok({ space })
        : null;
    },
  );

function tryConsumeColorSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorSpace> {
  return consumeColorSpace(c);
}

// <color-space> = <rectangular-color-space> | <polar-color-space>
const consumeColorSpace: TryComponentConsumer<ColorSpace> = oneOf(
  [
    one(tryConsumeRectangularColorSpace),
    one(tryConsumePolarColorSpace),
  ],
  ([space]) => ok(space),
);

function tryConsumeRectangularColorSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<RectangularColorSpace> {
  const result = consumeRectangularColorSpace(c);

  return result === null || isBad(result)
    ? result
    : ok(result.value === 'xyz' ? 'xyz-d65' : result.value);
}

// <rectangular-color-space> = srgb | srgb-linear | display-p3 | display-p3-linear | a98-rgb | prophoto-rgb | rec2020 | lab | oklab | <xyz-space>
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

function tryConsumePolarColorSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<PolarColorSpace> {
  return consumePolarColorSpace(c);
}

// <polar-color-space> = hsl | hwb | lch | oklch
const consumePolarColorSpace =
  createKeywordConsumer('hsl', 'hwb', 'lch', 'oklch');

function isPolarColorSpace(space: ColorSpace): space is PolarColorSpace {
  return (
    space === 'hsl' ||
    space === 'hwb' ||
    space === 'lch' ||
    space === 'oklch'
  );
}

function tryConsumeHueInterpolationMethod(
  c: ComponentCursor,
): TryComponentConsumerResult<HueInterpolationMethod> {
  return consumeHueInterpolationMethod(c);
}

// <hue-interpolation-method> = [ shorter | longer | increasing | decreasing ] hue
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

/*
 * <quirky-color> = <number-token> | <dimension-token> | <ident-token>
 *
 * This conditional grammar is only enabled by the affected property parsers
 * in quirks mode. It represents an ordinary <hex-color>.
 */

function tryConsumeQuirkyColor(
  c: ComponentCursor,
): TryComponentConsumerResult<HexColor> {
  return consumeQuirkyColor(c);
}

// <quirky-color> = <number-token> | <dimension-token> | <ident-token>
const consumeQuirkyColor: TryComponentConsumer<HexColor> = (c) => {
  const start = c.pos();
  const component = c.next();
  let value: string;

  if (isTokenKind(component, TokenKind.Ident)) {
    value = component.value;
  } else if (
    isTokenKind(component, TokenKind.Number) &&
    component.flag === NumberTokenFlag.Integer
  ) {
    value = String(component.value).padStart(6, '0');
  } else if (
    isTokenKind(component, TokenKind.Dimension) &&
    component.flag === NumberTokenFlag.Integer
  ) {
    value = `${component.value}${component.unit}`.padStart(6, '0');
  } else {
    c.restore(start);
    return null;
  }

  if (
    (value.length !== 3 && value.length !== 6) ||
    !isHexadecimal(value)
  ) {
    c.restore(start);
    return null;
  }

  return ok({
    kind: ColorKind.Hex,
    text: `#${value}`,
  });
};



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
    case ColorKind.RgbFn:
    case ColorKind.HslFn:
    case ColorKind.HwbFn:
    case ColorKind.LabFn:
    case ColorKind.LchFn:
    case ColorKind.OklabFn:
    case ColorKind.OklchFn:
    case ColorKind.ColorFn:
      return resolveColorFunction(value, context);
    case ColorKind.ColorMixFn:
      return resolveColorMixFn(value, context);
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

function resolveColorMixFn(
  value: ColorMixFn,
  context: ColorResolutionContext,
): ColorValue {
  const [first, ...rest] = value.items;
  const items: [ColorMixItem, ...ColorMixItem[]] = [
    resolveColorMixItem(first, context),
    ...rest.map((item) => resolveColorMixItem(item, context)),
  ];
  const resolved = items.every(
    (item, index) => item === value.items[index],
  )
    ? value
    : { ...value, items };

  if (
    !isComputedColorStage(context.stage ?? 'declared') ||
    !items.every(isResolvedColorMixItem)
  ) {
    return resolved;
  }

  return calculateColorMix(items, value.method);
}

function resolveColorMixItem(
  item: ColorMixItem,
  context: ColorResolutionContext,
): ColorMixItem {
  const color = resolveColorValue(item.color, context);
  const percentage = item.percentage === undefined
    ? undefined
    : resolvePercentage(item.percentage, {
      ...colorCalculationContext(context, 'computed'),
      range: [0, 100],
    });

  return color === item.color && percentage === item.percentage
    ? item
    : { color, percentage };
}

function isResolvedColorMixItem(
  item: ColorMixItem,
): item is ResolvedColorMixItem {
  return (
    item.color.kind === ColorKind.Absolute &&
    (
      item.percentage === undefined ||
      item.percentage.type === 'percentage'
    )
  );
}

function resolveColorFunction(
  value: ColorFunction,
  context: ColorResolutionContext,
): ColorValue {
  const resolvedAlpha = resolveColorAlphaValue(value.alpha, context);
  const resolvedValue = resolvedAlpha === value.alpha
    ? value
    : { ...value, alpha: resolvedAlpha };

  switch (resolvedValue.kind) {
    case ColorKind.RgbFn:
      return resolveRgbFn(resolvedValue, resolvedAlpha, context);
    case ColorKind.HslFn:
      return resolveHslFn(resolvedValue, resolvedAlpha, context);
    case ColorKind.HwbFn:
      return resolveHwbFn(resolvedValue, resolvedAlpha, context);
    case ColorKind.LabFn:
      return resolveLabFn(resolvedValue, resolvedAlpha, context, false);
    case ColorKind.OklabFn:
      return resolveLabFn(resolvedValue, resolvedAlpha, context, true);
    case ColorKind.LchFn:
      return resolveLchFn(resolvedValue, resolvedAlpha, context, false);
    case ColorKind.OklchFn:
      return resolveLchFn(resolvedValue, resolvedAlpha, context, true);
    case ColorKind.ColorFn:
      return resolveColorFn(resolvedValue, resolvedAlpha, context);
    default:
      return assertNever(resolvedValue);
  }
}

function resolveRgbFn(
  value: RgbFn,
  alpha: SyntaxAlphaComponent,
  context: MathContext,
): AbsoluteColor | RgbFn | ColorFn {
  const { components: values } = value;

  if (
    alpha !== 'none' &&
    alpha.type !== 'math' &&
    alpha.value === 1 &&
    is8BitRgbComponents(values)
  ) {
    return {
      kind: ColorKind.Absolute,
      space: 'srgb',
      components: values.map(
        (component) => component.value,
      ) as AbsoluteTriplet,
      alpha: 0xff,
      isLegacySrgb: true,
      is8Bit: true,
    };
  }

  const components = resolveColorComponents(
    values,
    context,
  );
  const clamped = clampColorComponents(
    components,
    COLOR_COMPONENT_CLAMPING.rgb,
    context,
  );

  if (hasDeferredColorComponents(clamped)) {
    return {
      ...value,
      components: canonicalizeColorComponents(
        clamped,
        1,
        0xff / 100,
      ),
    };
  }

  if (isDeferredColorAlpha(alpha)) {
    return {
      kind: ColorKind.ColorFn,
      space: 'srgb',
      components: scaleRgbSyntaxComponents(clamped),
      alpha,
    };
  }

  const scaled = scaleColorComponents(
    clamped,
    1 / 0xff,
    1 / 100,
  );

  return {
    kind: ColorKind.Absolute,
    space: 'srgb',
    components: scaled,
    alpha: alpha === 'none' ? undefined : alpha.value,
    isLegacySrgb: true,
  };
}

function scaleRgbSyntaxComponents(
  values: SyntaxTriplet,
): SyntaxTriplet {
  return values.map((value) => {
    if (value === 'none') {
      return value;
    }

    if (value.type === 'math') {
      throw new Error('Deferred RGB components cannot be scaled');
    }

    return {
      type: 'number',
      value: value.value / (value.type === 'percentage' ? 100 : 0xff),
    };
  }) as SyntaxTriplet;
}

function is8BitRgbComponents(
  values: RgbFn['components'],
): values is [NumberLiteral, NumberLiteral, NumberLiteral] {
  return values.every(is8BitRgbComponent);
}

function is8BitRgbComponent(
  value: SyntaxColorComponent,
): value is NumberLiteral {
  return (
    value !== 'none' &&
    value.type === 'number' &&
    Number.isInteger(value.value) &&
    value.value >= 0 &&
    value.value <= 0xff
  );
}

function resolveHslFn(
  value: HslFn,
  alpha: SyntaxAlphaComponent,
  context: MathContext,
): AbsoluteColor | HslFn {
  const hue = resolveHue(value.hue, context);
  const components = resolveColorComponents(
    [value.saturation, value.lightness],
    context,
  );
  const clamped = clampColorComponents(
    [hue, ...components],
    COLOR_COMPONENT_CLAMPING.hsl,
    context,
  );
  const hueValue = normalizeHueValue(clamped[0]);

  if (
    hasDeferredColorComponents(clamped) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...value,
      hue: hueValue,
      saturation: clamped[1],
      lightness: clamped[2],
    };
  }

  const [, ...resolvedComponents] = clamped;
  const [saturation, lightness] = scaleColorComponents(
    resolvedComponents,
    1,
    1,
  );
  const absoluteHue = scaleHue(hueValue);
  const absolute: AbsoluteColor = {
    kind: ColorKind.Absolute,
    space: 'hsl',
    components: [absoluteHue, saturation, lightness],
    alpha: alpha === 'none' ? undefined : alpha.value,
  };

  return hasMissingColorComponent(absolute)
    ? absolute
    : convertToLegacySrgb(absolute);
}

function resolveHwbFn(
  value: HwbFn,
  alpha: SyntaxAlphaComponent,
  context: MathContext,
): AbsoluteColor | HwbFn {
  const hue = resolveHue(value.hue, context);
  const components = resolveColorComponents(
    [value.whiteness, value.blackness],
    context,
  );
  const clamped = clampColorComponents(
    [hue, ...components],
    COLOR_COMPONENT_CLAMPING.hwb,
    context,
  );
  const hueValue = normalizeHueValue(clamped[0]);

  if (
    hasDeferredColorComponents(clamped) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...value,
      hue: hueValue,
      whiteness: clamped[1],
      blackness: clamped[2],
    };
  }

  const [, ...resolvedComponents] = clamped;
  const [whiteness, blackness] = scaleColorComponents(
    resolvedComponents,
    1,
    1,
  );
  const absoluteHue = scaleHue(hueValue);
  const absolute: AbsoluteColor = {
    kind: ColorKind.Absolute,
    space: 'hwb',
    components: [absoluteHue, whiteness, blackness],
    alpha: alpha === 'none' ? undefined : alpha.value,
  };

  return hasMissingColorComponent(absolute)
    ? absolute
    : convertToLegacySrgb(absolute);
}

function convertToLegacySrgb(value: AbsoluteColor): AbsoluteColor {
  return {
    ...convertAbsoluteColor(value, 'srgb'),
    isLegacySrgb: true,
  };
}

function resolveLabFn(
  value: LabFn | OklabFn,
  alpha: SyntaxAlphaComponent,
  context: MathContext,
  ok: boolean,
): AbsoluteColor | LabFn | OklabFn {
  const components = resolveColorComponents(
    [value.lightness, value.a, value.b],
    context,
    'computed',
  );
  const clamped = clampColorComponents(
    components,
    ok
      ? COLOR_COMPONENT_CLAMPING.oklab
      : COLOR_COMPONENT_CLAMPING.lab,
    context,
  );
  const canonical = canonicalizeColorComponents(
    clamped,
    1,
    ok ? [1 / 100, 0.4 / 100, 0.4 / 100] : [1, 1.25, 1.25],
  );

  if (
    hasDeferredColorComponents(clamped) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...value,
      lightness: canonical[0],
      a: canonical[1],
      b: canonical[2],
    };
  }

  const scaled = scaleColorComponents(
    clamped,
    1,
    ok ? [1 / 100, 0.4 / 100, 0.4 / 100] : [1, 1.25, 1.25],
  );

  return {
    kind: ColorKind.Absolute,
    space: ok ? 'oklab' : 'lab',
    components: scaled,
    alpha: alpha === 'none' ? undefined : alpha.value,
  };
}

function resolveLchFn(
  value: LchFn | OklchFn,
  alpha: SyntaxAlphaComponent,
  context: MathContext,
  ok: boolean,
): AbsoluteColor | LchFn | OklchFn {
  const components = resolveColorComponents(
    [value.lightness, value.chroma],
    context,
    'computed',
  );
  const hue = resolveHue(value.hue, context, 'computed');
  const clamped = clampColorComponents(
    [...components, hue],
    ok
      ? COLOR_COMPONENT_CLAMPING.oklch
      : COLOR_COMPONENT_CLAMPING.lch,
    context,
  );
  const hueValue = normalizeHueValue(clamped[2]);
  const canonical = canonicalizeColorComponents(
    [clamped[0], clamped[1]],
    1,
    ok ? [1 / 100, 0.4 / 100] : [1, 1.5],
  );

  if (
    hasDeferredColorComponents(clamped) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...value,
      lightness: canonical[0],
      chroma: canonical[1],
      hue: hueValue,
    };
  }

  const [lightnessValue, chromaValue] = clamped;
  const [lightness, chroma] = scaleColorComponents(
    [lightnessValue, chromaValue],
    1,
    ok ? [1 / 100, 0.4 / 100] : [1, 1.5],
  );
  const absoluteHue = scaleHue(hueValue);

  return {
    kind: ColorKind.Absolute,
    space: ok ? 'oklch' : 'lch',
    components: [lightness, chroma, absoluteHue],
    alpha: alpha === 'none' ? undefined : alpha.value,
  };
}

function resolveColorFn(
  value: ColorFn,
  alpha: SyntaxAlphaComponent,
  context: MathContext,
): AbsoluteColor | ColorFn {
  const space = value.space === 'xyz' ? 'xyz-d65' : value.space;
  const components = resolveColorComponents(
    value.components,
    context,
    'computed',
  );
  const clamped = clampColorComponents(
    components,
    COLOR_COMPONENT_CLAMPING.colorFn,
    context,
  );
  const canonical = canonicalizeColorComponents(
    clamped,
    1,
    1 / 100,
  );

  if (
    hasDeferredColorComponents(clamped) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...value,
      space,
      components: canonical,
    };
  }

  const scaled = scaleColorComponents(clamped, 1, 1 / 100);

  return {
    kind: ColorKind.Absolute,
    space,
    components: scaled,
    alpha: alpha === 'none' ? undefined : alpha.value,
  };
}

function resolveColorComponents<
  const Values extends SyntaxColorComponent[],
>(
  values: Values,
  context: MathContext,
  unwrapMathAt: ValueStage = 'declared',
): { [Index in keyof Values]: SyntaxColorComponent } {
  return values.map(
    (value) => resolveColorComponent(
      value,
      context,
      unwrapMathAt,
    ),
  ) as { [Index in keyof Values]: SyntaxColorComponent };
}

function resolveColorComponent(
  value: SyntaxColorComponent,
  context: MathContext,
  unwrapMathAt: ValueStage,
): SyntaxColorComponent {
  if (value === 'none') {
    return value;
  }

  return resolveColorNumericValue(value, context, unwrapMathAt);
}

function hasDeferredColorComponents(
  values: readonly ClampableColorComponentValue[],
): boolean {
  return values.some(
    (value) => value !== 'none' && value.type === 'math',
  );
}

function canonicalizeColorComponents<const Values extends SyntaxColorComponent[]>(
  values: Values,
  numberScale: number | readonly number[],
  percentageScale: number | readonly number[],
): { [Index in keyof Values]: SyntaxColorComponent } {
  return values.map(
    (value, index) => {
      if (value === 'none' || value.type === 'math') {
        return value;
      }

      return {
        type: 'number',
        value: value.value * (
          value.type === 'percentage'
            ? scaleAt(percentageScale, index)
            : scaleAt(numberScale, index)
        ),
      };
    },
  ) as { [Index in keyof Values]: SyntaxColorComponent };
}

function scaleColorComponents<const Values extends SyntaxColorComponent[]>(
  values: Values,
  numberScale: number | readonly number[],
  percentageScale: number | readonly number[],
): { [Index in keyof Values]: AbsoluteComponent } {
  return values.map(
    (value, index) => {
      if (value === 'none') {
        return undefined;
      }

      if (value.type === 'math') {
        throw new Error('Deferred color components cannot be scaled');
      }

      return value.value * (
        value.type === 'percentage'
          ? scaleAt(percentageScale, index)
          : scaleAt(numberScale, index)
      );
    },
  ) as { [Index in keyof Values]: AbsoluteComponent };
}

function resolveColorAlphaValue(
  value: SyntaxAlphaComponent | undefined,
  context: ColorResolutionContext,
): SyntaxAlphaComponent {
  if (value === undefined) {
    return { type: 'number', value: 1 };
  }

  if (value === 'none') {
    return value;
  }

  if (value.type !== 'math') {
    return clampColorAlphaLiteral(value);
  }

  const calculationContext = colorCalculationContext(context, 'computed');
  const resolved = isNumberValue(value)
    ? resolveNumber(value, calculationContext)
    : resolvePercentage(value, calculationContext);

  if (resolved.type === 'math') {
    return resolved.valueType === 'percentage'
      ? tryCoercePercentageToNumber(resolved) ?? resolved
      : resolved;
  }

  return clampColorAlphaLiteral(resolved);
}

function clampColorAlphaLiteral(value: AlphaLiteral): NumberLiteral {
  const alpha = value.type === 'percentage'
    ? value.value / 100
    : value.value;
  const clamped = clamp(normalizeForClamping(alpha), 0, 1);

  return value.type === 'number' && Object.is(value.value, clamped)
    ? value
    : { type: 'number', value: clamped };
}

function isDeferredColorAlpha(
  value: SyntaxAlphaComponent,
): value is Exclude<AlphaValue, AlphaLiteral> {
  return value !== 'none' && value.type === 'math';
}

function resolveHue(
  value: SyntaxHueComponent,
  context: MathContext,
  unwrapMathAt: ValueStage = 'declared',
): SyntaxHueComponent {
  if (value === 'none') {
    return value;
  }

  const calculationContext = colorCalculationContext(context, unwrapMathAt);
  return isNumberValue(value)
    ? resolveNumber(value, calculationContext)
    : resolveAngle(value, calculationContext);
}

function scaleHue(
  value: SyntaxHueComponent,
): AbsoluteComponent {
  if (value === 'none') {
    return undefined;
  }

  if (value.type === 'math') {
    throw new Error('A deferred hue cannot be scaled');
  }

  return value.type === 'angle'
    ? resolveAngleLiteral(value).value
    : value.value;
}

function normalizeHueValue(
  value: SyntaxHueComponent,
): SyntaxHueComponent {
  if (value === 'none' || value.type === 'math') {
    return value;
  }

  const number = value.type === 'angle'
    ? resolveAngleLiteral(value)
    : value;
  const normalized = normalizeHue(number.value);

  return Object.is(normalized, number.value)
    ? number
    : { ...number, value: normalized };
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

type ClampableColorComponentValue =
  SyntaxColorComponent | SyntaxHueComponent;

type ClampableColorComponentValues =
  ColorTriplet<ClampableColorComponentValue>;

type ColorComponentRanges = readonly [
  ColorComponentRange | null,
  ColorComponentRange | null,
  ColorComponentRange | null,
];

type ColorComponentClamping = {
  numbers: ColorComponentRanges;
  percentages: ColorComponentRanges;
  nonFiniteAt: ValueStage;
};

const COLOR_COMPONENT_CLAMPING = {
  rgb: {
    numbers: [[0, 0xff], [0, 0xff], [0, 0xff]],
    percentages: [[0, 100], [0, 100], [0, 100]],
    nonFiniteAt: 'declared',
  },
  hsl: {
    numbers: [null, [0, Infinity], null],
    percentages: [null, [0, Infinity], null],
    nonFiniteAt: 'declared',
  },
  hwb: {
    numbers: [null, null, null],
    percentages: [null, null, null],
    nonFiniteAt: 'declared',
  },
  lab: {
    numbers: [[0, 100], null, null],
    percentages: [[0, 100], null, null],
    nonFiniteAt: 'computed',
  },
  oklab: {
    numbers: [[0, 1], null, null],
    percentages: [[0, 100], null, null],
    nonFiniteAt: 'computed',
  },
  lch: {
    numbers: [[0, 100], [0, Infinity], null],
    percentages: [[0, 100], [0, Infinity], null],
    nonFiniteAt: 'computed',
  },
  oklch: {
    numbers: [[0, 1], [0, Infinity], null],
    percentages: [[0, 100], [0, Infinity], null],
    nonFiniteAt: 'computed',
  },
  colorFn: {
    numbers: [null, null, null],
    percentages: [null, null, null],
    nonFiniteAt: 'computed',
  },
} as const satisfies Record<string, ColorComponentClamping>;

function clampColorComponents<
  const Values extends ClampableColorComponentValues,
>(
  components: Values,
  rules: ColorComponentClamping,
  context: MathContext,
): { [Index in keyof Values]: Values[Index] } {
  const clampNonFinite = isAtOrBeyondValueStage(
    context.stage ?? 'declared',
    rules.nonFiniteAt,
  );

  return components.map(
    (component, index) => {
      if (component === 'none' || component.type === 'math') {
        return component;
      }

      if (!clampNonFinite && !Number.isFinite(component.value)) {
        return component;
      }

      const clampable = normalizeForClamping(component.value);
      const ranges = component.type === 'percentage'
        ? rules.percentages
        : rules.numbers;
      const range = ranges[index] ?? null;

      const value = range === null
        ? clampable
        : clamp(clampable, ...range);

      return Object.is(value, component.value)
        ? component
        : { ...component, value };
    },
  ) as { [Index in keyof Values]: Values[Index] };
}

function normalizeForClamping(value: number): number {
  return Number.isNaN(value) || Object.is(value, -0)
    ? 0
    : value;
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
    space: 'srgb',
    components: [
      rgba >>> 24,
      (rgba >>> 16) & 0xff,
      (rgba >>> 8) & 0xff,
    ],
    alpha: rgba & 0xff,
    isLegacySrgb: true,
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
    case ColorKind.ColorMixFn:
      throw new TypeError('Color mixes must be resolved before serialization');
    case ColorKind.RgbFn:
    case ColorKind.HslFn:
    case ColorKind.HwbFn:
    case ColorKind.LabFn:
    case ColorKind.LchFn:
    case ColorKind.OklabFn:
    case ColorKind.OklchFn:
    case ColorKind.ColorFn:
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
    case ColorKind.RgbFn:
      return serializeRgbFn(value);
    case ColorKind.HslFn:
      return serializeHslFn(value);
    case ColorKind.HwbFn:
      return serializeModernColorFunction(
        'hwb',
        [
          serializeHue(value.hue),
          serializeColorComponent(value.whiteness, 100),
          serializeColorComponent(value.blackness, 100),
        ],
        value.alpha,
      );
    case ColorKind.LabFn:
    case ColorKind.OklabFn: {
      const oklab = value.kind === ColorKind.OklabFn;

      return serializeModernColorFunction(
        oklab ? 'oklab' : 'lab',
        [
          serializeColorComponent(value.lightness, null),
          serializeColorComponent(value.a, null),
          serializeColorComponent(value.b, null),
        ],
        value.alpha,
      );
    }
    case ColorKind.LchFn:
    case ColorKind.OklchFn: {
      const oklch = value.kind === ColorKind.OklchFn;

      return serializeModernColorFunction(
        oklch ? 'oklch' : 'lch',
        [
          serializeColorComponent(value.lightness, null),
          serializeColorComponent(value.chroma, null),
          serializeHue(value.hue),
        ],
        value.alpha,
      );
    }
    case ColorKind.ColorFn:
      return serializeModernColorFunction(
        'color',
        [
          value.space,
          ...value.components.map(
            (component) => serializeColorComponent(component, null),
          ),
        ],
        value.alpha,
      );
    default:
      return assertNever(value);
  }
}

function serializeRgbFn(
  value: RgbFn,
): string {
  const components = value.components.map(
    (component) => serializeColorComponent(component, null),
  );

  return value.syntax === 'legacy'
      && canUseLegacyColorSerialization([...value.components, value.alpha])
    ? serializeLegacyColorFunction('rgb', components, value.alpha)
    : serializeModernColorFunction('rgb', components, value.alpha);
}

function serializeHslFn(
  value: HslFn,
): string {
  const components = [
    serializeHue(value.hue),
    serializeColorComponent(value.saturation, 100),
    serializeColorComponent(value.lightness, 100),
  ];

  return value.syntax === 'legacy'
      && canUseLegacyColorSerialization([
        value.hue,
        value.saturation,
        value.lightness,
        value.alpha,
      ])
    ? serializeLegacyColorFunction('hsl', components, value.alpha)
    : serializeModernColorFunction('hsl', components, value.alpha);
}

function canUseLegacyColorSerialization(
  values: readonly (
    SyntaxColorComponent | SyntaxHueComponent | undefined
  )[],
): boolean {
  // Missing components and deferred math values require modern syntax.
  return values.every(
    (value) => value === undefined
      || (value !== 'none' && value.type !== 'math'),
  );
}

function serializeLegacyColorFunction(
  name: 'rgb' | 'hsl',
  components: string[],
  alphaValue: SyntaxAlphaComponent | undefined,
): string {
  const alpha = serializeColorAlpha(alphaValue);

  return alpha === null
    ? `${name}(${components.join(', ')})`
    : `${name}a(${components.join(', ')}, ${alpha})`;
}

function serializeModernColorFunction(
  name: string,
  components: string[],
  alphaValue: SyntaxAlphaComponent | undefined,
): string {
  const alpha = serializeColorAlpha(alphaValue);

  return alpha === null
    ? `${name}(${components.join(' ')})`
    : `${name}(${components.join(' ')} / ${alpha})`;
}

function serializeHue(
  value: SyntaxHueComponent,
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

  return serializeColorComponent(value, null);
}

function serializeColorComponent(
  value: SyntaxColorComponent,
  percentageReference: number | null, // null means canonical repr is a number, not a percentage
): string {
  if (value === 'none') {
    return value;
  }

  if (value.type !== 'math' && percentageReference !== null) {
    if (value.value === 0) {
      return '0';
    }

    const percentage = value.type === 'percentage'
      ? value.value
      : value.value / percentageReference * 100;

    return serializeCssNumber(percentage) + '%';
  }

  return isNumberValue(value)
    ? serializeNumber(value)
    : serializePercentage(value);
}

function serializeColorAlpha(
  value: SyntaxAlphaComponent | undefined,
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
    case 'srgb':
      return value.isLegacySrgb
        ? serializeAbsoluteRgb(value, htmlCompatible)
        : `color(srgb ${serializeAbsoluteColorComponentsBody(value)})`;
    case 'hsl':
      return serializeAbsoluteHsl(value);
    case 'hwb':
      return serializeAbsoluteHwb(value);
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch':
      return serializeAbsoluteColorComponents(value.space, value);
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
      ? component!
      : component! * 0xff),
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
  if (value === 0xff) {
    return null;
  }

  for (let percentage = 0; percentage <= 100; percentage++) {
    if (Math.round(percentage * 0xff / 100) === value) {
      return serializeCssNumber(percentage / 100);
    }
  }

  return serializeCssNumber(Math.round(value / 0.255) / 1000);
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

function serializeAbsoluteColorComponent(value: AbsoluteComponent): string {
  return value === undefined
    ? 'none'
    : serializeCssNumber(value);
}

function serializeAbsoluteColorPercentage(value: AbsoluteComponent): string {
  return value === undefined
    ? 'none'
    : `${serializeCssNumber(value)}%`;
}

function serializeAbsoluteColorAlpha(value: number | undefined): string | null {
  if (value === undefined) {
    return 'none';
  }

  return value === 1
    ? null
    : serializeCssNumber(value);
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
  target: ColorSpace,
): AbsoluteColor {
  if (
    value.space === target &&
    !value.isLegacySrgb &&
    !value.is8Bit
  ) {
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
  if (!value.isLegacySrgb && !value.is8Bit) {
    return value;
  }

  return {
    kind: ColorKind.Absolute,
    space: value.space,
    components: value.components.map(
      (component) => component === undefined
        ? component
        : value.is8Bit ? component / 0xff : component,
    ) as AbsoluteTriplet,
    alpha: value.alpha === undefined
      ? value.alpha
      : value.is8Bit ? value.alpha / 0xff : value.alpha,
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
  value: ColorSpace,
): RectangularColorSpace {
  switch (value) {
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

function colorSpaceWhitePoint(value: ColorSpace): WhitePoint {
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
  target: ColorSpace,
): AbsoluteColor {
  switch (target) {
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

export type GamutMappingMethod = 'binary-search' | 'clip';

export function gamutMapColor(
  origin: AbsoluteColor,
  destination: ColorSpace,
  method: GamutMappingMethod = 'binary-search',
): AbsoluteColor {
  if (!hasGamutLimits(destination)) {
    return convertAbsoluteColor(origin, destination);
  }

  if (method === 'clip') {
    return clipColorToGamut(origin, destination);
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

  if (isColorInGamut(originOklch, destination)) {
    return convertAbsoluteColor(originOklch, destination);
  }

  let current: AbsoluteColor = {
    ...originOklch,
    components: [lightness, originChroma, hue],
  };
  let clipped = clipColorToGamut(current, destination);
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

    if (minInGamut && isColorInGamut(current, destination)) {
      min = chroma;
      continue;
    }

    clipped = clipColorToGamut(current, destination);
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

function isColorInGamut(
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

function clipColorToGamut(
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

export function deltaE2000(
  reference: AbsoluteColor,
  sample: AbsoluteColor,
): number {
  const [lightness1, a1, b1] = componentsForConversion(
    convertAbsoluteColor(reference, 'lab'),
  );
  const [lightness2, a2, b2] = componentsForConversion(
    convertAbsoluteColor(sample, 'lab'),
  );
  const chroma1 = Math.sqrt(a1 ** 2 + b1 ** 2);
  const chroma2 = Math.sqrt(a2 ** 2 + b2 ** 2);
  const meanChroma = (chroma1 + chroma2) / 2;
  const meanChroma7 = meanChroma ** 7;
  const chroma25To7 = 25 ** 7;
  const asymmetry = 0.5 * (
    1 - Math.sqrt(meanChroma7 / (meanChroma7 + chroma25To7))
  );
  const adjustedA1 = (1 + asymmetry) * a1;
  const adjustedA2 = (1 + asymmetry) * a2;
  const adjustedChroma1 = Math.sqrt(adjustedA1 ** 2 + b1 ** 2);
  const adjustedChroma2 = Math.sqrt(adjustedA2 ** 2 + b2 ** 2);
  const hue1 = labHueInDegrees(adjustedA1, b1);
  const hue2 = labHueInDegrees(adjustedA2, b2);
  const deltaLightness = lightness2 - lightness1;
  const deltaChroma = adjustedChroma2 - adjustedChroma1;
  const hueDifference = hue2 - hue1;
  const absoluteHueDifference = Math.abs(hueDifference);
  const hueSum = hue1 + hue2;
  let deltaHue: number;

  if (adjustedChroma1 * adjustedChroma2 === 0) {
    deltaHue = 0;
  } else if (absoluteHueDifference <= 180) {
    deltaHue = hueDifference;
  } else if (hueDifference > 180) {
    deltaHue = hueDifference - 360;
  } else {
    deltaHue = hueDifference + 360;
  }

  const degreesToRadians = Math.PI / 180;
  const weightedDeltaHue = (
    2
    * Math.sqrt(adjustedChroma1 * adjustedChroma2)
    * Math.sin(deltaHue * degreesToRadians / 2)
  );
  const meanLightness = (lightness1 + lightness2) / 2;
  const meanAdjustedChroma = (adjustedChroma1 + adjustedChroma2) / 2;
  const meanAdjustedChroma7 = meanAdjustedChroma ** 7;
  let meanHue: number;

  if (adjustedChroma1 * adjustedChroma2 === 0) {
    meanHue = hueSum;
  } else if (absoluteHueDifference <= 180) {
    meanHue = hueSum / 2;
  } else if (hueSum < 360) {
    meanHue = (hueSum + 360) / 2;
  } else {
    meanHue = (hueSum - 360) / 2;
  }

  const lightnessOffset = (meanLightness - 50) ** 2;
  const lightnessWeight = (
    1
    + 0.015 * lightnessOffset / Math.sqrt(20 + lightnessOffset)
  );
  const chromaWeight = 1 + 0.045 * meanAdjustedChroma;
  const hueWeightFactor = (
    1
    - 0.17 * Math.cos((meanHue - 30) * degreesToRadians)
    + 0.24 * Math.cos(2 * meanHue * degreesToRadians)
    + 0.32 * Math.cos((3 * meanHue + 6) * degreesToRadians)
    - 0.20 * Math.cos((4 * meanHue - 63) * degreesToRadians)
  );
  const hueWeight = (
    1
    + 0.015 * meanAdjustedChroma * hueWeightFactor
  );
  const rotationAngle = (
    30
    * Math.exp(-(((meanHue - 275) / 25) ** 2))
  );
  const rotationChroma = (
    2
    * Math.sqrt(
      meanAdjustedChroma7
      / (meanAdjustedChroma7 + chroma25To7),
    )
  );
  const rotation = (
    -Math.sin(2 * rotationAngle * degreesToRadians)
    * rotationChroma
  );
  const lightnessTerm = deltaLightness / lightnessWeight;
  const chromaTerm = deltaChroma / chromaWeight;
  const hueTerm = weightedDeltaHue / hueWeight;

  return Math.sqrt(
    lightnessTerm ** 2
    + chromaTerm ** 2
    + hueTerm ** 2
    + rotation * chromaTerm * hueTerm,
  );
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

function labHueInDegrees(a: number, b: number): number {
  if (a === 0 && b === 0) {
    return 0;
  }

  const hue = Math.atan2(b, a) * 180 / Math.PI;
  return hue < 0 ? hue + 360 : hue;
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
  return replacePowerlessComponents(
    normalizeColorEncoding(value),
  );
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
  a: AbsoluteComponent,
  b: AbsoluteComponent,
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
  space ??= (a.isLegacySrgb && b.isLegacySrgb
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
  ) as AbsoluteTriplet;
  const componentsB = b.components.map((component, index) =>
    carriedB.components[index]
      ? carriedA.components[index]
        ? undefined
        : a.components[index]
      : component,
  ) as AbsoluteTriplet;

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

function componentCategories(space: ColorSpace): [
  ColorComponentCategory | undefined,
  ColorComponentCategory | undefined,
  ColorComponentCategory | undefined,
] {
  switch (space) {
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

  const componentsA: AbsoluteTriplet = [...a.components];
  const componentsB: AbsoluteTriplet = [...b.components];
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
  const components: AbsoluteTriplet = [
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
  a: AbsoluteComponent,
  b: AbsoluteComponent,
  progress: number,
): AbsoluteComponent {
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
): AbsoluteTriplet {
  return [
    value.components[0] === undefined ? undefined : components[0],
    value.components[1] === undefined ? undefined : components[1],
    value.components[2] === undefined ? undefined : components[2],
  ];
}

function colorHueIndex(space: ColorSpace): 0 | 2 | undefined {
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



// ██     ██ ████ ██     ██
// ███   ███  ██   ██   ██
// ████ ████  ██    ██ ██
// ██ ███ ██  ██     ███
// ██     ██  ██    ██ ██
// ██     ██  ██   ██   ██
// ██     ██ ████ ██     ██

export type ResolvedColorMixItem = {
  color: AbsoluteColor;
  percentage?: PercentageLiteral;
};

export function calculateColorMix(
  items: readonly ResolvedColorMixItem[],
  method: ColorInterpolationMethod = { space: 'oklab' },
): AbsoluteColor {
  if (items.length === 0) {
    throw new TypeError('A color mix requires at least one item');
  }

  const { percentages, leftover } = normalizeMixPercentages(
    items.map((item) => item.percentage?.value),
    true,
  );
  let color = items.length === 1
    ? convertAbsoluteColor(items[0]!.color, method.space)
    : items[0]!.color;
  let combinedPercentage = percentages[0]!;

  for (let index = 1; index < items.length; index++) {
    const item = items[index]!;
    const percentage = percentages[index]!;
    const nextCombinedPercentage = combinedPercentage + percentage;
    const progress = nextCombinedPercentage > 0
      ? percentage / nextCombinedPercentage
      : 0.5;

    color = interpolateColors(
      color,
      item.color,
      progress,
      method.space,
      method.hue,
    );
    combinedPercentage = nextCombinedPercentage;
  }

  if (color.alpha === undefined) {
    return color;
  }

  return {
    ...color,
    alpha: color.alpha * (1 - leftover / 100),
  };
}
