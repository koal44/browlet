import { asciiLower } from '../../shared/css';
import { assertNever, clamp, mapTuple, type SameArityTuple } from '../../shared/util';
import { type TokenCursor, type TryConsumer, type TryConsumerResult } from '../syntax/token-cursor';
import {
  createFunctionalNotationConsumer, consumeComma, consumeDimensionToken,
  consumeHashToken, consumeIdentToken, consumeIntegerToken, consumeSlashDelim,
} from '../syntax/component-consumers';
import {
  allOf, commaRepeat, one, oneOf, opt, plus, adaptConsumer, repeat, sequenceOf, withTrivia,
} from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { NumberTokenFlag } from '../syntax/tokens';
import { ValueStage } from '../value-processing/stage';
import { resolveAngle, serializeAngle, consumeAngle, type AngleValue } from './angle';
import {
  coercePercentageMathToNumber, promoteNumericVariable, tryGetMathVariableName, type MathContext,
  type NumericVariable,
} from './math-value';
import { completeMixPercentages, normalizeMixPercentages } from './mix';
import { consumeDashedIdent, type DashedIdentValue } from './dashed-ident';
import { consumeIdent } from './ident';
import { createKeywordConsumer } from './keyword';
import { canonicalizeAngle } from './numeric-literal/angle';
import { serializeCssNumber, type NumberLiteral } from './numeric-literal/number';
import { type PercentageLiteral } from './numeric-literal/percentage';
import { resolveNumber, serializeNumber, consumeNumber, type NumberValue } from './number';
import {
  createPercentageConsumer, resolvePercentage, serializePercentage, consumePercentage,
  type PercentageValue,
} from './percentage';
import type { ValueDefinition } from '../value-processing/definition';

// Resolved representation of a color in an identified coordinate space. It
// has an intrinsic colorimetric interpretation when its space is predefined;
// other spaces require external conversion context. Undefined components
// represent the `none` keyword.
export type AbsoluteColor<
  Space extends AbsoluteColorSpace = AbsoluteColorSpace,
> = {
  kind: ColorKind.Absolute;
  space: Space;
  components: ColorComponentTuple<
    Space,
    SameArityTuple<Space['keys'], AbsoluteComponent>
  >;
  alpha: number | undefined;
  // Retains legacy rgb()/rgba() serialization and interpolation behavior.
  isLegacySrgb: boolean;
  // Components and alpha are stored as 8-bit integers.
  is8Bit?: true;
};

export type AbsoluteColorSpace =
  | PredefinedColorSpace
  | CustomColorSpace
  | DeviceCmykSpace;

export type CustomColorSpace<
  Keys extends readonly string[] = readonly string[],
> = ColorSpace<DashedIdentValue['value'], Keys>;

export type PredefinedAbsoluteColor = AbsoluteColor<PredefinedColorSpace>;

type ColorFunctionSpace =
  | ColorFnSpace
  | DashedIdentValue['value'];

export type ColorProfileSpace =
  | ColorFunctionSpace
  | DeviceCmykSpace['name'];

export type ColorProfileComponentValues<
  Components extends readonly string[] = readonly string[],
> = Readonly<SameArityTuple<Components, number>>;

export type ColorProfile<
  Space extends ColorProfileSpace = ColorProfileSpace,
  Components extends readonly string[] = readonly string[],
> = {
  space: Space;
  components: Components;
  toAbsoluteColor(
    components: ColorProfileComponentValues<Components>,
  ): PredefinedAbsoluteColor;
  fromAbsoluteColor(
    color: PredefinedAbsoluteColor,
  ): ColorProfileComponentValues<Components> | null;
};

type WhitePoint = 'd50' | 'd65';

export type ColorSpace<
  Name extends string = string,
  Keys extends readonly string[] = readonly string[],
> = {
  name: Name;
  keys: Keys;
};

const SRGB_SPACE = defineColorSpace('srgb', ['r', 'g', 'b'], 'd65');
const LINEAR_SRGB_SPACE = defineColorSpace('srgb-linear', ['r', 'g', 'b'], 'd65');
const HSL_SPACE = defineColorSpace('hsl', ['h', 's', 'l'], 'd65');
const HWB_SPACE = defineColorSpace('hwb', ['h', 'w', 'b'], 'd65');
const LAB_SPACE = defineColorSpace('lab', ['l', 'a', 'b'], 'd50');
const LCH_SPACE = defineColorSpace('lch', ['l', 'c', 'h'], 'd50');
const OKLAB_SPACE = defineColorSpace('oklab', ['l', 'a', 'b'], 'd65');
const OKLCH_SPACE = defineColorSpace('oklch', ['l', 'c', 'h'], 'd65');
const DISPLAY_P3_SPACE = defineColorSpace('display-p3', ['r', 'g', 'b'], 'd65');
const LINEAR_DISPLAY_P3_SPACE = defineColorSpace('display-p3-linear', ['r', 'g', 'b'], 'd65');
const A98_RGB_SPACE = defineColorSpace('a98-rgb', ['r', 'g', 'b'], 'd65');
const PROPHOTO_RGB_SPACE = defineColorSpace('prophoto-rgb', ['r', 'g', 'b'], 'd50');
const REC2020_SPACE = defineColorSpace('rec2020', ['r', 'g', 'b'], 'd65');
const XYZ_D50_SPACE = defineColorSpace('xyz-d50', ['x', 'y', 'z'], 'd50');
const XYZ_D65_SPACE = defineColorSpace('xyz-d65', ['x', 'y', 'z'], 'd65');
const DEVICE_CMYK_SPACE = { name: 'device-cmyk', keys: ['c', 'm', 'y', 'k'] } as const;

type SrgbSpace = typeof SRGB_SPACE;
type LinearSrgbSpace = typeof LINEAR_SRGB_SPACE;
type HslSpace = typeof HSL_SPACE;
type HwbSpace = typeof HWB_SPACE;
type LabSpace = typeof LAB_SPACE;
type LchSpace = typeof LCH_SPACE;
type OklabSpace = typeof OKLAB_SPACE;
type OklchSpace = typeof OKLCH_SPACE;
type DisplayP3Space = typeof DISPLAY_P3_SPACE;
type LinearDisplayP3Space = typeof LINEAR_DISPLAY_P3_SPACE;
type A98RgbSpace = typeof A98_RGB_SPACE;
type ProphotoRgbSpace = typeof PROPHOTO_RGB_SPACE;
type Rec2020Space = typeof REC2020_SPACE;
type XyzD50Space = typeof XYZ_D50_SPACE;
type XyzD65Space = typeof XYZ_D65_SPACE;
export type DeviceCmykSpace = typeof DEVICE_CMYK_SPACE;

type PredefinedRgbColorSpace =
  | SrgbSpace
  | LinearSrgbSpace
  | DisplayP3Space
  | LinearDisplayP3Space
  | A98RgbSpace
  | ProphotoRgbSpace
  | Rec2020Space;

type XyzColorSpace = XyzD50Space | XyzD65Space;

type PredefinedRgbSpace = PredefinedRgbColorSpace['name'];
type ColorFnSpace = PredefinedRgbSpace | XyzColorSpace['name'];

type RectangularColorSpace =
  | PredefinedRgbColorSpace
  | LabSpace
  | OklabSpace
  | XyzColorSpace;

type PolarColorSpace = HslSpace | HwbSpace | LchSpace | OklchSpace;
export type PredefinedColorSpace = RectangularColorSpace | PolarColorSpace;

type RectangularColorSpaceName = RectangularColorSpace['name'];
type PolarColorSpaceName = PolarColorSpace['name'];
export type ColorSpaceName = PredefinedColorSpace['name'];

export const SPACES = {
  srgb: SRGB_SPACE,
  'srgb-linear': LINEAR_SRGB_SPACE,
  hsl: HSL_SPACE,
  hwb: HWB_SPACE,
  lab: LAB_SPACE,
  lch: LCH_SPACE,
  oklab: OKLAB_SPACE,
  oklch: OKLCH_SPACE,
  'display-p3': DISPLAY_P3_SPACE,
  'display-p3-linear': LINEAR_DISPLAY_P3_SPACE,
  'a98-rgb': A98_RGB_SPACE,
  'prophoto-rgb': PROPHOTO_RGB_SPACE,
  rec2020: REC2020_SPACE,
  'xyz-d50': XYZ_D50_SPACE,
  'xyz-d65': XYZ_D65_SPACE,
} satisfies Record<ColorSpaceName, PredefinedColorSpace>;

function defineColorSpace<
  const Name extends string,
  const Keys extends readonly string[],
>(
  name: Name,
  keys: Keys,
  whitePoint: WhitePoint,
) {
  return { name, keys, whitePoint };
}

type AbsoluteComponent = number | undefined;
type ColorComponentTuple<
  Space extends ColorSpace,
  Components extends SameArityTuple<Space['keys'], unknown>,
> = Components;

type ColorFunctionComponentTuple<
  Space extends ColorSpace,
  Components extends SameArityTuple<Space['keys'], unknown>,
> = [...Components, alpha: SyntaxAlphaComponent | undefined];

type VariadicColorFunctionComponents = [
  ...coordinates: SyntaxComponent[],
  alpha: SyntaxAlphaComponent | undefined,
];

type SyntaxComponent =
  | SyntaxNonHueComponent
  | SyntaxHueComponent
  | undefined;

type SyntaxNonHueComponent = NonHueValue | 'none';
type NonHueValue = NumberValue | PercentageValue;

type SyntaxAlphaComponent = AlphaValue | 'none';
type AlphaValue = NumberValue | PercentageValue;

type SyntaxHueComponent = HueValue | 'none';
type HueValue = NumberValue | AngleValue;

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
  AlphaFn,
  ColorFn,
  CustomColorFn,
  DeviceCmykFn,
  LightDarkColor,
  Absolute,
  ColorMixFn,
  ContrastColorFn,
}

export function defineColorProfile<
  const Space extends ColorProfileSpace,
  const Components extends readonly string[],
>(
  profile: ColorProfile<Space, Components>,
): ColorProfile<Space, Components> {
  return profile;
}

const PROFILES = {
  srgb: builtinColorProfile('srgb', ['r', 'g', 'b']),
  'srgb-linear': builtinColorProfile('srgb-linear', ['r', 'g', 'b']),
  'display-p3': builtinColorProfile('display-p3', ['r', 'g', 'b']),
  'display-p3-linear': builtinColorProfile('display-p3-linear', ['r', 'g', 'b']),
  'a98-rgb': builtinColorProfile('a98-rgb', ['r', 'g', 'b']),
  'prophoto-rgb': builtinColorProfile('prophoto-rgb', ['r', 'g', 'b']),
  rec2020: builtinColorProfile('rec2020', ['r', 'g', 'b']),
  'xyz-d50': builtinColorProfile('xyz-d50', ['x', 'y', 'z']),
  'xyz-d65': builtinColorProfile('xyz-d65', ['x', 'y', 'z']),
} satisfies Record<ColorFnSpace, ColorProfile>;

function builtinColorProfile<
  const Space extends ColorFnSpace,
  const First extends string,
  const Second extends string,
  const Third extends string,
>(
  space: Space,
  components: readonly [First, Second, Third],
): ColorProfile<Space, readonly [First, Second, Third]> {
  return defineColorProfile({
    space,
    components,
    toAbsoluteColor: (values) =>
      absoluteColorInPredefinedSpace(SPACES[space], values, 1),
    fromAbsoluteColor: (color) => {
      const values = convertPredefinedAbsoluteColor(
        normalizeAbsoluteColorEncoding(color),
        space,
      ).components;

      return mapTuple(values, (value) => value ?? 0);
    },
  });
}

/*
 * <color> = <color-base> | currentColor | <system-color> |
 *           <contrast-color()> | <device-cmyk()> |
 *           <light-dark-color> | <quirky-color>
 *
 * <color-base> = <hex-color> | <color-function> | <named-color> |
 *                <color-mix()>
 *
 * <color-function> = <rgb()> | <rgba()> |
 *                    <hsl()> | <hsla()> | <hwb()> |
 *                    <lab()> | <lch()> | <oklab()> | <oklch()> |
 *                    <alpha()> |
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
  | DeprecatedColor
  | ContrastColorFn
  | DeviceCmykFn
  | LightDarkColor;

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
  | AlphaFn
  | ColorFn;

export type RelativeColorFunction =
  ColorFunction & { origin: ColorValue; };

export const colorDef: ValueDefinition<ColorValue, ColorValueContext> = {
  consume: consumeColor,
  resolve: resolveColorValue,
  serialize: serializeColorValue,
};

/** Whether a color belongs to the legacy sRGB interpolation category. */
export function isLegacySrgbColor(color: ColorValue): boolean {
  switch (color.kind) {
    case ColorKind.Named:
    case ColorKind.Hex:
      return true;
    case ColorKind.RgbFn:
    case ColorKind.HslFn:
    case ColorKind.HwbFn:
      return color.origin === undefined;
    case ColorKind.Absolute:
      return color.isLegacySrgb;
    default:
      return false;
  }
}

export function parseColorValue(
  input: ParserInput,
  context: ColorValueContext = {},
  allowQuirkyColor = false,
): ColorValue | null {
  return (
    allowQuirkyColor
      ? colorInQuirksModeParser
      : colorParser
  )(input, context);
}

export function consumeColor(
  c: TokenCursor,
  allowQuirkyColor = false,
): TryConsumerResult<ColorValue> {
  return (
    allowQuirkyColor
      ? declaredColorInQuirksModeConsumer
      : declaredColorConsumer
  )(c);
}

// <color> = <color-base> | currentColor | <system-color> | <contrast-color()> | <device-cmyk()> | <light-dark-color>
const colorConsumer: TryConsumer<ColorValue> = oneOf(
  [
    one(consumeColorBase),
    one(consumeCurrentColor),
    one(consumeSystemColor),
    one(consumeDeprecatedColor),
    one(consumeContrastColorFn),
    one(consumeDeviceCmykFn),
    one(consumeLightDarkColor),
  ],
  ([value]) => value,
);

// <color> = <color-base> | currentColor | <system-color> | <contrast-color()> | <device-cmyk()> | <light-dark-color> | <quirky-color>
const colorInQuirksModeConsumer: TryConsumer<ColorValue> = oneOf(
  [
    one(colorConsumer),
    one(consumeQuirkyColor),
  ],
  ([value]) => value,
);

const declaredColorConsumer = adaptConsumer(
  colorConsumer,
  (value, context) =>
    resolveColorValue(value, ValueStage.Declared, colorValueContextFor(context)),
);

const declaredColorInQuirksModeConsumer = adaptConsumer(
  colorInQuirksModeConsumer,
  (value, context) =>
    resolveColorValue(value, ValueStage.Declared, colorValueContextFor(context)),
);

const colorParser = createComponentParser(withTrivia(declaredColorConsumer));
const colorInQuirksModeParser = createComponentParser(
  withTrivia(declaredColorInQuirksModeConsumer),
);

function consumeColorBase(
  c: TokenCursor,
): TryConsumerResult<ColorBase> {
  return colorBaseConsumer(c);
}

// <color-base> = <hex-color> | <color-function> | <named-color> | <color-mix()>
const colorBaseConsumer: TryConsumer<ColorBase> = oneOf(
  [
    one(consumeHexColor),
    one(consumeColorFunction),
    one(consumeNamedColor),
    one(consumeColorMixFn),
  ],
  ([value]) => value,
);

function consumeColorFunction(
  c: TokenCursor,
): TryConsumerResult<ColorFunction> {
  return colorFunctionConsumer(c);
}

// <color-function> = <rgb()> | <rgba()> | <hsl()> | <hsla()> | <hwb()> | <lab()> | <lch()> | <oklab()> | <oklch()> | <alpha()> | <color()>
const colorFunctionConsumer: TryConsumer<ColorFunction> = oneOf(
  [
    one(consumeRgbFunction),
    one(consumeRgbaFunction),
    one(consumeHslFunction),
    one(consumeHslaFunction),
    one(consumeHwbFunction),
    one(consumeLabFunction),
    one(consumeLchFunction),
    one(consumeOklabFunction),
    one(consumeOklchFunction),
    one(consumeAlphaFunction),
    one(consumeColorFunctionNotation),
  ],
  ([value]) => value,
);

function consumeModernAlpha(
  c: TokenCursor,
): TryConsumerResult<SyntaxAlphaComponent> {
  return modernAlphaConsumer(c);
}

const modernAlphaConsumer: TryConsumer<SyntaxAlphaComponent> =
  sequenceOf(
    [
      one(withTrivia(consumeSlashDelim)),
      one(withTrivia(oneOf(
        [
          one(consumeAlphaValue),
          one(consumeNone),
          one(consumeRelativeColorKeyword),
        ],
        ([alpha]) => alpha,
      ))),
    ],
    ([, [alpha]]) => alpha,
  );

function consumeAlphaValue(
  c: TokenCursor,
): TryConsumerResult<AlphaValue> {
  return alphaValueConsumer(c);
}

// <alpha-value> = <number> | <percentage>
const alphaValueConsumer: TryConsumer<AlphaValue> =
  oneOf(
    [
      one(consumeNumber),
      one(consumePercentage),
    ],
    ([alpha]) => alpha,
  );

function consumeNone(
  c: TokenCursor,
): TryConsumerResult<'none'> {
  return noneConsumer(c);
}

const noneConsumer = createKeywordConsumer('none');

/*
 * <hex-color> = <hash-token> whose value consists of
 *               3, 4, 6, or 8 hexadecimal digits
 */

export type HexColor = {
  kind: ColorKind.Hex;
  text: string;
};

function consumeHexColor(
  c: TokenCursor,
): TryConsumerResult<HexColor> {
  return hexColorConsumer(c);
}

// <hex-color> = <hash-token> whose value consists of 3, 4, 6, or 8 hexadecimal digits
const hexColorConsumer: TryConsumer<HexColor> = adaptConsumer(
  consumeHashToken,
  (token) => isHexColorValue(token.value)
    ? { kind: ColorKind.Hex, text: `#${token.value}` }
    : null,
);

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

function consumeNamedColor(
  c: TokenCursor,
): TryConsumerResult<NamedColor> {
  return namedColorConsumer(c);
}

// <named-color>
const namedColorConsumer: TryConsumer<NamedColor> = adaptConsumer(
  consumeIdent,
  (ident) => {
    const name = asciiLower(ident.value);
    const rgba = Object.hasOwn(ColorRgba, name)
      ? ColorRgba[name as keyof typeof ColorRgba]
      : undefined;

    return rgba === undefined
      ? null
      : { kind: ColorKind.Named, name: name as ColorName };
  },
);

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
 *   [ <color> && <percentage [0,100]>? ]#)
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

function consumeColorMixFn(
  c: TokenCursor,
): TryConsumerResult<ColorMixFn> {
  return colorMixFnConsumer(c);
}

const colorMixPercentageConsumer =
  createPercentageConsumer({ min: 0, max: 100 });

// <color-mix()> = color-mix(<color-interpolation-method>? , [ <color> && <percentage [0,100]>? ]#)
const colorMixFnConsumer: TryConsumer<ColorMixFn> =
  createFunctionalNotationConsumer(
    'color-mix',
    sequenceOf(
      [
        opt(sequenceOf(
          [
            one(consumeColorInterpolationMethod),
            one(withTrivia(consumeComma)),
          ],
          ([[method]]) => method,
        )),
        commaRepeat(allOf(
          [
            one(withTrivia(consumeColor)),
            opt(withTrivia(colorMixPercentageConsumer)),
          ],
          ([[color], [percentage]]) => ({
            color,
            percentage,
          }),
        )),
      ],
      ([[method], items]) => ({
        kind: ColorKind.ColorMixFn as const,
        method,
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

function consumeSystemColor(
  c: TokenCursor,
): TryConsumerResult<SystemColor> {
  return systemColorConsumer(c);
}

// <system-color>
const systemColorConsumer: TryConsumer<SystemColor> = adaptConsumer(
  consumeIdent,
  (ident) => {
    const name = asciiLower(ident.value);

    return SystemColorNameSet.has(name)
      ? { kind: ColorKind.System, name: name as SystemColorName }
      : null;
  },
);

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

function consumeDeprecatedColor(
  c: TokenCursor,
): TryConsumerResult<DeprecatedColor> {
  return deprecatedColorConsumer(c);
}

// <deprecated-color>
const deprecatedColorConsumer: TryConsumer<DeprecatedColor> = adaptConsumer(
  consumeIdent,
  (ident) => {
    const name = asciiLower(ident.value);

    return Object.hasOwn(DeprecatedColorSystemName, name)
      ? { kind: ColorKind.Deprecated, name: name as DeprecatedColorName }
      : null;
  },
);

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

function consumeCurrentColor(
  c: TokenCursor,
): TryConsumerResult<CurrentColor> {
  return currentColorConsumer(c);
}

const currentColorConsumer: TryConsumer<CurrentColor> = adaptConsumer(
  createKeywordConsumer('currentcolor'),
  () => ({ kind: ColorKind.CurrentColor }),
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
  useLegacySyntax: boolean;
  origin?: ColorValue;
  components: ColorFunctionComponentTuple<SrgbSpace, [
    red: SyntaxNonHueComponent,
    green: SyntaxNonHueComponent,
    blue: SyntaxNonHueComponent,
  ]>;
};

function consumeRgbFunction(
  c: TokenCursor,
): TryConsumerResult<RgbFn> {
  return rgbFunctionConsumer(c);
}

// <rgb()> = <legacy-rgb-syntax> | <modern-rgb-syntax>
const rgbFunctionConsumer: TryConsumer<RgbFn> =
  createFunctionalNotationConsumer(
    'rgb',
    oneOf(
      [
        one(consumeLegacyRgbSyntax),
        one(consumeModernRgbSyntax),
      ],
      ([color]) => color,
    ),
    (color) => color,
  );

function consumeRgbaFunction(
  c: TokenCursor,
): TryConsumerResult<RgbFn> {
  return rgbaFunctionConsumer(c);
}

// <rgba()> = <legacy-rgba-syntax> | <modern-rgba-syntax>
const rgbaFunctionConsumer: TryConsumer<RgbFn> =
  createFunctionalNotationConsumer(
    'rgba',
    oneOf(
      [
        one(consumeLegacyRgbaSyntax),
        one(consumeModernRgbaSyntax),
      ],
      ([color]) => color,
    ),
    (color) => color,
  );

function consumeLegacyRgbSyntax(
  c: TokenCursor,
): TryConsumerResult<RgbFn> {
  return legacyRgbSyntaxConsumer(c);
}

// <legacy-rgb-syntax> = rgb(<percentage>#{3} [ , <alpha-value> ]?) | rgb(<number>#{3} [ , <alpha-value> ]?)
const legacyRgbSyntaxConsumer = createLegacyRgbSyntaxConsumer();

function consumeLegacyRgbaSyntax(
  c: TokenCursor,
): TryConsumerResult<RgbFn> {
  return legacyRgbaSyntaxConsumer(c);
}

// <legacy-rgba-syntax> = rgba(<percentage>#{3} [ , <alpha-value> ]?) | rgba(<number>#{3} [ , <alpha-value> ]?)
const legacyRgbaSyntaxConsumer = createLegacyRgbSyntaxConsumer();

function createLegacyRgbSyntaxConsumer(
): TryConsumer<RgbFn> {
  return oneOf(
    [
      one(sequenceOf(
        [
          commaRepeat(consumePercentage, 3, 3),
          opt(sequenceOf(
            [
              one(withTrivia(consumeComma)),
              one(withTrivia(consumeAlphaValue)),
            ],
            ([, [alpha]]) => alpha,
          )),
        ],
        ([components, [alpha]]) => ({
          kind: ColorKind.RgbFn as const,
          useLegacySyntax: true,
          components: [...components, alpha] as RgbFn['components'],
        }),
      )),
      one(sequenceOf(
        [
          commaRepeat(consumeNumber, 3, 3),
          opt(sequenceOf(
            [
              one(withTrivia(consumeComma)),
              one(withTrivia(consumeAlphaValue)),
            ],
            ([, [alpha]]) => alpha,
          )),
        ],
        ([components, [alpha]]) => ({
          kind: ColorKind.RgbFn as const,
          useLegacySyntax: true,
          components: [...components, alpha] as RgbFn['components'],
        }),
      )),
    ],
    ([color]) => color,
  );
}

function consumeModernRgbSyntax(
  c: TokenCursor,
): TryConsumerResult<RgbFn> {
  return modernRgbSyntaxConsumer(c);
}

// <modern-rgb-syntax> = rgb([ from <color> ]? [ <number> | <percentage> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const modernRgbSyntaxConsumer = createModernRgbSyntaxConsumer();

function consumeModernRgbaSyntax(
  c: TokenCursor,
): TryConsumerResult<RgbFn> {
  return modernRgbaSyntaxConsumer(c);
}

// <modern-rgba-syntax> = rgba([ from <color> ]? [ <number> | <percentage> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const modernRgbaSyntaxConsumer = createModernRgbSyntaxConsumer();

function createModernRgbSyntaxConsumer(
): TryConsumer<RgbFn> {
  return sequenceOf(
    [
      opt(consumeRelativeColorOrigin, {
        contextAfter: (_origin, context) =>
          contextWithRelativeColorVariables(
            context,
            SPACES.srgb.keys,
          ),
      }),
      repeat(withTrivia(oneOf(
        [
          one(consumeNumber),
          one(consumePercentage),
          one(consumeNone),
          one(consumeRelativeColorKeyword),
        ],
        ([component]) => component,
      )), 3, 3),
      opt(consumeModernAlpha),
    ],
    ([[origin], components, [alpha]]) => ({
      kind: ColorKind.RgbFn,
      useLegacySyntax: false,
      origin,
      components: [...components, alpha],
    }),
  );
}

/*
 * <hsl()> = [ <legacy-hsl-syntax> | <modern-hsl-syntax> ]
 * <hsla()> = [ <legacy-hsla-syntax> | <modern-hsla-syntax> ]
 *
 * <modern-hsl-syntax> = hsl(
 *   [ from <color> ]?
 *   [ <hue> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 * <modern-hsla-syntax> = hsla(
 *   [ from <color> ]?
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
  useLegacySyntax: boolean;
  origin?: ColorValue;
  components: ColorFunctionComponentTuple<HslSpace, [
    hue: SyntaxHueComponent,
    saturation: SyntaxNonHueComponent,
    lightness: SyntaxNonHueComponent,
  ]>;
};

function consumeHslFunction(
  c: TokenCursor,
): TryConsumerResult<HslFn> {
  return hslFunctionConsumer(c);
}

// <hsl()> = <legacy-hsl-syntax> | <modern-hsl-syntax>
const hslFunctionConsumer: TryConsumer<HslFn> =
  createFunctionalNotationConsumer(
    'hsl',
    oneOf(
      [
        one(consumeLegacyHslSyntax),
        one(consumeModernHslSyntax),
      ],
      ([color]) => color,
    ),
    (color) => color,
  );

function consumeHslaFunction(
  c: TokenCursor,
): TryConsumerResult<HslFn> {
  return hslaFunctionConsumer(c);
}

// <hsla()> = <legacy-hsla-syntax> | <modern-hsla-syntax>
const hslaFunctionConsumer: TryConsumer<HslFn> =
  createFunctionalNotationConsumer(
    'hsla',
    oneOf(
      [
        one(consumeLegacyHslaSyntax),
        one(consumeModernHslaSyntax),
      ],
      ([color]) => color,
    ),
    (color) => color,
  );

function consumeLegacyHslSyntax(
  c: TokenCursor,
): TryConsumerResult<HslFn> {
  return legacyHslSyntaxConsumer(c);
}

// <legacy-hsl-syntax> = hsl(<hue>, <percentage>, <percentage> [ , <alpha-value> ]?)
const legacyHslSyntaxConsumer = createLegacyHslSyntaxConsumer();

function consumeLegacyHslaSyntax(
  c: TokenCursor,
): TryConsumerResult<HslFn> {
  return legacyHslaSyntaxConsumer(c);
}

// <legacy-hsla-syntax> = hsla(<hue>, <percentage>, <percentage> [ , <alpha-value> ]?)
const legacyHslaSyntaxConsumer = createLegacyHslSyntaxConsumer();

function createLegacyHslSyntaxConsumer(): TryConsumer<HslFn> {
  return sequenceOf(
    [
      one(withTrivia(consumeHue)),
      one(sequenceOf(
        [
          one(withTrivia(consumeComma)),
          one(withTrivia(consumePercentage)),
        ],
        ([, [percentage]]) => percentage,
      )),
      one(sequenceOf(
        [
          one(withTrivia(consumeComma)),
          one(withTrivia(consumePercentage)),
        ],
        ([, [percentage]]) => percentage,
      )),
      opt(sequenceOf(
        [
          one(withTrivia(consumeComma)),
          one(withTrivia(consumeAlphaValue)),
        ],
        ([, [alpha]]) => alpha,
      )),
    ],
    ([[hue], [saturation], [lightness], [alpha]]) => ({
      kind: ColorKind.HslFn,
      useLegacySyntax: true,
      components: [hue, saturation, lightness, alpha],
    }),
  );
}

function consumeModernHslSyntax(
  c: TokenCursor,
): TryConsumerResult<HslFn> {
  return modernHslSyntaxConsumer(c);
}

// <modern-hsl-syntax> = hsl([ from <color> ]? [ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const modernHslSyntaxConsumer = createModernHslSyntaxConsumer();

function consumeModernHslaSyntax(
  c: TokenCursor,
): TryConsumerResult<HslFn> {
  return modernHslaSyntaxConsumer(c);
}

// <modern-hsla-syntax> = hsla([ from <color> ]? [ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const modernHslaSyntaxConsumer = createModernHslSyntaxConsumer();

function createModernHslSyntaxConsumer(): TryConsumer<HslFn> {
  return sequenceOf(
    [
      opt(consumeRelativeColorOrigin, {
        contextAfter: (_origin, context) =>
          contextWithRelativeColorVariables(
            context,
            SPACES.hsl.keys,
          ),
      }),
      one(withTrivia(oneOf(
        [
          one(consumeHue),
          one(consumeNone),
          one(consumeRelativeColorKeyword),
        ],
        ([hue]) => hue,
      ))),
      repeat(withTrivia(oneOf(
        [
          one(consumePercentage),
          one(consumeNumber),
          one(consumeNone),
          one(consumeRelativeColorKeyword),
        ],
        ([component]) => component,
      )), 2, 2),
      opt(consumeModernAlpha),
    ],
    ([[origin], [hue], [saturation, lightness], [alpha]]) => ({
      kind: ColorKind.HslFn,
      useLegacySyntax: false,
      origin,
      components: [hue, saturation, lightness, alpha],
    }),
  );
}

function consumeHue(
  c: TokenCursor,
): TryConsumerResult<HueValue> {
  return hueConsumer(c);
}

// <hue> = <number> | <angle>
const hueConsumer: TryConsumer<HueValue> = oneOf(
  [
    one(consumeNumber),
    one(consumeAngle),
  ],
  ([hue]) => hue,
);

/*
 * <hwb()> = hwb(
 *   [ from <color> ]?
 *   [ <hue> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type HwbFn = {
  kind: ColorKind.HwbFn;
  useLegacySyntax: false;
  origin?: ColorValue;
  components: ColorFunctionComponentTuple<HwbSpace, [
    hue: SyntaxHueComponent,
    whiteness: SyntaxNonHueComponent,
    blackness: SyntaxNonHueComponent,
  ]>;
};

function consumeHwbFunction(
  c: TokenCursor,
): TryConsumerResult<HwbFn> {
  return hwbFunctionConsumer(c);
}

// <hwb()> = hwb([ from <color> ]? [ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const hwbFunctionConsumer: TryConsumer<HwbFn> =
  createFunctionalNotationConsumer(
    'hwb',
    sequenceOf(
      [
        opt(consumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              SPACES.hwb.keys,
            ),
        }),
        one(withTrivia(oneOf(
          [
            one(consumeHue),
            one(consumeNone),
            one(consumeRelativeColorKeyword),
          ],
          ([hue]) => hue,
        ))),
        repeat(withTrivia(oneOf(
          [
            one(consumePercentage),
            one(consumeNumber),
            one(consumeNone),
            one(consumeRelativeColorKeyword),
          ],
          ([component]) => component,
        )), 2, 2),
        opt(consumeModernAlpha),
      ],
      ([[origin], [hue], [whiteness, blackness], [alpha]]): HwbFn => ({
        kind: ColorKind.HwbFn as const,
        useLegacySyntax: false,
        origin,
        components: [hue, whiteness, blackness, alpha],
      }),
    ),
    (color) => color,
  );

/*
 * <lab()> = lab(
 *   [ from <color> ]?
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 *
 * <oklab()> = oklab(
 *   [ from <color> ]?
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type LabFn = {
  kind: ColorKind.LabFn;
  useLegacySyntax: false;
  origin?: ColorValue;
  components: ColorFunctionComponentTuple<LabSpace, [
    lightness: SyntaxNonHueComponent,
    a: SyntaxNonHueComponent,
    b: SyntaxNonHueComponent,
  ]>;
};

export type OklabFn = {
  kind: ColorKind.OklabFn;
  useLegacySyntax: false;
  origin?: ColorValue;
  components: ColorFunctionComponentTuple<OklabSpace, [
    lightness: SyntaxNonHueComponent,
    a: SyntaxNonHueComponent,
    b: SyntaxNonHueComponent,
  ]>;
};

type LabArguments = {
  origin?: ColorValue;
  components: LabFn['components'];
};

function consumeLabFunction(
  c: TokenCursor,
): TryConsumerResult<LabFn> {
  return labFunctionConsumer(c);
}

// <lab()> = lab([ from <color> ]? [ <percentage> | <number> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const labFunctionConsumer: TryConsumer<LabFn> =
  createLabFunctionConsumer(
    'lab',
    SPACES.lab,
    (arguments_) => ({
      kind: ColorKind.LabFn,
      useLegacySyntax: false,
      ...arguments_,
    }),
  );

function consumeOklabFunction(
  c: TokenCursor,
): TryConsumerResult<OklabFn> {
  return oklabFunctionConsumer(c);
}

// <oklab()> = oklab([ from <color> ]? [ <percentage> | <number> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const oklabFunctionConsumer: TryConsumer<OklabFn> =
  createLabFunctionConsumer(
    'oklab',
    SPACES.oklab,
    (arguments_) => ({
      kind: ColorKind.OklabFn,
      useLegacySyntax: false,
      ...arguments_,
    }),
  );

function createLabFunctionConsumer<Color extends LabFn | OklabFn>(
  name: 'lab' | 'oklab',
  space: LabSpace | OklabSpace,
  project: (arguments_: LabArguments) => Color,
): TryConsumer<Color> {
  return createFunctionalNotationConsumer(
    name,
    sequenceOf(
      [
        opt(consumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              space.keys,
            ),
        }),
        repeat(withTrivia(oneOf(
          [
            one(consumePercentage),
            one(consumeNumber),
            one(consumeNone),
            one(consumeRelativeColorKeyword),
          ],
          ([component]) => component,
        )), 3, 3),
        opt(consumeModernAlpha),
      ],
      ([[origin], components, [alpha]]) => ({
        origin,
        components: [...components, alpha],
      }),
    ),
    project,
  );
}

/*
 * <lch()> = lch(
 *   [ from <color> ]?
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <hue> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 *
 * <oklch()> = oklch(
 *   [ from <color> ]?
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <hue> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type LchFn = {
  kind: ColorKind.LchFn;
  useLegacySyntax: false;
  origin?: ColorValue;
  components: ColorFunctionComponentTuple<LchSpace, [
    lightness: SyntaxNonHueComponent,
    chroma: SyntaxNonHueComponent,
    hue: SyntaxHueComponent,
  ]>;
};

export type OklchFn = {
  kind: ColorKind.OklchFn;
  useLegacySyntax: false;
  origin?: ColorValue;
  components: ColorFunctionComponentTuple<OklchSpace, [
    lightness: SyntaxNonHueComponent,
    chroma: SyntaxNonHueComponent,
    hue: SyntaxHueComponent,
  ]>;
};

type LchArguments = {
  origin?: ColorValue;
  components: LchFn['components'];
};

function consumeLchFunction(
  c: TokenCursor,
): TryConsumerResult<LchFn> {
  return lchFunctionConsumer(c);
}

// <lch()> = lch([ from <color> ]? [ <percentage> | <number> | none ]{2} [ <hue> | none ] [ / [ <alpha-value> | none ] ]?)
const lchFunctionConsumer: TryConsumer<LchFn> =
  createLchFunctionConsumer(
    'lch',
    SPACES.lch,
    (arguments_) => ({
      kind: ColorKind.LchFn,
      useLegacySyntax: false,
      ...arguments_,
    }),
  );

function consumeOklchFunction(
  c: TokenCursor,
): TryConsumerResult<OklchFn> {
  return oklchFunctionConsumer(c);
}

// <oklch()> = oklch([ from <color> ]? [ <percentage> | <number> | none ]{2} [ <hue> | none ] [ / [ <alpha-value> | none ] ]?)
const oklchFunctionConsumer: TryConsumer<OklchFn> =
  createLchFunctionConsumer(
    'oklch',
    SPACES.oklch,
    (arguments_) => ({
      kind: ColorKind.OklchFn,
      useLegacySyntax: false,
      ...arguments_,
    }),
  );

function createLchFunctionConsumer<Color extends LchFn | OklchFn>(
  name: 'lch' | 'oklch',
  space: LchSpace | OklchSpace,
  project: (arguments_: LchArguments) => Color,
): TryConsumer<Color> {
  return createFunctionalNotationConsumer(
    name,
    sequenceOf(
      [
        opt(consumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              space.keys,
            ),
        }),
        repeat(withTrivia(oneOf(
          [
            one(consumePercentage),
            one(consumeNumber),
            one(consumeNone),
            one(consumeRelativeColorKeyword),
          ],
          ([component]) => component,
        )), 2, 2),
        one(withTrivia(oneOf(
          [
            one(consumeHue),
            one(consumeNone),
            one(consumeRelativeColorKeyword),
          ],
          ([hue]) => hue,
        ))),
        opt(consumeModernAlpha),
      ],
      ([[origin], components, [hue], [alpha]]) => ({
        origin,
        components: [...components, hue, alpha],
      }),
    ),
    project,
  );
}

/*
 * <alpha()> = alpha(
 *   [ from <color> ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type AlphaFn = {
  kind: ColorKind.AlphaFn;
  useLegacySyntax: false;
  origin: ColorValue;
  components: [alpha: SyntaxAlphaComponent | undefined];
};

function consumeAlphaFunction(
  c: TokenCursor,
): TryConsumerResult<AlphaFn> {
  return alphaFunctionConsumer(c);
}

// <alpha()> = alpha([ from <color> ] [ / [ <alpha-value> | none ] ]?)
const alphaFunctionConsumer: TryConsumer<AlphaFn> =
  createFunctionalNotationConsumer(
    'alpha',
    sequenceOf(
      [
        one(consumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              [],
            ),
        }),
        opt(consumeModernAlpha),
      ],
      ([[origin], [alpha]]) => ({
        kind: ColorKind.AlphaFn as const,
        useLegacySyntax: false as const,
        origin,
        components: [alpha] as AlphaFn['components'],
      }),
    ),
    (color) => color,
  );

/*
 * <color()> = color( [ from <color> ]? <colorspace-params>
 *                    [ / [ <alpha-value> | none ] ]? )
 *
 * <colorspace-params> =
 *   [ <custom-params> | <predefined-rgb-params> | <xyz-params> ]
 *
 * <custom-params> =
 *   <dashed-ident> [ <number> | <percentage> | none ]+
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

export type ColorFn =
  | PredefinedColorFn
  | CustomColorFn;

export type PredefinedColorFn = {
  kind: ColorKind.ColorFn;
  useLegacySyntax: false;
  space: ColorFnSpace;
  components: VariadicColorFunctionComponents;
  origin?: ColorValue;
};

export type CustomColorFn = {
  kind: ColorKind.CustomColorFn;
  useLegacySyntax: false;
  space: CustomColorSpace['name'];
  components: VariadicColorFunctionComponents;
  origin?: ColorValue;
};

function colorProfileFor(
  space: ColorFunctionSpace,
  context: ColorContext,
): ColorProfile | undefined {
  return isCustomColorProfileSpace(space)
    ? context.colorProfiles?.get(space)
    : PROFILES[space];
}

function isCustomColorProfileSpace(
  space: string,
): space is DashedIdentValue['value'] {
  return space.startsWith('--');
}

type ColorFnSpaceParams =
  | {
    kind: ColorKind.ColorFn;
    space: ColorFnSpace;
    components: SyntaxNonHueComponent[];
  }
  | {
    kind: ColorKind.CustomColorFn;
    space: CustomColorSpace['name'];
    components: SyntaxNonHueComponent[];
  };

function consumeColorFunctionNotation(
  c: TokenCursor,
): TryConsumerResult<ColorFn> {
  return colorFunctionNotationConsumer(c);
}

// <color()> = color([ from <color> ]? <colorspace-params> [ / [ <alpha-value> | none ] ]?)
const colorFunctionNotationConsumer: TryConsumer<ColorFn> =
  createFunctionalNotationConsumer(
    'color',
    sequenceOf(
      [
        opt(consumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(context, []),
        }),
        one(consumeColorSpaceParams, {
          contextAfter: (params, context) =>
            contextWithColorFnRelativeVariables(params.space, context),
        }),
        opt(consumeModernAlpha),
      ],
      ([[origin], [params], [alpha]]) => ({
        useLegacySyntax: false as const,
        origin,
        ...params,
        components: [
          ...params.components,
          alpha,
        ] as VariadicColorFunctionComponents,
      }),
    ),
    (color) => color,
  );

function consumeColorSpaceParams(
  c: TokenCursor,
): TryConsumerResult<ColorFnSpaceParams> {
  return colorSpaceParamsConsumer(c);
}

// <colorspace-params> = <custom-params> | <predefined-rgb-params> | <xyz-params>
const colorSpaceParamsConsumer: TryConsumer<ColorFnSpaceParams> = oneOf(
  [
    one(consumeCustomParams),
    one(consumePredefinedRgbParams),
    one(consumeXyzParams),
  ],
  ([params]) => params,
);

function consumeCustomParams(
  c: TokenCursor,
): TryConsumerResult<ColorFnSpaceParams> {
  return customParamsConsumer(c);
}

// <custom-params> = <dashed-ident> [ <number> | <percentage> | none ]+
const customParamsConsumer: TryConsumer<ColorFnSpaceParams> = sequenceOf(
  [
    one(withTrivia(consumeDashedIdent), {
      contextAfter: (space, context) =>
        contextWithColorFnRelativeVariables(space.value, context),
    }),
    plus(withTrivia(oneOf(
      [
        one(consumeNumber),
        one(consumePercentage),
        one(consumeNone),
        one(consumeRelativeColorKeyword),
      ],
      ([component]) => component,
    ))),
  ],
  ([[space], components]) => ({
    kind: ColorKind.CustomColorFn as const,
    space: space.value,
    components,
  }),
);

function consumePredefinedRgbParams(
  c: TokenCursor,
): TryConsumerResult<ColorFnSpaceParams> {
  return predefinedRgbParamsConsumer(c);
}

// <predefined-rgb-params> = <predefined-rgb> [ <number> | <percentage> | none ]{3}
const predefinedRgbParamsConsumer: TryConsumer<ColorFnSpaceParams> =
  sequenceOf(
    [
      one(withTrivia(consumePredefinedRgb), {
        contextAfter: (space, context) =>
          contextWithColorFnRelativeVariables(space, context),
      }),
      repeat(withTrivia(oneOf(
        [
          one(consumeNumber),
          one(consumePercentage),
          one(consumeNone),
          one(consumeRelativeColorKeyword),
        ],
        ([component]) => component,
      )), 3, 3),
    ],
    ([[space], components]) => ({
      kind: ColorKind.ColorFn as const,
      space,
      components,
    }),
  );

function consumePredefinedRgb(
  c: TokenCursor,
): TryConsumerResult<PredefinedRgbSpace> {
  return predefinedRgbConsumer(c);
}

// <predefined-rgb> = srgb | srgb-linear | display-p3 | display-p3-linear | a98-rgb | prophoto-rgb | rec2020
const predefinedRgbConsumer = createKeywordConsumer(
  'srgb',
  'srgb-linear',
  'display-p3',
  'display-p3-linear',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
);

function consumeXyzParams(
  c: TokenCursor,
): TryConsumerResult<ColorFnSpaceParams> {
  return xyzParamsConsumer(c);
}

// <xyz-params> = <xyz-space> [ <number> | <percentage> | none ]{3}
const xyzParamsConsumer: TryConsumer<ColorFnSpaceParams> = sequenceOf(
  [
    one(withTrivia(consumeXyzSpace), {
      contextAfter: (space, context) =>
        contextWithColorFnRelativeVariables(space, context),
    }),
    repeat(withTrivia(oneOf(
      [
        one(consumeNumber),
        one(consumePercentage),
        one(consumeNone),
        one(consumeRelativeColorKeyword),
      ],
      ([component]) => component,
    )), 3, 3),
  ],
  ([[space], components]) => ({
    kind: ColorKind.ColorFn as const,
    space,
    components,
  }),
);

function consumeXyzSpace(
  c: TokenCursor,
): TryConsumerResult<XyzColorSpace['name']> {
  return xyzSpaceConsumer(c);
}

// <xyz-space> = xyz | xyz-d50 | xyz-d65
const xyzSpaceConsumer = adaptConsumer(
  createKeywordConsumer('xyz', 'xyz-d50', 'xyz-d65'),
  (space) => space === 'xyz' ? 'xyz-d65' : space,
);

/*
 * <device-cmyk()> =
 *   <legacy-device-cmyk-syntax> | <modern-device-cmyk-syntax>
 *
 * <legacy-device-cmyk-syntax> = device-cmyk(<number>#{4})
 *
 * <modern-device-cmyk-syntax> = device-cmyk(
 *   <cmyk-component>{4}
 *   [ / [ <alpha-value> | none ] ]? )
 *
 * <cmyk-component> = <number> | <percentage> | none
 */

export type DeviceCmykFn = {
  kind: ColorKind.DeviceCmykFn;
  useLegacySyntax: boolean;
  components: ColorFunctionComponentTuple<DeviceCmykSpace, [
    cyan: SyntaxNonHueComponent,
    magenta: SyntaxNonHueComponent,
    yellow: SyntaxNonHueComponent,
    black: SyntaxNonHueComponent,
  ]>;
};

function consumeDeviceCmykFn(
  c: TokenCursor,
): TryConsumerResult<DeviceCmykFn> {
  return deviceCmykFnConsumer(c);
}

// <device-cmyk()> = <legacy-device-cmyk-syntax> | <modern-device-cmyk-syntax>
const deviceCmykFnConsumer: TryConsumer<DeviceCmykFn> =
  createFunctionalNotationConsumer(
    'device-cmyk',
    oneOf(
      [
        one(consumeLegacyDeviceCmykSyntax),
        one(consumeModernDeviceCmykSyntax),
      ],
      ([color]) => color,
    ),
    (color) => color,
  );

function consumeLegacyDeviceCmykSyntax(
  c: TokenCursor,
): TryConsumerResult<DeviceCmykFn> {
  return legacyDeviceCmykSyntaxConsumer(c);
}

// <legacy-device-cmyk-syntax> = device-cmyk(<number>#{4})
const legacyDeviceCmykSyntaxConsumer: TryConsumer<DeviceCmykFn> =
  adaptConsumer(
    commaRepeat(consumeNumber, 4, 4),
    (components) => ({
      kind: ColorKind.DeviceCmykFn as const,
      useLegacySyntax: true,
      components: [...components, undefined],
    }),
  );

function consumeModernDeviceCmykSyntax(
  c: TokenCursor,
): TryConsumerResult<DeviceCmykFn> {
  return modernDeviceCmykSyntaxConsumer(c);
}

// <modern-device-cmyk-syntax> = device-cmyk(<cmyk-component>{4} [ / [ <alpha-value> | none ] ]?)
const modernDeviceCmykSyntaxConsumer: TryConsumer<DeviceCmykFn> =
  sequenceOf(
    [
      repeat(withTrivia(consumeCmykComponent), 4, 4),
      opt(consumeModernAlpha),
    ],
    ([components, [alpha]]) => ({
      kind: ColorKind.DeviceCmykFn as const,
      useLegacySyntax: false,
      components: [...components, alpha],
    }),
  );

function consumeCmykComponent(
  c: TokenCursor,
): TryConsumerResult<SyntaxNonHueComponent> {
  return cmykComponentConsumer(c);
}

// <cmyk-component> = <number> | <percentage> | none
const cmykComponentConsumer: TryConsumer<SyntaxNonHueComponent> = oneOf(
  [
    one(consumeNumber),
    one(consumePercentage),
    one(consumeNone),
  ],
  ([component]) => component,
);

/*
 * TODO: Extend <light-dark()> with <light-dark-image> when the <image>
 *       production is implemented.
 *
 * <light-dark()> = <light-dark-color>
 *
 * <light-dark-color> = light-dark(<color>, <color>)
 */

export type LightDarkColor = {
  kind: ColorKind.LightDarkColor;
  light: ColorValue;
  dark: ColorValue;
};

function consumeLightDarkColor(
  c: TokenCursor,
): TryConsumerResult<LightDarkColor> {
  return lightDarkColorConsumer(c);
}

// <light-dark-color> = light-dark(<color>, <color>)
const lightDarkColorConsumer: TryConsumer<LightDarkColor> =
  createFunctionalNotationConsumer(
    'light-dark',
    sequenceOf(
      [
        one(withTrivia(consumeColor)),
        one(withTrivia(consumeComma)),
        one(withTrivia(consumeColor)),
      ],
      ([[light], , [dark]]) => ({
        kind: ColorKind.LightDarkColor as const,
        light,
        dark,
      }),
    ),
    (color) => color,
  );

/*
 * <contrast-color()> = contrast-color(<color>)
 */

export type ContrastColorFn = {
  kind: ColorKind.ContrastColorFn;
  color: ColorValue;
};

function consumeContrastColorFn(
  c: TokenCursor,
): TryConsumerResult<ContrastColorFn> {
  return contrastColorFnConsumer(c);
}

// <contrast-color()> = contrast-color(<color>)
const contrastColorFnConsumer: TryConsumer<ContrastColorFn> =
  createFunctionalNotationConsumer(
    'contrast-color',
    adaptConsumer(
      withTrivia(consumeColor),
      (color) => ({
        kind: ColorKind.ContrastColorFn as const,
        color,
      }),
    ),
    (color) => color,
  );

/*
 * <color-space> =
 *   <rectangular-color-space> | <polar-color-space> | <custom-color-space>
 *
 * <rectangular-color-space> = srgb | srgb-linear |
 *                             display-p3 | display-p3-linear |
 *                             a98-rgb | prophoto-rgb | rec2020 |
 *                             lab | oklab | <xyz-space>
 *
 * <polar-color-space> = hsl | hwb | lch | oklch
 *
 * <custom-color-space> = <dashed-ident>
 *
 * <hue-interpolation-method> =
 *   [ shorter | longer | increasing | decreasing ] hue
 *
 * <color-interpolation-method> =
 *   in [ <rectangular-color-space> |
 *        <polar-color-space> <hue-interpolation-method>? |
 *        <custom-color-space> ]
 */

export type ColorInterpolationMethod =
  | { space: RectangularColorSpaceName; hue?: never; }
  | { space: PolarColorSpaceName; hue?: HueInterpolationMethod; }
  | { space: DashedIdentValue['value']; hue?: never; };

type ColorInterpolationSpaceName = ColorInterpolationMethod['space'];

export type HueInterpolationMethod =
  | 'shorter'
  | 'longer'
  | 'increasing'
  | 'decreasing';

export function parseColorInterpolationMethod(
  input: ParserInput,
  context: ColorContext = {},
): ColorInterpolationMethod | null {
  return colorInterpolationMethodParser(input, context);
}

export function consumeColorInterpolationMethod(
  c: TokenCursor,
): TryConsumerResult<ColorInterpolationMethod> {
  return colorInterpolationMethodConsumer(c);
}

// <color-interpolation-method> = in [ <rectangular-color-space> | <polar-color-space> <hue-interpolation-method>? | <custom-color-space> ]
// Equivalent: in [ <polar-color-space> <hue-interpolation-method> | <color-space> ]
const colorInterpolationMethodConsumer: TryConsumer<ColorInterpolationMethod> =
  sequenceOf(
    [
      one(createKeywordConsumer('in')),
      one(withTrivia(oneOf(
        [
          one(sequenceOf(
            [
              one(consumePolarColorSpace),
              one(withTrivia(consumeHueInterpolationMethod)),
            ],
            ([[space], [hue]]) => ({ space, hue }),
          )),
          one(adaptConsumer(
            consumeColorSpace,
            (space) => ({ space }),
          )),
        ],
        ([method]) => method,
      ))),
    ],
    ([, [method]]) => method,
  );

const colorInterpolationMethodParser = createComponentParser(
  withTrivia(colorInterpolationMethodConsumer),
);

function consumeColorSpace(
  c: TokenCursor,
): TryConsumerResult<ColorInterpolationSpaceName> {
  return colorSpaceConsumer(c);
}

// <color-space> = <rectangular-color-space> | <polar-color-space> | <custom-color-space>
const colorSpaceConsumer: TryConsumer<ColorInterpolationSpaceName> = oneOf(
  [
    one(consumeRectangularColorSpace),
    one(consumePolarColorSpace),
    one(consumeCustomColorSpace),
  ],
  ([space]) => space,
);

function consumeRectangularColorSpace(
  c: TokenCursor,
): TryConsumerResult<RectangularColorSpaceName> {
  return rectangularColorSpaceConsumer(c);
}

// <rectangular-color-space> = srgb | srgb-linear | display-p3 | display-p3-linear | a98-rgb | prophoto-rgb | rec2020 | lab | oklab | <xyz-space>
const rectangularColorSpaceConsumer: TryConsumer<RectangularColorSpaceName> = oneOf(
  [
    one(predefinedRgbConsumer),
    one(createKeywordConsumer('lab', 'oklab')),
    one(xyzSpaceConsumer),
  ],
  ([space]) => space,
);

function consumePolarColorSpace(
  c: TokenCursor,
): TryConsumerResult<PolarColorSpaceName> {
  return polarColorSpaceConsumer(c);
}

// <polar-color-space> = hsl | hwb | lch | oklch
const polarColorSpaceConsumer =
  createKeywordConsumer('hsl', 'hwb', 'lch', 'oklch');

// <custom-color-space> = <dashed-ident>
function consumeCustomColorSpace(
  c: TokenCursor,
): TryConsumerResult<DashedIdentValue['value']> {
  return customColorSpaceConsumer(c);
}

const customColorSpaceConsumer = adaptConsumer(
  consumeDashedIdent,
  ({ value }, context) => colorContextFor(context).colorProfiles?.has(value)
    ? value
    : null,
);

function consumeHueInterpolationMethod(
  c: TokenCursor,
): TryConsumerResult<HueInterpolationMethod> {
  return hueInterpolationMethodConsumer(c);
}

// <hue-interpolation-method> = [ shorter | longer | increasing | decreasing ] hue
const hueInterpolationMethodConsumer: TryConsumer<HueInterpolationMethod> =
  sequenceOf(
    [
      one(createKeywordConsumer(
        'shorter',
        'longer',
        'increasing',
        'decreasing',
      )),
      one(withTrivia(createKeywordConsumer('hue'))),
    ],
    ([[method]]) => method,
  );

/*
 * <quirky-color> = <number-token> | <dimension-token> | <ident-token>
 *
 * This conditional grammar is only enabled by the affected property parsers
 * in quirks mode. It represents an ordinary <hex-color>.
 */

function consumeQuirkyColor(
  c: TokenCursor,
): TryConsumerResult<HexColor> {
  return quirkyColorConsumer(c);
}

// <quirky-color> = <number-token> | <dimension-token> | <ident-token>
const quirkyColorConsumer: TryConsumer<HexColor> = oneOf(
  [
    one(adaptConsumer(consumeIdentToken, (token) => token.value)),
    one(adaptConsumer(consumeIntegerToken, (token) =>
      String(token.value).padStart(6, '0'),
    )),
    one(adaptConsumer(consumeDimensionToken, (token) =>
      token.flag === NumberTokenFlag.Integer
        ? `${token.value}${token.unit}`.padStart(6, '0')
        : null,
    )),
  ],
  ([value]) => (
    (value.length === 3 || value.length === 6) && isHexadecimal(value)
  )
    ? { kind: ColorKind.Hex, text: `#${value}` }
    : null,
);

// ████████  ████████ ██          ███    ████████ ████ ██     ██ ████████
// ██     ██ ██       ██         ██ ██      ██     ██  ██     ██ ██
// ██     ██ ██       ██        ██   ██     ██     ██  ██     ██ ██
// ████████  ██████   ██       ██     ██    ██     ██  ██     ██ ██████
// ██   ██   ██       ██       █████████    ██     ██   ██   ██  ██
// ██    ██  ██       ██       ██     ██    ██     ██    ██ ██   ██
// ██     ██ ████████ ████████ ██     ██    ██    ████    ███    ████████

type RelativeColorParserContext = {
  relativeColorVariables?: ReadonlyMap<string, NumericVariable>;
} & ColorValueContext;

function consumeRelativeColorOrigin(
  c: TokenCursor,
): TryConsumerResult<ColorValue> {
  return relativeColorOriginConsumer(c);
}

const relativeColorOriginConsumer = sequenceOf(
  [
    one(createKeywordConsumer('from')),
    one(withTrivia(colorConsumer)),
  ],
  ([, [origin]]) => origin,
);

function consumeRelativeColorKeyword(
  c: TokenCursor,
): TryConsumerResult<NumberValue> {
  return relativeColorKeywordConsumer(c);
}

const relativeColorKeywordConsumer = adaptConsumer(
  consumeIdent,
  (ident, context) => {
    const name = asciiLower(ident.value);

    return relativeColorVariablesFor(context)?.has(name) === true
      ? promoteNumericVariable(name, 'number', colorValueContextFor(context))
      : null;
  },
);

function contextWithRelativeColorVariables(
  context: unknown,
  components: readonly string[],
  includeAlpha = true,
): RelativeColorParserContext {
  const outer = colorValueContextFor(context);
  const relativeColorVariables = new Map(
    relativeColorVariableNames(components, includeAlpha).map((name) => [
      name,
      {
        value: undefined,
        valueType: 'number',
      } satisfies NumericVariable,
    ]),
  );

  return {
    ...outer,
    relativeColorVariables,
    numericVariables: new Map([
      ...(outer.numericVariables ?? []),
      ...relativeColorVariables,
    ]),
  };
}

function contextWithColorFnRelativeVariables(
  space: ColorFunctionSpace,
  context: unknown,
): unknown {
  if (relativeColorVariablesFor(context) === undefined) {
    return context;
  }

  const colorContext = colorValueContextFor(context);
  const profile = colorProfileFor(space, colorContext);

  return contextWithRelativeColorVariables(
    colorContext,
    profile?.components ?? [],
    !isCustomColorProfileSpace(space),
  );
}

function relativeColorVariableNames(
  components: readonly string[],
  includeAlpha = true,
): string[] {
  return includeAlpha ? [...components, 'alpha'] : [...components];
}

function relativeColorVariablesFor(
  context: unknown,
): RelativeColorParserContext['relativeColorVariables'] {
  return context === null || context === undefined
    ? undefined
    : (context as RelativeColorParserContext).relativeColorVariables;
}

// ██     ██ ████████ ████████    ███
// ███   ███ ██          ██      ██ ██
// ████ ████ ██          ██     ██   ██
// ██ ███ ██ ██████      ██    ██     ██
// ██     ██ ██          ██    █████████
// ██     ██ ██          ██    ██     ██
// ██     ██ ████████    ██    ██     ██

type ColorMetadata = {
  fnName: string;
  space: PredefinedColorSpace | null;
  components: readonly ColorComponentMetadata[];
  /** Whether exact integer syntax can be retained in 8-bit storage. */
  supports8BitEncoding: boolean;
  /** Whether an absolute color in this space must be coerced to sRGB. */
  coerceToAbsoluteSrgb: boolean;
  /** Stage at which the function may lower to an absolute color. */
  lowerToAbsoluteAt: ValueStage;
};

/** Lifecycle and canonical representation policy for one color component. */
type ColorComponentMetadata = {
  /** Stage at which reducible math is resolved. */
  resolveMathAt: ValueStage;
  /** Stage at which finite component ranges are applied. */
  clampAt: ValueStage;
  /** Stage at which the component is normalized. */
  normalizeAt: ValueStage;
  /** Stage at which the component uses its canonical syntax. */
  canonicalizeAt: ValueStage;
  /** Whether a canonical unit value is represented by an omitted component. */
  omitUnitary: boolean;
  /** Whether the component uses hue-specific resolution and serialization. */
  isHue: boolean;
  /** Multiplier from number syntax to the component's internal coordinate. */
  numberScale: number;
  /** Multiplier from percentage syntax to the component's internal coordinate. */
  percentageScale: number;
  /** Canonical syntax used to represent the component. */
  canonicalSyntax: 'number' | 'percentage';
  /** Inclusive number-syntax range applied during clamping. */
  numberRange: ColorComponentRange | null;
  /** Inclusive percentage-syntax range applied during clamping. */
  percentageRange: ColorComponentRange | null;
};

type ColorComponentRange = [
  minimum: number,
  maximum: number,
];

function defineColorMetadata<const Metadata extends Partial<ColorMetadata>>(
  metadata: Metadata & Pick<ColorMetadata, 'fnName' | 'space' | 'components'>,
): ColorMetadata & Metadata {
  return {
    supports8BitEncoding: false,
    coerceToAbsoluteSrgb: false,
    lowerToAbsoluteAt: ValueStage.Declared,
    ...metadata,
  };
}

function defineColorComponentMetadata({
  resolveMathAt = ValueStage.Computed,
  clampAt = ValueStage.Declared,
  normalizeAt = ValueStage.Declared,
  canonicalizeAt = ValueStage.Declared,
  omitUnitary = false,
  isHue = false,
  numberScale = 1,
  percentageScale = 1,
  canonicalSyntax = 'number',
  numberRange = null,
  percentageRange = null,
}: Partial<ColorComponentMetadata> = {}): ColorComponentMetadata {
  return {
    resolveMathAt,
    clampAt,
    normalizeAt,
    canonicalizeAt,
    omitUnitary,
    isHue,
    numberScale,
    percentageScale,
    canonicalSyntax,
    numberRange,
    percentageRange,
  };
}

function deferComponentLifecycleToComputed(
  metadata: ColorComponentMetadata,
): ColorComponentMetadata {
  return {
    ...metadata,
    resolveMathAt: ValueStage.Computed,
    clampAt: ValueStage.Computed,
    normalizeAt: ValueStage.Computed,
    canonicalizeAt: ValueStage.Computed,
  };
}

const ALPHA_COMPONENT_METADATA = defineColorComponentMetadata({
  percentageScale: 1 / 100,
  numberRange: [0, 1],
  percentageRange: [0, 100],
  omitUnitary: true,
});

const HUE_COMPONENT_METADATA = defineColorComponentMetadata({ isHue: true });
const DECLARED_HUE_COMPONENT_METADATA = defineColorComponentMetadata({
  isHue: true,
  resolveMathAt: ValueStage.Declared,
});
const PERCENTAGE_COMPONENT_METADATA = defineColorComponentMetadata({
  canonicalSyntax: 'percentage',
  resolveMathAt: ValueStage.Declared,
});

const RGB_COMPONENT_METADATA = defineColorComponentMetadata({
  resolveMathAt: ValueStage.Declared,
  numberScale: 1 / 0xff,
  percentageScale: 1 / 100,
  numberRange: [0, 0xff],
  percentageRange: [0, 100],
});

const RGB_METADATA = defineColorMetadata({
  fnName: 'rgb',
  space: SPACES.srgb,
  components: [
    RGB_COMPONENT_METADATA,
    RGB_COMPONENT_METADATA,
    RGB_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
  supports8BitEncoding: true,
});

const HSL_METADATA = defineColorMetadata({
  fnName: 'hsl',
  space: SPACES.hsl,
  components: [
    DECLARED_HUE_COMPONENT_METADATA,
    defineColorComponentMetadata({
      resolveMathAt: ValueStage.Declared,
      canonicalSyntax: 'percentage',
      numberRange: [0, Infinity],
      percentageRange: [0, Infinity],
    }),
    PERCENTAGE_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
  coerceToAbsoluteSrgb: true,
});

const HWB_METADATA = defineColorMetadata({
  fnName: 'hwb',
  space: SPACES.hwb,
  components: [
    DECLARED_HUE_COMPONENT_METADATA,
    PERCENTAGE_COMPONENT_METADATA,
    PERCENTAGE_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
  coerceToAbsoluteSrgb: true,
});

const LAB_AXIS_COMPONENT_METADATA = defineColorComponentMetadata({
  percentageScale: 1.25,
});

const LAB_METADATA = defineColorMetadata({
  fnName: 'lab',
  space: SPACES.lab,
  components: [
    defineColorComponentMetadata({
      numberRange: [0, 100],
      percentageRange: [0, 100],
    }),
    LAB_AXIS_COMPONENT_METADATA,
    LAB_AXIS_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
});

const OKLAB_AXIS_COMPONENT_METADATA = defineColorComponentMetadata({
  percentageScale: 0.4 / 100,
});

const OKLAB_METADATA = defineColorMetadata({
  fnName: 'oklab',
  space: SPACES.oklab,
  components: [
    defineColorComponentMetadata({
      percentageScale: 1 / 100,
      numberRange: [0, 1],
      percentageRange: [0, 100],
    }),
    OKLAB_AXIS_COMPONENT_METADATA,
    OKLAB_AXIS_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
});

const LCH_METADATA = defineColorMetadata({
  fnName: 'lch',
  space: SPACES.lch,
  components: [
    defineColorComponentMetadata({
      numberRange: [0, 100],
      percentageRange: [0, 100],
    }),
    defineColorComponentMetadata({
      percentageScale: 1.5,
      numberRange: [0, Infinity],
      percentageRange: [0, Infinity],
    }),
    HUE_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
});

const OKLCH_METADATA = defineColorMetadata({
  fnName: 'oklch',
  space: SPACES.oklch,
  components: [
    defineColorComponentMetadata({
      percentageScale: 1 / 100,
      numberRange: [0, 1],
      percentageRange: [0, 100],
    }),
    defineColorComponentMetadata({
      percentageScale: 0.4 / 100,
      numberRange: [0, Infinity],
      percentageRange: [0, Infinity],
    }),
    HUE_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
});

const ALPHA_FN_METADATA = defineColorMetadata({
  fnName: 'alpha',
  space: null,
  components: [ALPHA_COMPONENT_METADATA],
  lowerToAbsoluteAt: ValueStage.Computed,
});

const COLOR_FN_METADATA = defineColorMetadata({
  fnName: 'color',
  space: null,
  components: [defineColorComponentMetadata({
    clampAt: ValueStage.Computed,
    percentageScale: 1 / 100,
  }), ALPHA_COMPONENT_METADATA],
});

const CUSTOM_COLOR_FN_METADATA = defineColorMetadata({
  ...COLOR_FN_METADATA,
  components: [defineColorComponentMetadata({
    clampAt: ValueStage.Computed,
    percentageScale: 1 / 100,
    numberRange: [0, 1],
    percentageRange: [0, 100],
  }), ALPHA_COMPONENT_METADATA],
  lowerToAbsoluteAt: ValueStage.Computed,
});

const DEVICE_CMYK_COMPONENT_METADATA = defineColorComponentMetadata({
  clampAt: ValueStage.Computed,
  canonicalizeAt: ValueStage.Computed,
  percentageScale: 1 / 100,
  numberRange: [0, 1],
  percentageRange: [0, 100],
});

const DEVICE_CMYK_METADATA = defineColorMetadata({
  fnName: 'device-cmyk',
  space: null,
  components: [
    DEVICE_CMYK_COMPONENT_METADATA,
    DEVICE_CMYK_COMPONENT_METADATA,
    DEVICE_CMYK_COMPONENT_METADATA,
    DEVICE_CMYK_COMPONENT_METADATA,
    ALPHA_COMPONENT_METADATA,
  ],
  lowerToAbsoluteAt: ValueStage.Computed,
});

const COLOR_METADATA = {
  [ColorKind.RgbFn]: RGB_METADATA,
  [ColorKind.HslFn]: HSL_METADATA,
  [ColorKind.HwbFn]: HWB_METADATA,
  [ColorKind.LabFn]: LAB_METADATA,
  [ColorKind.OklabFn]: OKLAB_METADATA,
  [ColorKind.LchFn]: LCH_METADATA,
  [ColorKind.OklchFn]: OKLCH_METADATA,
  [ColorKind.AlphaFn]: ALPHA_FN_METADATA,
  [ColorKind.ColorFn]: COLOR_FN_METADATA,
  [ColorKind.CustomColorFn]: CUSTOM_COLOR_FN_METADATA,
} as const satisfies Record<
  ColorFunction['kind'],
  ColorMetadata
>;

type ColorMetadataTable = typeof COLOR_METADATA;
type DerivedColorMetadataTable = {
  readonly [Kind in keyof ColorMetadataTable]: ColorMetadata;
};

const ORIGIN_COLOR_METADATA = deriveColorMetadataTable(
  COLOR_METADATA,
  colorMetadataAsOrigin,
);

const RELATIVE_COLOR_METADATA = deriveColorMetadataTable(
  COLOR_METADATA,
  colorMetadataAsRelative,
);

function deriveColorMetadataTable(
  table: ColorMetadataTable,
  derive: (metadata: ColorMetadata) => ColorMetadata,
): DerivedColorMetadataTable {
  return Object.fromEntries(
    Object.entries(table).map(([kind, metadata]) => [
      kind,
      derive(metadata),
    ]),
  ) as DerivedColorMetadataTable;
}

function colorMetadataAsOrigin(
  metadata: ColorMetadata,
): ColorMetadata {
  const alphaIndex = metadata.components.length - 1;

  return {
    ...metadata,
    components: metadata.components.map((component, index) => ({
      ...deferComponentLifecycleToComputed(component),
      omitUnitary: index === alphaIndex
        ? false
        : component.omitUnitary,
    })),
    lowerToAbsoluteAt: ValueStage.Computed,
  };
}

function colorMetadataAsRelative(
  metadata: ColorMetadata,
): ColorMetadata {
  const alphaIndex = metadata.components.length - 1;

  return {
    ...metadata,
    components: metadata.components.map((component, index) =>
      index === alphaIndex
        ? { ...component, omitUnitary: false }
        : {
          ...deferComponentLifecycleToComputed(component),
          canonicalizeAt: ValueStage.Declared,
          canonicalSyntax: 'number',
          numberRange: null,
          percentageRange: null,
        }
    ),
    lowerToAbsoluteAt: ValueStage.Computed,
  };
}

// ████████  ████████  ██████   ███████  ██       ██     ██ ████████
// ██     ██ ██       ██    ██ ██     ██ ██       ██     ██ ██
// ██     ██ ██       ██       ██     ██ ██       ██     ██ ██
// ████████  ██████    ██████  ██     ██ ██       ██     ██ ██████
// ██   ██   ██             ██ ██     ██ ██        ██   ██  ██
// ██    ██  ██       ██    ██ ██     ██ ██         ██ ██   ██
// ██     ██ ████████  ██████   ███████  ████████    ███    ████████

export function resolveColorValue(
  value: ColorValue,
  stage: ValueStage,
  context: ColorValueContext = {},
): ColorValue {
  return resolveColorValueInternal(value, stage, context);
}

export type ColorContext = {
  currentColor?: AbsoluteColor;
  systemColors?: ReadonlyMap<SystemColorName, AbsoluteColor>;
  colorScheme?: ColorScheme;
  colorProfiles?: ReadonlyMap<ColorProfileSpace, ColorProfile>;
};

export type ColorValueContext = ColorContext & MathContext;

export type ColorScheme = 'light' | 'dark';

export function tryResolveAbsoluteColor(
  value: ColorValue,
  stage: ValueStage,
  context: ColorValueContext = {},
): AbsoluteColor | null {
  const resolved = resolveColorValue(value, stage, context);

  return resolved.kind === ColorKind.Absolute ? resolved : null;
}

function resolveColorValueInternal(
  value: ColorValue,
  stage: ValueStage,
  context: ColorValueContext,
  asOrigin = false,
): ColorValue {
  switch (value.kind) {
    case ColorKind.Absolute:
      return value;
    case ColorKind.Named:
      if (stage < ValueStage.Computed) {
        return value;
      }

      return absoluteColorFromRgba(ColorRgba[value.name]);
    case ColorKind.CurrentColor:
      if (stage < ValueStage.Used) {
        return value;
      }

      return context.currentColor ?? value;
    case ColorKind.System:
      if (stage < ValueStage.Computed) {
        return value;
      }

      return context.systemColors?.get(value.name) ?? value;
    case ColorKind.Deprecated: {
      if (stage < ValueStage.Computed) {
        return value;
      }

      const name = DeprecatedColorSystemName[value.name];

      return context.systemColors?.get(name) ?? {
        kind: ColorKind.System,
        name,
      };
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
    case ColorKind.AlphaFn:
    case ColorKind.ColorFn:
    case ColorKind.CustomColorFn:
      return resolveColorFunction(value, stage, context, asOrigin);
    case ColorKind.DeviceCmykFn:
      return resolveDeviceCmykFn(value, stage, context);
    case ColorKind.LightDarkColor:
      return resolveLightDarkColor(value, stage, context);
    case ColorKind.ContrastColorFn:
      return resolveContrastColorFn(value, stage, context);
    case ColorKind.ColorMixFn:
      return resolveColorMixFn(value, stage, context);
    default:
      return assertNever(value);
  }
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
  stage: ValueStage,
  context: ColorContext,
): ColorValue {
  const method = canonicalizeColorMixMethod(value.method);
  const items = canonicalizeColorMixPercentages(mapTuple(
    value.items,
    (item) => resolveColorMixItem(item, stage, context),
  ));
  const resolved = (
    method === value.method &&
    items.every((item, index) => item === value.items[index])
  )
    ? value
    : { ...value, method, items };

  if (
    stage < ValueStage.Computed ||
    !items.every(isResolvedColorMixItem)
  ) {
    return resolved;
  }

  return calculateColorMix(items, method, context);
}

function canonicalizeColorMixMethod(
  method: ColorInterpolationMethod | undefined,
): ColorInterpolationMethod | undefined {
  if (method === undefined || method.space === 'oklab') {
    return undefined;
  }

  return method.hue === 'shorter'
    ? { space: method.space }
    : method;
}

function canonicalizeColorMixPercentages(
  items: ColorMixFn['items'],
): ColorMixFn['items'] {
  if (items.some(({ percentage }) => percentage?.type === 'math')) {
    return items;
  }

  const percentages = completeMixPercentages(
    items.map(({ percentage }) =>
      percentage === undefined || percentage.type === 'math'
        ? undefined
        : percentage.value
    ),
  );
  const equalPercentage = 100 / items.length;
  const allEqual = percentages.every(
    (percentage) => percentage === equalPercentage,
  );
  const canonical = mapTuple(items, (item, index) => {
    const percentage = allEqual
      ? undefined
      : item.percentage ?? {
        type: 'percentage' as const,
        value: percentages[index]!,
      };

    return percentage === item.percentage
      ? item
      : { ...item, percentage };
  });

  return canonical.every((item, index) => item === items[index])
    ? items
    : canonical;
}

function resolveColorMixItem(
  item: ColorMixItem,
  stage: ValueStage,
  context: ColorValueContext,
): ColorMixItem {
  const color = resolveColorValueInternal(item.color, stage, context);
  const percentage = item.percentage === undefined
    ? undefined
    : resolvePercentage(item.percentage, stage, {
      ...colorMathContext(context, ValueStage.Computed),
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
  stage: ValueStage,
  context: ColorContext,
  asOrigin: boolean,
): ColorValue {
  const isRelative = isRelativeColorFunction(value);
  const metadata = isRelative
    ? RELATIVE_COLOR_METADATA[value.kind]
    : asOrigin
      ? ORIGIN_COLOR_METADATA[value.kind]
      : COLOR_METADATA[value.kind];
  // Undefined means non-relative; null means the relative origin is unavailable.
  let reference: AbsoluteColor | null | undefined;

  if (isRelative) {
    const origin = resolveColorValueInternal(
      value.origin,
      stage,
      context,
      true,
    );
    value.origin = origin;
    reference = origin.kind === ColorKind.Absolute
      ? normalizeAbsoluteColorEncoding(origin)
      : null;
  }

  const componentResolution = resolveComponents(
    value,
    stage,
    context,
    metadata,
    reference,
  );
  let components = componentResolution.components;
  components = clampComponents(components, metadata, stage);
  components = normalizeComponents(components, metadata, stage);
  components = canonicalizeComponents(components, metadata, stage);
  const resolvedValue = {
    ...value,
    components,
    useLegacySyntax: false,
  } as ColorFunction;

  if (reference === null || !componentResolution.channelsAvailable) {
    return resolvedValue;
  }

  if (
    stage < metadata.lowerToAbsoluteAt ||
    hasDeferredComponents(components)
  ) {
    return resolvedValue;
  }

  if (!isRelative && metadata.supports8BitEncoding) {
    const quantized = tryLowerTo8BitAbsoluteColor(
      value.components,
      components.at(-1),
      metadata,
    );

    if (quantized !== null) {
      return quantized;
    }
  }

  const toAbsoluteColor = createAbsoluteColorConverter(
    value,
    metadata,
    reference,
    context,
  );

  if (toAbsoluteColor === null) {
    return resolvedValue;
  }

  const absoluteComponents = scaleComponents(components, metadata);
  return toAbsoluteColor(absoluteComponents);
}

function isRelativeColorFunction(
  value: ColorFunction,
): value is RelativeColorFunction {
  return value.origin !== undefined;
}

function shouldPreserveLegacySyntax(value: DeviceCmykFn): boolean {
  // Missing components and deferred math values require modern syntax.
  return value.useLegacySyntax && value.components.every(
    (component) => component === undefined ||
      (component !== 'none' && component.type !== 'math'),
  );
}

function relativeColorChannelValues(
  value: RelativeColorFunction,
  reference: AbsoluteColor,
  context: ColorContext,
  metadata: ColorMetadata,
): ReadonlyMap<string, NumberLiteral | 'none'> | null {
  if (value.kind === ColorKind.AlphaFn) {
    return new Map([[
      'alpha',
      relativeChannelValue(reference.alpha),
    ]]);
  }

  const predefinedOrigin = tryCoercePredefinedAbsoluteColor(
    reference,
    context,
  );

  if (predefinedOrigin === null) {
    return null;
  }

  if (
    value.kind === ColorKind.ColorFn ||
    value.kind === ColorKind.CustomColorFn
  ) {
    const profile = colorProfileFor(value.space, context);

    if (profile === undefined) {
      return null;
    }

    const components = profile.fromAbsoluteColor(predefinedOrigin);

    if (components === null) {
      return null;
    }

    const channelValues = new Map(
      profile.components.map((name, index) => [
        name,
        relativeChannelValue(components[index] ?? 0),
      ]),
    );

    if (value.kind === ColorKind.ColorFn) {
      channelValues.set('alpha', relativeChannelValue(reference.alpha));
    }

    return channelValues;
  }

  const space = metadata.space!;
  const carried = findCarriedForwardComponents(reference, space.name);
  const converted = convertPredefinedAbsoluteColor(
    predefinedOrigin,
    space.name,
  );
  const channelValues = new Map<string, NumberLiteral | 'none'>(
    space.keys.map((name, index) => [
      name,
      relativeChannelValue(
        carried.components[index]
          ? undefined
          : converted.components[index],
        componentMetadataAt(metadata, index).numberScale,
      ),
    ]),
  );
  channelValues.set(
    'alpha',
    relativeChannelValue(carried.alpha ? undefined : converted.alpha),
  );
  return channelValues;
}

function relativeChannelValue(
  component: AbsoluteComponent,
  scale = 1,
): NumberLiteral | 'none' {
  return component === undefined
    ? 'none'
    : { type: 'number', value: component / scale };
}

function relativeColorMathContext(
  context: ColorValueContext,
  channelValues: ReadonlyMap<string, NumberLiteral | 'none'>,
): ColorValueContext {
  return {
    ...context,
    numericVariables: new Map([
      ...(context.numericVariables ?? []),
      ...[...channelValues].map(([name, channel]) => [
        name,
        { value: channel, valueType: 'number' as const },
      ] as const),
    ]),
  };
}

/**
 * An omitted relative channel argument means ordinary component resolution.
 * `null` means relative resolution whose origin channels are not yet available.
 * A map enables relative resolution with the origin's channel values.
 */
type RelativeColorChannelValues =
  ReadonlyMap<string, NumberLiteral | 'none'> | null;

type AbsoluteColorFunctionComponents = readonly [
  ...coordinates: AbsoluteComponent[],
  alpha: AbsoluteComponent,
];

type AbsoluteColorConverter = (
  components: AbsoluteColorFunctionComponents,
) => AbsoluteColor;

function createAbsoluteColorConverter(
  value: ColorFunction,
  metadata: ColorMetadata,
  reference: AbsoluteColor | undefined,
  context: ColorContext,
): AbsoluteColorConverter | null {
  switch (value.kind) {
    case ColorKind.AlphaFn: {
      const origin = reference!;

      return (components) => {
        const absoluteAlpha = components.at(-1);
        const result = Object.is(absoluteAlpha, origin.alpha)
          ? origin
          : { ...origin, alpha: absoluteAlpha };

        return (
          result.space.name === 'hsl' ||
          result.space.name === 'hwb'
        ) && !hasMissingColorComponents(result)
          ? convertAbsoluteColor(result, 'srgb', context)
          : result;
      };
    }
    case ColorKind.ColorFn: {
      const space = SPACES[value.space];

      return (components) =>
        absoluteColorInPredefinedSpace(
          space,
          components,
          components.at(-1),
        );
    }
    case ColorKind.CustomColorFn: {
      const profile = context.colorProfiles?.get(value.space);

      return profile === undefined
        ? null
        : (components) =>
          absoluteColorInCustomSpace(
            value.space,
            profile,
            components,
            components.at(-1),
            components.length - 1,
          );
    }
    default: {
      const space = metadata.space!;

      return (components) => {
        const absolute = absoluteColorInPredefinedSpace(
          space,
          components,
          components.at(-1),
          reference === undefined && space.name === 'srgb',
        );

        if (
          !metadata.coerceToAbsoluteSrgb ||
          hasMissingColorComponents(absolute)
        ) {
          return absolute;
        }

        return reference === undefined
          ? convertToLegacySrgb(absolute)
          : convertAbsoluteColor(absolute, 'srgb', context);
      };
    }
  }
}

function tryLowerTo8BitAbsoluteColor(
  components: readonly SyntaxComponent[],
  alpha: SyntaxComponent,
  metadata: ColorMetadata,
): AbsoluteColor | null {
  const alphaIndex = components.length - 1;
  const specifiedAlpha = components[alphaIndex];

  if (
    specifiedAlpha !== undefined &&
    specifiedAlpha !== 'none' &&
    specifiedAlpha.type === 'math'
  ) {
    return null;
  }

  const coordinates: number[] = [];

  for (let index = 0; index < alphaIndex; index++) {
    const component = components[index];

    if (!is8BitColorComponent(component)) {
      return null;
    }

    coordinates.push(component.value);
  }

  if (alpha !== undefined && !is8BitColorComponent(alpha)) {
    return null;
  }

  return {
    kind: ColorKind.Absolute,
    space: metadata.space!,
    components: coordinates,
    alpha: (alpha?.value ?? 1) * 0xff,
    isLegacySrgb: metadata.space?.name === 'srgb',
    is8Bit: true,
  };
}

function is8BitColorComponent(
  value: SyntaxComponent,
): value is NumberLiteral {
  return (
    value !== undefined &&
    value !== 'none' &&
    value.type === 'number' &&
    Number.isInteger(value.value) &&
    value.value >= 0 &&
    value.value <= 0xff
  );
}

function resolveComponents<
  const Value extends ColorFunction | DeviceCmykFn,
>(
  value: Value,
  stage: ValueStage,
  context: ColorValueContext,
  metadata: ColorMetadata,
  reference?: AbsoluteColor | null,
): {
  components: Value['components'];
  channelsAvailable: boolean;
} {
  const components = value.components;
  let mathContext = context;
  let channelValues: RelativeColorChannelValues | undefined;

  if (reference !== undefined) {
    const relative = value as RelativeColorFunction;
    channelValues = reference === null
      ? null
      : relativeColorChannelValues(
        relative,
        reference,
        context,
        metadata,
      );
    mathContext = channelValues === null
      ? context
      : relativeColorMathContext(context, channelValues);

    const alphaIndex = components.length - 1;
    if (
      components[alphaIndex] === undefined &&
      reference !== null &&
      stage >= metadata.lowerToAbsoluteAt
    ) {
      components[alphaIndex] = reference.alpha === undefined
        ? 'none'
        : { type: 'number', value: reference.alpha };
    }
  }

  return {
    components: mapTuple(
      components,
      (component, index) => resolveComponent(
        component,
        stage,
        mathContext,
        componentMetadataAt(metadata, index, components.length),
        channelValues,
      ),
    ) as Value['components'],
    channelsAvailable: channelValues !== null,
  };
}

function resolveComponent<Component extends SyntaxComponent>(
  component: Component,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorComponentMetadata,
  channelValues?: RelativeColorChannelValues,
): Component {
  if (component === undefined) {
    return component;
  }

  if (channelValues !== undefined) {
    const resolved = tryResolveFromOriginChannel(
      component,
      stage,
      channelValues,
      metadata,
    );

    if (resolved !== null) {
      return resolved;
    }
  }

  return (metadata.isHue
    ? resolveHueComponent(
      component as SyntaxHueComponent,
      stage,
      context,
      metadata,
    )
    : resolveNonHueComponent(
      component as SyntaxNonHueComponent,
      stage,
      context,
      metadata,
    )) as Component;
}

function tryResolveFromOriginChannel<Component extends SyntaxComponent>(
  component: Component,
  stage: ValueStage,
  channelValues: RelativeColorChannelValues,
  metadata: ColorComponentMetadata,
): Component | null {
  if (component === undefined) {
    return null;
  }

  const channelName = tryGetRelativeChannelName(component);

  if (channelName === null) {
    return null;
  }

  if (stage < metadata.resolveMathAt || channelValues === null) {
    return component;
  }

  const value = channelValues.get(channelName);

  if (value === undefined) {
    throw new TypeError(`Unknown relative color variable: ${channelName}`);
  }

  return value as Component;
}

function resolveNonHueComponent(
  value: SyntaxNonHueComponent,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorComponentMetadata,
): SyntaxNonHueComponent {
  if (value === 'none') {
    return value;
  }

  return resolveNonHueValue(value, stage, context, metadata);
}

function resolveHueComponent(
  value: SyntaxHueComponent,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorComponentMetadata,
): SyntaxHueComponent {
  if (value === 'none') {
    return value;
  }

  const mathContext = colorMathContext(
    context,
    metadata.resolveMathAt,
  );
  return isNumberValue(value)
    ? resolveNumber(value, stage, mathContext)
    : resolveAngle(value, stage, mathContext);
}

function canonicalizeComponents<
  const Components extends SyntaxComponent[],
>(
  components: Components,
  metadata: ColorMetadata,
  stage: ValueStage = ValueStage.Declared,
): Components {
  return mapTuple(
    components,
    (component, index) => canonicalizeComponent(
      component,
      componentMetadataAt(metadata, index, components.length),
      stage,
    ),
  ) as Components;
}

function canonicalizeComponent<Component extends SyntaxComponent>(
  component: Component,
  metadata: ColorComponentMetadata,
  stage: ValueStage,
): Component {
  if (component === undefined) {
    return component;
  }

  let canonicalized: Component = component;

  if (stage < metadata.canonicalizeAt || metadata.isHue) {
    canonicalized = component;
  } else if (component !== 'none' && component.type === 'math') {
    if (
      metadata.canonicalSyntax === 'number' &&
      component.valueType === 'percentage'
    ) {
      canonicalized = coercePercentageMathToNumber(
        component,
        metadata.percentageScale,
        metadata.numberScale,
      ) as Component;
    }
  } else {
    canonicalized = (metadata.canonicalSyntax === 'number'
      ? canonicalizeAsNumber(
        component as SyntaxNonHueComponent,
        metadata,
      )
      : canonicalizeAsPercentage(
        component as SyntaxNonHueComponent,
        metadata,
      )) as Component;
  }

  return shouldOmitUnitaryComponent(canonicalized, metadata.omitUnitary)
    ? undefined as Component
    : canonicalized;
}

function canonicalizeHueComponent(
  value: SyntaxHueComponent,
): SyntaxHueComponent {
  return value !== 'none' && value.type === 'angle' && value.unit !== 'deg'
    ? canonicalizeAngle(value)
    : value;
}

function canonicalizeAsNumber(
  value: SyntaxNonHueComponent,
  metadata: ColorComponentMetadata,
): SyntaxNonHueComponent {
  if (value === 'none') {
    return value;
  }

  if (value.type === 'math') {
    return value;
  }

  return {
    type: 'number',
    value: value.type === 'percentage'
      ? value.value / (
        metadata.numberScale /
        metadata.percentageScale
      )
      : value.value,
  };
}

function canonicalizeAsPercentage(
  value: SyntaxNonHueComponent,
  metadata: ColorComponentMetadata,
): SyntaxNonHueComponent {
  if (value === 'none' || value.type === 'math') {
    return value;
  }

  if (value.value === 0) {
    return value.type === 'number'
      ? value
      : { type: 'number', value: 0 };
  }

  return value.type === 'percentage'
    ? value
    : {
      type: 'percentage',
      value: value.value *
        metadata.numberScale /
        metadata.percentageScale,
    };
}

function scaleComponents(
  components: readonly [
    ...components: SyntaxComponent[],
    alpha: SyntaxComponent,
  ],
  metadata: ColorMetadata,
): AbsoluteColorFunctionComponents {
  return mapTuple(components, (component, index) => {
    if (component === undefined) {
      return index === components.length - 1 ? 1 : undefined;
    }

    const componentMetadata = componentMetadataAt(
      metadata,
      index,
      components.length,
    );

    return componentMetadata.isHue
      ? scaleHueComponent(component as SyntaxHueComponent)
      : scaleNonHueComponent(
        component as SyntaxNonHueComponent,
        componentMetadata,
      );
  });
}

function scaleNonHueComponent(
  value: SyntaxNonHueComponent,
  metadata: ColorComponentMetadata,
): AbsoluteComponent {
  if (value === 'none') {
    return undefined;
  }

  if (value.type === 'math') {
    throw new Error('Deferred color components cannot be scaled');
  }

  return value.value * (
    value.type === 'percentage'
      ? metadata.percentageScale
      : metadata.numberScale
  );
}

function scaleHueComponent(
  value: SyntaxHueComponent,
): AbsoluteComponent {
  if (value === 'none') {
    return undefined;
  }

  if (value.type === 'math') {
    throw new Error('A deferred hue cannot be scaled');
  }

  return value.type === 'angle'
    ? canonicalizeAngle(value).value
    : value.value;
}

function normalizeComponents<
  const Components extends SyntaxComponent[],
>(
  components: Components,
  metadata: ColorMetadata,
  stage: ValueStage = ValueStage.Declared,
): Components {
  return mapTuple(
    components,
    (component, index) => normalizeComponent(
      component,
      componentMetadataAt(metadata, index, components.length),
      stage,
    ),
  ) as Components;
}

function normalizeComponent<Component extends SyntaxComponent>(
  component: Component,
  metadata: ColorComponentMetadata,
  stage: ValueStage,
): Component {
  if (component === undefined || !metadata.isHue) {
    return component;
  }

  return (stage < metadata.normalizeAt
    ? canonicalizeHueComponent(component as SyntaxHueComponent)
    : normalizeHueComponent(component as SyntaxHueComponent)) as Component;
}

function normalizeHueComponent(
  value: SyntaxHueComponent,
): SyntaxHueComponent {
  if (value === 'none' || value.type === 'math') {
    return value;
  }

  const number = value.type === 'angle'
    ? canonicalizeAngle(value).value
    : value.value;
  const normalized = normalizeHue(number);

  return value.type === 'number' && Object.is(normalized, value.value)
    ? value
    : { type: 'number', value: normalized };
}

function normalizeHue(value: number): number {
  return Number.isFinite(value)
    ? ((value % 360) + 360) % 360
    : 0;
}

function convertToLegacySrgb(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  return {
    ...convertPredefinedAbsoluteColor(value, 'srgb'),
    isLegacySrgb: true,
  };
}

function absoluteColorInPredefinedSpace(
  space: PredefinedColorSpace,
  components: readonly AbsoluteComponent[],
  alpha: number | undefined,
  isLegacySrgb = false,
): PredefinedAbsoluteColor {
  return {
    kind: ColorKind.Absolute,
    space,
    components: mapTuple(
      space.keys,
      (_key, index) => components[index],
    ),
    alpha,
    isLegacySrgb,
  };
}

function absoluteColorInCustomSpace(
  space: CustomColorSpace['name'],
  profile: ColorProfile,
  components: readonly AbsoluteComponent[],
  alpha: number | undefined,
  coordinateCount = components.length,
): AbsoluteColor<CustomColorSpace> {
  const customSpace: CustomColorSpace = {
    name: space,
    keys: profile.components,
  };

  return {
    kind: ColorKind.Absolute,
    space: customSpace,
    components: mapTuple(
      profile.components,
      (_key, index) =>
        index < coordinateCount ? components[index] : 0,
    ),
    alpha,
    isLegacySrgb: false,
  };
}

function absoluteColorInDeviceCmykSpace(
  components: AbsoluteColorFunctionComponents,
): AbsoluteColor<DeviceCmykSpace> {
  return {
    kind: ColorKind.Absolute,
    space: DEVICE_CMYK_SPACE,
    components: mapTuple(
      DEVICE_CMYK_SPACE.keys,
      (_key, index) => components[index],
    ),
    alpha: components.at(-1),
    isLegacySrgb: false,
  };
}

function hasDeferredComponents(
  components: SyntaxComponent[],
): boolean {
  return components.some(
    (value) =>
      value !== undefined &&
      value !== 'none' &&
      value.type === 'math',
  );
}

function shouldOmitUnitaryComponent(
  component: SyntaxComponent,
  omitUnitary: boolean,
): boolean {
  return (
    omitUnitary &&
    component !== undefined &&
    component !== 'none' &&
    component.type === 'number' &&
    component.value === 1
  );
}

function tryGetRelativeChannelName(
  value: SyntaxComponent,
): string | null {
  return value !== undefined && value !== 'none' && value.type === 'math'
    ? tryGetMathVariableName(value)
    : null;
}

function resolveNonHueValue(
  value: NonHueValue,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorComponentMetadata,
): NonHueValue {
  const mathContext = colorMathContext(
    context,
    metadata.resolveMathAt,
  );

  return isNumberValue(value)
    ? resolveNumber(value, stage, mathContext)
    : resolvePercentage(value, stage, mathContext);
}

function colorMathContext(
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

function clampComponents<
  const Values extends SyntaxComponent[],
>(
  components: Values,
  metadata: ColorMetadata,
  stage: ValueStage,
): { [Index in keyof Values]: Values[Index] } {
  return mapTuple(
    components,
    (component, index) => clampComponent(
      component,
      componentMetadataAt(metadata, index, components.length),
      stage,
    ),
  );
}

function clampComponent<Component extends SyntaxComponent>(
  component: Component,
  metadata: ColorComponentMetadata,
  stage: ValueStage,
): Component {
  if (
    component === undefined ||
    component === 'none' ||
    component.type === 'math'
  ) {
    return component;
  }

  if (
    stage < metadata.resolveMathAt &&
    !Number.isFinite(component.value)
  ) {
    return component;
  }

  const literal = component as {
    type: string;
    value: number;
  };
  const clampable = normalizeForClamping(literal.value);
  const range = stage >= metadata.clampAt
    ? literal.type === 'percentage'
      ? metadata.percentageRange
      : metadata.numberRange
    : null;

  const value = range === null
    ? clampable
    : clamp(clampable, ...range);

  return Object.is(value, literal.value)
    ? component
    : { ...literal, value } as Component;
}

function componentMetadataAt(
  metadata: ColorMetadata,
  index: number,
  componentCount?: number,
): ColorComponentMetadata {
  if (componentCount !== undefined && index === componentCount - 1) {
    return metadata.components.at(-1)!;
  }

  return metadata.components.length === 2
    ? metadata.components[0]!
    : metadata.components[index]!;
}

function normalizeForClamping(value: number): number {
  return Number.isNaN(value) || Object.is(value, -0)
    ? 0
    : value;
}

function hasMissingColorComponents(value: AbsoluteColor): boolean {
  return value.alpha === undefined ||
    value.components.some((component) => component === undefined);
}

function absoluteColorFromRgba(rgba: number): AbsoluteColor {
  return {
    kind: ColorKind.Absolute,
    space: SPACES.srgb,
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

function resolveDeviceCmykFn(
  value: DeviceCmykFn,
  stage: ValueStage,
  context: ColorContext,
): DeviceCmykFn | AbsoluteColor<DeviceCmykSpace> {
  const metadata = DEVICE_CMYK_METADATA;
  let { components } = resolveComponents(
    value,
    stage,
    context,
    metadata,
  );
  components = clampComponents(
    components,
    metadata,
    stage,
  );
  components = canonicalizeComponents(
    components,
    metadata,
    stage,
  );
  const resolved = components.every(
    (component, index) => component === value.components[index],
  )
    ? value
    : { ...value, components } as DeviceCmykFn;

  if (stage < metadata.lowerToAbsoluteAt) {
    const useLegacySyntax = shouldPreserveLegacySyntax(resolved);

    return useLegacySyntax === resolved.useLegacySyntax
      ? resolved
      : { ...resolved, useLegacySyntax };
  }

  if (hasDeferredComponents(components)) {
    return {
      ...resolved,
      useLegacySyntax: shouldPreserveLegacySyntax(resolved),
    };
  }

  return absoluteColorInDeviceCmykSpace(
    scaleComponents(components, metadata),
  );
}

function resolveLightDarkColor(
  value: LightDarkColor,
  stage: ValueStage,
  context: ColorContext,
): ColorValue {
  if (
    stage < ValueStage.Computed ||
    context.colorScheme === undefined
  ) {
    return value;
  }

  return resolveColorValueInternal(
    context.colorScheme === 'light' ? value.light : value.dark,
    stage,
    context,
  );
}

function resolveContrastColorFn(
  value: ContrastColorFn,
  stage: ValueStage,
  context: ColorContext,
): ColorValue {
  if (stage < ValueStage.Computed) {
    return value;
  }

  const color = resolveColorValueInternal(value.color, stage, context);
  const resolved = color === value.color ? value : { ...value, color };

  if (color.kind !== ColorKind.Absolute) {
    return resolved;
  }

  const absolute = tryCoercePredefinedAbsoluteColor(color, context);

  return absolute === null
    ? resolved
    : calculateContrastColor(absolute);
}

// WCAG 2.1 contrast is the provisional UA-defined policy used by current engines.
function calculateContrastColor(
  background: PredefinedAbsoluteColor,
): AbsoluteColor {
  const luminance = relativeLuminance(background);
  const blackContrast = contrastRatio(luminance, 0);
  const whiteContrast = contrastRatio(luminance, 1);

  return absoluteColorFromRgba(
    blackContrast > whiteContrast
      ? ColorRgba.black
      : ColorRgba.white,
  );
}

function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(value: PredefinedAbsoluteColor): number {
  const [red = 0, green = 0, blue = 0] =
    convertPredefinedAbsoluteColor(value, 'srgb').components;
  const linearize = (component: number) => component <= 0.04045
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4;

  return (
    0.2126 * linearize(red) +
    0.7152 * linearize(green) +
    0.0722 * linearize(blue)
  );
}

function colorContextFor(context: unknown): ColorContext {
  return context === null || context === undefined
    ? {}
    : context;
}

function colorValueContextFor(context: unknown): ColorValueContext {
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
      return value.text;
    case ColorKind.ColorMixFn:
      return serializeColorMixFn(value);
    case ColorKind.DeviceCmykFn:
      return serializeDeviceCmykFn(value);
    case ColorKind.LightDarkColor:
      return serializeLightDarkColor(value);
    case ColorKind.ContrastColorFn:
      return `contrast-color(${serializeColorValue(value.color)})`;
    case ColorKind.RgbFn:
    case ColorKind.HslFn:
    case ColorKind.HwbFn:
    case ColorKind.LabFn:
    case ColorKind.LchFn:
    case ColorKind.OklabFn:
    case ColorKind.OklchFn:
    case ColorKind.AlphaFn:
    case ColorKind.ColorFn:
    case ColorKind.CustomColorFn:
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

function serializeColorMixFn(value: ColorMixFn): string {
  const method = value.method === undefined
    ? null
    : serializeColorInterpolationMethod(value.method);
  const items = value.items.map((item) => {
    const color = serializeColorValue(item.color);
    const percentage = item.percentage === undefined
      ? null
      : serializePercentage(item.percentage);

    return percentage === null ? color : `${color} ${percentage}`;
  });
  const body = method === null
    ? items.join(', ')
    : `${method}, ${items.join(', ')}`;

  return `color-mix(${body})`;
}

export function serializeColorInterpolationMethod(
  method: ColorInterpolationMethod,
): string {
  const hue = method.hue === undefined || method.hue === 'shorter'
    ? ''
    : ` ${method.hue} hue`;

  return `in ${method.space}${hue}`;
}

function serializeColorFunction(value: ColorFunction): string {
  const metadata = COLOR_METADATA[value.kind];
  const args: string[] = [];

  if (value.origin !== undefined) {
    args.push(
      'from',
      serializeColorValue(value.origin),
    );
  }

  if (
    value.kind === ColorKind.ColorFn ||
    value.kind === ColorKind.CustomColorFn
  ) {
    args.push(value.space);
  }

  return serializeColorNotation(
    metadata.fnName,
    args,
    serializeComponents(value.components, metadata),
    value.useLegacySyntax,
  );
}

function serializeComponents(
  components: readonly SyntaxComponent[],
  metadata: ColorMetadata,
): (string | null)[] {
  const alphaIndex = components.length - 1;

  return components.map((component, index) => {
    if (index === alphaIndex) {
      return component === undefined
        ? null
        : serializeNonHueComponent(component as SyntaxAlphaComponent);
    }

    const componentMetadata = componentMetadataAt(metadata, index);

    return componentMetadata.isHue
      ? serializeHueComponent(component as SyntaxHueComponent)
      : serializeNonHueComponent(component as SyntaxNonHueComponent);
  });
}

function serializeColorNotation(
  name: string,
  args: string[],
  components: readonly (string | null)[],
  useLegacySyntax = false,
): string {
  const alpha = components.at(-1) ?? null;
  for (let index = 0; index < components.length - 1; index++) {
    args.push(components[index] as string);
  }

  return alpha === null
    ? `${name}(${args.join(useLegacySyntax ? ', ' : ' ')})`
    : useLegacySyntax
      ? `${name}a(${args.join(', ')}, ${alpha})`
      : `${name}(${args.join(' ')} / ${alpha})`;
}

function serializeHueComponent(
  value: SyntaxHueComponent,
): string {
  if (value === 'none') {
    return value;
  }

  return isNumberValue(value)
    ? serializeNumber(value)
    : serializeAngle(value);
}

function serializeNonHueComponent(
  value: SyntaxNonHueComponent,
): string {
  if (value === 'none') {
    return value;
  }

  return isNumberValue(value)
    ? serializeNumber(value)
    : serializePercentage(value);
}

function serializeAbsoluteColor(
  value: AbsoluteColor,
  htmlCompatible: boolean,
): string {
  const { name: space } = value.space;
  let metadata: ColorMetadata;

  switch (space) {
    case 'srgb': {
      if (htmlCompatible && value.is8Bit && value.alpha === 0xff) {
        return value.components.reduce(
          (acc, c) => acc + c!.toString(16).padStart(2, '0'),
          '#'
        );
      }

      if (
        value.isLegacySrgb &&
        value.components.every((c) => c !== undefined) &&
        value.alpha !== undefined
      ) {
        const components = value.components.map(
          (c) => serializeCssNumber(value.is8Bit ? c : c * 0xff),
        );
        const alpha = value.is8Bit
          ? serialize8BitAlpha(value.alpha)
          : serializeAbsoluteColorAlpha(value.alpha);

        return serializeColorNotation(
          'rgb',
          [],
          [...components, alpha],
          true,
        );
      }

      metadata = COLOR_FN_METADATA;
      break;
    }
    case 'hsl':
      metadata = HSL_METADATA;
      break;
    case 'hwb':
      metadata = HWB_METADATA;
      break;
    case 'lab':
      metadata = LAB_METADATA;
      break;
    case 'lch':
      metadata = LCH_METADATA;
      break;
    case 'oklab':
      metadata = OKLAB_METADATA;
      break;
    case 'oklch':
      metadata = OKLCH_METADATA;
      break;
    case 'device-cmyk':
      metadata = DEVICE_CMYK_METADATA;
      break;
    case 'srgb-linear':
    case 'display-p3':
    case 'display-p3-linear':
    case 'a98-rgb':
    case 'prophoto-rgb':
    case 'rec2020':
    case 'xyz-d50':
    case 'xyz-d65':
      metadata = COLOR_FN_METADATA;
      break;
    default:
      metadata = COLOR_FN_METADATA;
      break;
  }

  const components = value.components.map((component, index) =>
    serializeAbsoluteColorComponent(
      component,
      componentMetadataAt(metadata, index),
    ));
  const args = metadata.fnName === 'color' ? [space] : [];

  return serializeColorNotation(
    metadata.fnName,
    args,
    [...components, serializeAbsoluteColorAlpha(value.alpha)],
  );
}

function serializeDeviceCmykFn(value: DeviceCmykFn): string {
  return serializeColorNotation(
    DEVICE_CMYK_METADATA.fnName,
    [],
    serializeComponents(value.components, DEVICE_CMYK_METADATA),
    value.useLegacySyntax,
  );
}

function serializeLightDarkColor(value: LightDarkColor): string {
  return `light-dark(${
    serializeColorValue(value.light)
  }, ${
    serializeColorValue(value.dark)
  })`;
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

function serializeAbsoluteColorComponent(
  value: AbsoluteComponent,
  metadata: ColorComponentMetadata,
): string {
  return value === undefined
    ? 'none'
    : `${serializeCssNumber(value)}${
      metadata.canonicalSyntax === 'percentage' ? '%' : ''
    }`;
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

type ColorVector = [number, number, number];

type ColorMatrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export function convertAbsoluteColor(
  value: AbsoluteColor,
  target: ColorSpaceName,
  context: ColorContext = {},
): PredefinedAbsoluteColor {
  return convertPredefinedAbsoluteColor(
    coercePredefinedAbsoluteColor(value, context),
    target,
  );
}

function convertPredefinedAbsoluteColor(
  value: PredefinedAbsoluteColor,
  target: ColorSpaceName,
): PredefinedAbsoluteColor {
  if (
    value.space.name === target &&
    !value.isLegacySrgb &&
    !value.is8Bit
  ) {
    return value;
  }

  const source = replaceMissingComponents(
    prepareAbsoluteColorForConversion(value),
  );
  const rectangularTarget = rectangularColorSpace(target);
  let converted: PredefinedAbsoluteColor;

  if (source.space.name === rectangularTarget) {
    converted = source;
  } else {
    let xyz = convertAbsoluteColorToXyz(source);
    const targetWhitePoint = colorSpaceWhitePoint(rectangularTarget);

    if (source.space.whitePoint !== targetWhitePoint) {
      xyz = targetWhitePoint === 'd50'
        ? adaptD65ToD50(xyz)
        : adaptD50ToD65(xyz);
    }

    converted = convertXyzToAbsoluteColor(xyz, rectangularTarget);
  }

  return convertRectangularAbsoluteColor(converted, target);
}

function coercePredefinedAbsoluteColor(
  value: AbsoluteColor,
  context: ColorContext,
): PredefinedAbsoluteColor {
  const predefined = tryCoercePredefinedAbsoluteColor(value, context);

  if (predefined === null) {
    throw new TypeError(`Cannot convert color space ${value.space.name}`);
  }

  return predefined;
}

function tryCoercePredefinedAbsoluteColor(
  value: AbsoluteColor,
  context: ColorContext,
): PredefinedAbsoluteColor | null {
  const { name } = value.space;

  if (isPredefinedColorSpaceName(name)) {
    return value as PredefinedAbsoluteColor;
  }

  const profile = context.colorProfiles?.get(name);

  if (name === DEVICE_CMYK_SPACE.name && profile === undefined) {
    return naiveCmykToSrgb(
      value as AbsoluteColor<DeviceCmykSpace>,
    );
  }

  if (profile === undefined) {
    return null;
  }

  const components = value.components.map((component) => component ?? 0);
  const converted = profile.toAbsoluteColor(components);

  return {
    ...converted,
    alpha: value.alpha,
  };
}

function isPredefinedColorSpaceName(value: string): value is ColorSpaceName {
  return Object.hasOwn(SPACES, value);
}

function prepareAbsoluteColorForConversion(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const normalized = normalizeAbsoluteColorEncoding(value);

  switch (normalized.space.name) {
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

function normalizeAbsoluteColorEncoding<Space extends AbsoluteColorSpace>(
  value: AbsoluteColor<Space>,
): AbsoluteColor<Space> {
  if (!value.isLegacySrgb && !value.is8Bit) {
    return value;
  }

  return {
    kind: ColorKind.Absolute,
    space: value.space,
    components: mapTuple(
      value.components,
      (component) => component === undefined
        ? component
        : value.is8Bit ? component / 0xff : component,
    ),
    alpha: value.alpha === undefined
      ? value.alpha
      : value.is8Bit ? value.alpha / 0xff : value.alpha,
    isLegacySrgb: false,
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
  switch (value.space.name) {
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

function replaceMissingComponents(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  return {
    ...value,
    components: componentsForConversion(value),
  };
}

function rectangularColorSpace(
  value: ColorSpaceName,
): RectangularColorSpaceName {
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

function colorSpaceWhitePoint(value: ColorSpaceName): WhitePoint {
  return SPACES[value].whitePoint;
}

function convertAbsoluteColorToXyz(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const components = componentsForConversion(value);
  let xyz: ColorVector;
  let space: 'xyz-d50' | 'xyz-d65';

  switch (value.space.name) {
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
      throw new Error(
        `Cannot convert ${value.space.name} directly to XYZ`,
      );
  }

  return {
    kind: ColorKind.Absolute,
    space: SPACES[space],
    components: xyz,
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertXyzToAbsoluteColor(
  value: PredefinedAbsoluteColor,
  target: RectangularColorSpaceName,
): PredefinedAbsoluteColor {
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
    space: SPACES[target],
    components,
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertRectangularAbsoluteColor(
  value: PredefinedAbsoluteColor,
  target: ColorSpaceName,
): PredefinedAbsoluteColor {
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

function convertHslToRgb(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const components = componentsForConversion(value);

  return {
    kind: ColorKind.Absolute,
    space: SPACES.srgb,
    components: hslToRgb(...components),
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertRgbToHsl(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const [red, green, blue] = componentsForConversion(value);
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue);

  return {
    kind: ColorKind.Absolute,
    space: SPACES.hsl,
    components: [
      Number.isNaN(hue) ? undefined : hue,
      saturation,
      lightness,
    ],
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertHwbToRgb(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const components = componentsForConversion(value);

  return {
    kind: ColorKind.Absolute,
    space: SPACES.srgb,
    components: hwbToRgb(...components),
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertRgbToHwb(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const [red, green, blue] = componentsForConversion(value);
  const [hue, whiteness, blackness] = rgbToHwb(red, green, blue);

  return {
    kind: ColorKind.Absolute,
    space: SPACES.hwb,
    components: [
      Number.isNaN(hue) ? undefined : hue,
      whiteness,
      blackness,
    ],
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertLabToLch(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const [lightness, chroma, hue] = labToLch(
    componentsForConversion(value),
  );

  return {
    kind: ColorKind.Absolute,
    space: SPACES.lch,
    components: [
      lightness,
      chroma,
      Number.isNaN(hue) ? undefined : hue,
    ],
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertLchToLab(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const [lightness = 0, chroma = 0, hue] = value.components;

  return {
    kind: ColorKind.Absolute,
    space: SPACES.lab,
    components: hue === undefined
      ? [lightness, 0, 0]
      : lchToLab([lightness, chroma, hue]),
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertOklabToOklch(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const [lightness, chroma, hue] = oklabToOklch(
    componentsForConversion(value),
  );

  return {
    kind: ColorKind.Absolute,
    space: SPACES.oklch,
    components: [
      lightness,
      chroma,
      Number.isNaN(hue) ? undefined : hue,
    ],
    alpha: value.alpha,
    isLegacySrgb: false,
  };
}

function convertOklchToOklab(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  const [lightness = 0, chroma = 0, hue] = value.components;

  return {
    kind: ColorKind.Absolute,
    space: SPACES.oklab,
    components: hue === undefined
      ? [lightness, 0, 0]
      : oklchToOklab([lightness, chroma, hue]),
    alpha: value.alpha,
    isLegacySrgb: false,
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

function adaptD65ToD50(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  return {
    ...value,
    space: SPACES['xyz-d50'],
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

function adaptD50ToD65(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  return {
    ...value,
    space: SPACES['xyz-d65'],
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

  return mapTuple(
    matrix,
    ([a, b, c]) => a * x + b * y + c * z,
  );
}

function naiveCmykToSrgb(
  value: AbsoluteColor<DeviceCmykSpace>,
): PredefinedAbsoluteColor {
  const [cyan = 0, magenta = 0, yellow = 0, black = 0] = value.components;
  const red = 1 - Math.min(1, cyan * (1 - black) + black);
  const green = 1 - Math.min(1, magenta * (1 - black) + black);
  const blue = 1 - Math.min(1, yellow * (1 - black) + black);

  return {
    kind: ColorKind.Absolute,
    space: SPACES.srgb,
    components: [red, green, blue],
    alpha: value.alpha,
    isLegacySrgb: false,
  };
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
  destination: ColorSpaceName,
  method: GamutMappingMethod = 'binary-search',
  context: ColorContext = {},
): PredefinedAbsoluteColor {
  if (!hasGamutLimits(destination)) {
    return convertAbsoluteColor(origin, destination, context);
  }

  if (method === 'clip') {
    return clipColorToGamut(origin, destination, context);
  }

  const originOklch = convertAbsoluteColorToOklch(origin, context);
  const [lightness, originChroma, hue] =
    componentsForConversion(originOklch);

  if (lightness >= 1) {
    return convertAbsoluteColor({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [1, 0, 0],
      alpha: origin.alpha,
      isLegacySrgb: false,
    }, destination, context);
  }

  if (lightness <= 0) {
    return convertAbsoluteColor({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0, 0, 0],
      alpha: origin.alpha,
      isLegacySrgb: false,
    }, destination, context);
  }

  if (isColorInGamut(originOklch, destination, context)) {
    return convertAbsoluteColor(originOklch, destination, context);
  }

  let current: PredefinedAbsoluteColor = {
    ...originOklch,
    components: [lightness, originChroma, hue],
  };
  let clipped = clipColorToGamut(current, destination, context);
  let difference = deltaEOK(clipped, current, context);

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

    if (minInGamut && isColorInGamut(current, destination, context)) {
      min = chroma;
      continue;
    }

    clipped = clipColorToGamut(current, destination, context);
    difference = deltaEOK(clipped, current, context);

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

function hasGamutLimits(space: ColorSpaceName): boolean {
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

function convertAbsoluteColorToOklch(
  value: AbsoluteColor,
  context: ColorContext,
): PredefinedAbsoluteColor {
  const prepared = replaceMissingComponents(
    prepareAbsoluteColorForConversion(
      coercePredefinedAbsoluteColor(value, context),
    ),
  );

  return prepared.space.name === 'oklab'
    ? convertOklabToOklch(prepared)
    : convertPredefinedAbsoluteColor(prepared, 'oklch');
}

function isColorInGamut(
  value: AbsoluteColor,
  destination: ColorSpaceName,
  context: ColorContext,
): boolean {
  const gamutSpace = destination === 'hsl' || destination === 'hwb'
    ? 'srgb'
    : destination;
  const converted = convertAbsoluteColor(value, gamutSpace, context);

  return converted.components.every(
    (component) =>
      component !== undefined &&
      component >= 0 &&
      component <= 1,
  );
}

function clipColorToGamut(
  value: AbsoluteColor,
  destination: ColorSpaceName,
  context: ColorContext,
): PredefinedAbsoluteColor {
  const converted = convertAbsoluteColor(value, destination, context);
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
  context: ColorContext = {},
): number {
  const [lightness1, a1, b1] = componentsForConversion(
    convertAbsoluteColor(reference, 'lab', context),
  );
  const [lightness2, a2, b2] = componentsForConversion(
    convertAbsoluteColor(sample, 'lab', context),
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
  const weightedDeltaHue =
    2
    * Math.sqrt(adjustedChroma1 * adjustedChroma2)
    * Math.sin(deltaHue * degreesToRadians / 2);
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
  const lightnessWeight =
    1
    + 0.015 * lightnessOffset / Math.sqrt(20 + lightnessOffset);
  const chromaWeight = 1 + 0.045 * meanAdjustedChroma;
  const hueWeightFactor =
    1
    - 0.17 * Math.cos((meanHue - 30) * degreesToRadians)
    + 0.24 * Math.cos(2 * meanHue * degreesToRadians)
    + 0.32 * Math.cos((3 * meanHue + 6) * degreesToRadians)
    - 0.20 * Math.cos((4 * meanHue - 63) * degreesToRadians);
  const hueWeight =
    1
    + 0.015 * meanAdjustedChroma * hueWeightFactor;
  const rotationAngle =
    30
    * Math.exp(-(((meanHue - 275) / 25) ** 2));
  const rotationChroma =
    2
    * Math.sqrt(
      meanAdjustedChroma7
      / (meanAdjustedChroma7 + chroma25To7),
    );
  const rotation =
    -Math.sin(2 * rotationAngle * degreesToRadians)
    * rotationChroma;
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

export function deltaEOK(
  one: AbsoluteColor,
  two: AbsoluteColor,
  context: ColorContext = {},
): number {
  const [lightness1, a1, b1] = componentsForConversion(
    convertAbsoluteColor(one, 'oklab', context),
  );
  const [lightness2, a2, b2] = componentsForConversion(
    convertAbsoluteColor(two, 'oklab', context),
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
  context: ColorContext = {},
): boolean {
  const preparedA = prepareAbsoluteColorForComparison(a);
  const preparedB = prepareAbsoluteColorForComparison(b);

  if (preparedA.space.name === preparedB.space.name) {
    return areColorComponentsEquivalent(preparedA, preparedB);
  }

  if (
    hasMissingColorComponents(preparedA) ||
    hasMissingColorComponents(preparedB)
  ) {
    return false;
  }

  return areColorComponentsEquivalent(
    convertAbsoluteColor(preparedA, 'oklab', context),
    convertAbsoluteColor(preparedB, 'oklab', context),
  );
}

function prepareAbsoluteColorForComparison(
  value: AbsoluteColor,
): AbsoluteColor {
  return replacePowerlessComponents(
    normalizeAbsoluteColorEncoding(value),
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
    ) &&
    areColorComponentValuesEquivalent(a.alpha, b.alpha)
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
  space?: ColorInterpolationSpaceName,
  hue: HueInterpolationMethod = 'shorter',
  context: ColorContext = {},
): AbsoluteColor {
  space ??= a.isLegacySrgb && b.isLegacySrgb
    ? 'srgb'
    : 'oklab';

  if (isCustomColorProfileSpace(space)) {
    return interpolateCustomColors(a, b, progress, space, context);
  }

  const carriedA = findCarriedForwardComponents(a, space);
  const carriedB = findCarriedForwardComponents(b, space);

  const normalizedA = normalizeAbsoluteColorEncoding(a);
  const convertedA = convertPredefinedAbsoluteColor(
    replaceMissingComponents(
      coercePredefinedAbsoluteColor(normalizedA, context),
    ),
    space,
  );

  const normalizedB = normalizeAbsoluteColorEncoding(b);
  const convertedB = convertPredefinedAbsoluteColor(
    replaceMissingComponents(
      coercePredefinedAbsoluteColor(normalizedB, context),
    ),
    space,
  );

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

function interpolateCustomColors(
  a: AbsoluteColor,
  b: AbsoluteColor,
  progress: number,
  space: DashedIdentValue['value'],
  context: ColorContext,
): AbsoluteColor<CustomColorSpace> {
  const convertedA = convertAbsoluteColorToCustomSpace(a, space, context);
  const convertedB = convertAbsoluteColorToCustomSpace(b, space, context);
  const [restoredA, restoredB] = restoreCustomMissingComponents(
    convertedA,
    convertedB,
  );
  const premultipliedA = premultiplyColor(restoredA);
  const premultipliedB = premultiplyColor(restoredB);
  const interpolated = interpolatePremultipliedColors(
    premultipliedA,
    premultipliedB,
    progress,
  );

  return unpremultiplyColor(interpolated);
}

function convertAbsoluteColorToCustomSpace(
  value: AbsoluteColor,
  target: DashedIdentValue['value'],
  context: ColorContext,
): AbsoluteColor<CustomColorSpace> {
  const normalized = normalizeAbsoluteColorEncoding(value);
  const profile = context.colorProfiles?.get(target);

  if (profile === undefined) {
    throw new TypeError(`Cannot convert color space ${target}`);
  }

  if (normalized.space.name === target) {
    return absoluteColorInCustomSpace(
      target,
      profile,
      normalized.components,
      normalized.alpha,
    );
  }

  const predefined = coercePredefinedAbsoluteColor(normalized, context);
  const components = profile.fromAbsoluteColor(predefined);

  if (components === null) {
    throw new TypeError(`Cannot convert color to color space ${target}`);
  }

  return absoluteColorInCustomSpace(
    target,
    profile,
    components,
    normalized.alpha,
  );
}

function restoreCustomMissingComponents(
  a: AbsoluteColor<CustomColorSpace>,
  b: AbsoluteColor<CustomColorSpace>,
): [
  AbsoluteColor<CustomColorSpace>,
  AbsoluteColor<CustomColorSpace>,
] {
  const componentsA = mapTuple(
    a.components,
    (component, index) => component ?? b.components[index],
  );
  const componentsB = mapTuple(
    b.components,
    (component, index) => component ?? a.components[index],
  );
  const alphaA = a.alpha ?? b.alpha;
  const alphaB = b.alpha ?? a.alpha;

  return [
    { ...a, components: componentsA, alpha: alphaA },
    { ...b, components: componentsB, alpha: alphaB },
  ];
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
  space: ColorSpaceName,
): CarriedColorComponents {
  const sourceCategories = componentCategories(value.space.name);
  const targetCategories = componentCategories(space);
  const carriedComps = mapTuple(
    targetCategories,
    (category) => {
      if (category === undefined) {
        return false;
      }

      const sourceIndex = sourceCategories.indexOf(category);

      return sourceIndex !== -1 &&
        value.components[sourceIndex] === undefined;
    },
  );

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
    sourceSet.length > 0 &&
    sourceSet.every((index) => value.components[index] === undefined)
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
  a: PredefinedAbsoluteColor,
  b: PredefinedAbsoluteColor,
  carriedA: CarriedColorComponents,
  carriedB: CarriedColorComponents,
): [PredefinedAbsoluteColor, PredefinedAbsoluteColor] {
  const componentsA = mapTuple(
    a.components,
    (component, index) =>
      carriedA.components[index]
        ? carriedB.components[index]
          ? undefined
          : b.components[index]
        : component,
  );
  const componentsB = mapTuple(
    b.components,
    (component, index) =>
      carriedB.components[index]
        ? carriedA.components[index]
          ? undefined
          : a.components[index]
        : component,
  );

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

function componentCategories(space: string): [
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
      return [undefined, undefined, undefined];
  }
}

// Section 13.4, "Hue Interpolation."
function fixupColorHues(
  a: PredefinedAbsoluteColor,
  b: PredefinedAbsoluteColor,
  method: HueInterpolationMethod,
): [PredefinedAbsoluteColor, PredefinedAbsoluteColor] {
  const hueIndex = colorHueIndex(a.space.name);

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

  const componentsA = mapTuple(a.components, (component) => component);
  const componentsB = mapTuple(b.components, (component) => component);
  componentsA[hueIndex] = hueA;
  componentsB[hueIndex] = hueB;

  return [
    { ...a, components: componentsA },
    { ...b, components: componentsB },
  ];
}

function premultiplyColor<Space extends AbsoluteColorSpace>(
  value: AbsoluteColor<Space>,
): AbsoluteColor<Space> {
  if (value.alpha === undefined) {
    return value;
  }

  const alpha = value.alpha;
  const hueIndex = colorHueIndex(value.space.name);

  return {
    ...value,
    components: mapTuple(
      value.components,
      (component, index) =>
        component === undefined || index === hueIndex
          ? component
          : component * alpha,
    ),
  };
}

function interpolatePremultipliedColors<Space extends AbsoluteColorSpace>(
  a: AbsoluteColor<Space>,
  b: AbsoluteColor<Space>,
  progress: number,
): AbsoluteColor<Space> {
  const components = mapTuple(
    a.components,
    (component, index) =>
      interpolateComponent(component, b.components[index], progress),
  );
  const hueIndex = colorHueIndex(a.space.name);

  if (hueIndex !== undefined && components[hueIndex] !== undefined) {
    components[hueIndex] = normalizeHue(components[hueIndex]);
  }

  return {
    kind: ColorKind.Absolute,
    space: a.space,
    components,
    alpha: interpolateComponent(a.alpha, b.alpha, progress),
    isLegacySrgb: false,
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

function unpremultiplyColor<Space extends AbsoluteColorSpace>(
  value: AbsoluteColor<Space>,
): AbsoluteColor<Space> {
  if (value.alpha === undefined || value.alpha === 0) {
    return value;
  }

  const alpha = value.alpha;
  const hueIndex = colorHueIndex(value.space.name);

  return {
    ...value,
    components: mapTuple(
      value.components,
      (component, index) =>
        component === undefined || index === hueIndex
          ? component
          : component / alpha,
    ),
  };
}

function colorHueIndex(space: string): 0 | 2 | undefined {
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
  context: ColorContext = {},
): AbsoluteColor {
  if (items.length === 0) {
    throw new TypeError('A color mix requires at least one item');
  }

  const { percentages, leftover } = normalizeMixPercentages(
    items.map((item) => item.percentage?.value),
    true,
  );
  let color: AbsoluteColor = items[0]!.color;
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
      context,
    );
    combinedPercentage = nextCombinedPercentage;
  }

  let result = isCustomColorProfileSpace(method.space)
    ? convertAbsoluteColorToCustomSpace(color, method.space, context)
    : convertAbsoluteColor(color, method.space, context);

  if (
    (method.space === 'hsl' || method.space === 'hwb') &&
    !hasMissingColorComponents(result)
  ) {
    result = convertAbsoluteColor(result, 'srgb', context);
  }

  if (result.alpha === undefined) {
    return result;
  }

  return {
    ...result,
    alpha: result.alpha * (1 - leftover / 100),
  };
}
