import { asciiLower } from '../../shared/css';
import { assertNever, clamp } from '../../shared/util';
import type { ComponentCursor } from '../parser/component-cursor';
import {
  createDelimConsumer, createFunctionalNotationConsumer,
  tryConsumeHashToken,
} from '../parser/component-consumers';
import {
  allOf, commaRepeat, one, oneOf, opt, plus, repeat, sequenceOf,
  withComponentTrivia,
} from '../parser/component-grammar';
import {
  isBad, ok, type TryComponentConsumer,
  type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { isTokenKind, parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { NumberTokenFlag, TokenKind } from '../parser/tokens';
import { ValueStage } from '../value-processing';
import { resolveAngle, serializeAngle, tryConsumeAngle, type AngleValue } from './angle';
import {
  promoteNumericVariable, promotedNumericVariableName, tryCoercePercentageToNumber,
  type MathContext, type NumericVariable,
} from './math-value';
import { tryConsumeDashedIdent, type DashedIdentValue } from './dashed-ident';
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

// Canonical representation of a resolved color in an identified coordinate
// space. It has an intrinsic colorimetric interpretation when its space is
// predefined; other spaces require external conversion context. Undefined
// components represent the `none` keyword.
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
  isLegacySrgb?: true;
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
type XyzSpace = 'xyz' | XyzColorSpace['name'];
type ColorFnSpace = PredefinedRgbSpace | XyzSpace;

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
type SameArityTuple<
  Source extends readonly unknown[],
  Value,
> = {
  -readonly [Index in keyof Source]: Value;
};

type ColorComponentTuple<
  Space extends ColorSpace,
  Components extends SameArityTuple<Space['keys'], unknown>,
> = Components;

function mapTuple<const Values extends readonly unknown[], Result>(
  values: Values,
  transform: (value: Values[number], index: number) => Result,
): SameArityTuple<Values, Result> {
  return values.map(transform) as SameArityTuple<Values, Result>;
}

type SyntaxColorComponent = NumberValue | PercentageValue | 'none';

type SyntaxAlphaComponent = AlphaValue | 'none';
type AlphaValue = NumberValue | PercentageValue;
type AlphaLiteral = NumberLiteral | PercentageLiteral;

type SyntaxHueComponent = HueValue | 'none';
type HueValue = NumberValue | AngleValue;

type ColorMetadata = {
  space: PredefinedColorSpace | null;
  components: readonly ColorComponentMetadata[];
  /** Stage at which reducible math is unwrapped and its non-finite results become clampable. */
  resolveAt: ValueStage;
  convertToSrgb: boolean;
};

/** Resolution, clamping, and serialization policy for one color component. */
type ColorComponentMetadata = {
  /** Whether the component uses hue-specific resolution and serialization. */
  isHue: boolean;
  /** Multiplier from number syntax to the component's internal coordinate. */
  numberScale: number;
  /** Multiplier from percentage syntax to the component's internal coordinate. */
  percentageScale: number;
  /** Whether resolved syntax is eagerly lowered to a canonical number coordinate. */
  canonicalize: boolean;
  /** Coordinate represented by 100% when serialization should prefer percentages. */
  percentageReference: number | null;
  /** Inclusive number-syntax range applied during clamping. */
  numberRange: ColorComponentRange | null;
  /** Inclusive percentage-syntax range applied during clamping. */
  percentageRange: ColorComponentRange | null;
};

type ColorComponentRange = [
  minimum: number,
  maximum: number,
];

function defineColorComponentMetadata({
  isHue = false,
  numberScale = 1,
  percentageScale = 1,
  canonicalize = true,
  percentageReference = null,
  numberRange = null,
  percentageRange = null,
}: Partial<ColorComponentMetadata> = {}): ColorComponentMetadata {
  return {
    isHue,
    numberScale,
    percentageScale,
    canonicalize,
    percentageReference,
    numberRange,
    percentageRange,
  };
}

const HUE_COMPONENT_METADATA = defineColorComponentMetadata({ isHue: true });
const PERCENTAGE_COMPONENT_METADATA = defineColorComponentMetadata({
  canonicalize: false,
  percentageReference: 100,
});

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
  xyz: builtinColorProfile('xyz', ['x', 'y', 'z']),
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
  const absoluteSpace: ColorSpaceName = space === 'xyz' ? 'xyz-d65' : space;

  return defineColorProfile({
    space,
    components,
    toAbsoluteColor: (values) => ({
      kind: ColorKind.Absolute,
      space: SPACES[absoluteSpace],
      components: [values[0], values[1], values[2]],
      alpha: 1,
    }),
    fromAbsoluteColor: (color) => {
      const values = convertPredefinedAbsoluteColor(
        normalizeColorEncoding(color),
        absoluteSpace,
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
      ValueStage.Declared,
      colorResolutionContextFor(c.context),
    ));
}

// <color> = <color-base> | currentColor | <system-color> | <contrast-color()> | <device-cmyk()> | <light-dark-color>
const consumeColor: TryComponentConsumer<ColorValue> = oneOf(
  [
    one(tryConsumeColorBase),
    one(tryConsumeCurrentColor),
    one(tryConsumeSystemColor),
    one(tryConsumeDeprecatedColor),
    one(tryConsumeContrastColorFn),
    one(tryConsumeDeviceCmykFn),
    one(tryConsumeLightDarkColor),
  ],
  ([value]) => ok(value),
);

// <color> = <color-base> | currentColor | <system-color> | <contrast-color()> | <device-cmyk()> | <light-dark-color> | <quirky-color>
const consumeColorInQuirksMode: TryComponentConsumer<ColorValue> = oneOf(
  [
    one(tryConsumeColorBase),
    one(tryConsumeCurrentColor),
    one(tryConsumeSystemColor),
    one(tryConsumeDeprecatedColor),
    one(tryConsumeContrastColorFn),
    one(tryConsumeDeviceCmykFn),
    one(tryConsumeLightDarkColor),
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

// <color-function> = <rgb()> | <rgba()> | <hsl()> | <hsla()> | <hwb()> | <lab()> | <lch()> | <oklab()> | <oklch()> | <alpha()> | <color()>
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
    one(tryConsumeAlphaFunction),
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
          one(tryConsumeRelativeColorKeyword),
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

function tryConsumeColorMixFn(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorMixFn> {
  return consumeColorMixFn(c);
}

const tryConsumeColorMixPercentage =
  createPercentageConsumer({ min: 0, max: 100 });

// <color-mix()> = color-mix(<color-interpolation-method>? , [ <color> && <percentage [0,100]>? ]#)
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
          ([[color], [percentage]]) => ok({
            color,
            percentage,
          }),
        )),
      ],
      ([[method], items]) => ok({
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
  origin?: ColorValue;
  components: ColorComponentTuple<SrgbSpace, [
    red: SyntaxColorComponent,
    green: SyntaxColorComponent,
    blue: SyntaxColorComponent,
  ]>;
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
        ([components, [alpha]]) => ok({
          kind: ColorKind.RgbFn as const,
          syntax: 'legacy' as const,
          components,
          alpha,
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
        ([components, [alpha]]) => ok({
          kind: ColorKind.RgbFn as const,
          syntax: 'legacy' as const,
          components,
          alpha,
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

const RGB_COMPONENT_METADATA = defineColorComponentMetadata({
  numberScale: 1 / 0xff,
  percentageScale: 1 / 100,
  canonicalize: false,
  numberRange: [0, 0xff],
  percentageRange: [0, 100],
});

const RGB_METADATA = {
  space: SPACES.srgb,
  components: [
    RGB_COMPONENT_METADATA,
    RGB_COMPONENT_METADATA,
    RGB_COMPONENT_METADATA,
  ],
  resolveAt: ValueStage.Declared,
  convertToSrgb: false,
} as const satisfies ColorMetadata;

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
      opt(tryConsumeRelativeColorOrigin, {
        contextAfter: (_origin, context) =>
          contextWithRelativeColorVariables(
            context,
            RGB_METADATA.space.keys,
          ),
      }),
      repeat(withComponentTrivia(oneOf(
        [
          one(tryConsumeNumber),
          one(tryConsumePercentage),
          one(tryConsumeNone),
          one(tryConsumeRelativeColorKeyword),
        ],
        ([component]) => ok(component),
      )), 3, 3),
      opt(tryConsumeModernAlpha),
    ],
    ([[origin], components, [alpha]]) => ok({
      kind: ColorKind.RgbFn,
      syntax: 'modern',
      origin,
      components,
      alpha,
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
  syntax: 'legacy' | 'modern';
  origin?: ColorValue;
  components: ColorComponentTuple<HslSpace, [
    hue: SyntaxHueComponent,
    saturation: SyntaxColorComponent,
    lightness: SyntaxColorComponent,
  ]>;
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
    ([[hue], [saturation], [lightness], [alpha]]) => ok({
      kind: ColorKind.HslFn,
      syntax: 'legacy',
      components: [hue, saturation, lightness],
      alpha,
    }),
  );
}

function tryConsumeModernHslSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeModernHslSyntax(c);
}

const HSL_METADATA = {
  space: SPACES.hsl,
  components: [
    HUE_COMPONENT_METADATA,
    defineColorComponentMetadata({
      canonicalize: false,
      percentageReference: 100,
      numberRange: [0, Infinity],
      percentageRange: [0, Infinity],
    }),
    PERCENTAGE_COMPONENT_METADATA,
  ],
  resolveAt: ValueStage.Declared,
  convertToSrgb: true,
} as const satisfies ColorMetadata;

// <modern-hsl-syntax> = hsl([ from <color> ]? [ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const consumeModernHslSyntax = createModernHslSyntaxConsumer();

function tryConsumeModernHslaSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<HslFn> {
  return consumeModernHslaSyntax(c);
}

// <modern-hsla-syntax> = hsla([ from <color> ]? [ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const consumeModernHslaSyntax = createModernHslSyntaxConsumer();

function createModernHslSyntaxConsumer(): TryComponentConsumer<HslFn> {
  return sequenceOf(
    [
      opt(tryConsumeRelativeColorOrigin, {
        contextAfter: (_origin, context) =>
          contextWithRelativeColorVariables(
            context,
            HSL_METADATA.space.keys,
          ),
      }),
      one(withComponentTrivia(oneOf(
        [
          one(tryConsumeHue),
          one(tryConsumeNone),
          one(tryConsumeRelativeColorKeyword),
        ],
        ([hue]) => ok(hue),
      ))),
      repeat(withComponentTrivia(oneOf(
        [
          one(tryConsumePercentage),
          one(tryConsumeNumber),
          one(tryConsumeNone),
          one(tryConsumeRelativeColorKeyword),
        ],
        ([component]) => ok(component),
      )), 2, 2),
      opt(tryConsumeModernAlpha),
    ],
    ([[origin], [hue], [saturation, lightness], [alpha]]) => ok({
      kind: ColorKind.HslFn,
      syntax: 'modern',
      origin,
      components: [hue, saturation, lightness],
      alpha,
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
 *   [ from <color> ]?
 *   [ <hue> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ <percentage> | <number> | none ]
 *   [ / [ <alpha-value> | none ] ]? )
 */

export type HwbFn = {
  kind: ColorKind.HwbFn;
  origin?: ColorValue;
  components: ColorComponentTuple<HwbSpace, [
    hue: SyntaxHueComponent,
    whiteness: SyntaxColorComponent,
    blackness: SyntaxColorComponent,
  ]>;
  alpha?: SyntaxAlphaComponent;
};

const HWB_METADATA = {
  space: SPACES.hwb,
  components: [
    HUE_COMPONENT_METADATA,
    PERCENTAGE_COMPONENT_METADATA,
    PERCENTAGE_COMPONENT_METADATA,
  ],
  resolveAt: ValueStage.Declared,
  convertToSrgb: true,
} as const satisfies ColorMetadata;

function tryConsumeHwbFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<HwbFn> {
  return consumeHwbFunction(c);
}

// <hwb()> = hwb([ from <color> ]? [ <hue> | none ] [ <percentage> | <number> | none ]{2} [ / [ <alpha-value> | none ] ]?)
const consumeHwbFunction: TryComponentConsumer<HwbFn> =
  createFunctionalNotationConsumer(
    'hwb',
    sequenceOf(
      [
        opt(tryConsumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              HWB_METADATA.space.keys,
            ),
        }),
        one(withComponentTrivia(oneOf(
          [
            one(tryConsumeHue),
            one(tryConsumeNone),
            one(tryConsumeRelativeColorKeyword),
          ],
          ([hue]) => ok(hue),
        ))),
        repeat(withComponentTrivia(oneOf(
          [
            one(tryConsumePercentage),
            one(tryConsumeNumber),
            one(tryConsumeNone),
            one(tryConsumeRelativeColorKeyword),
          ],
          ([component]) => ok(component),
        )), 2, 2),
        opt(tryConsumeModernAlpha),
      ],
      ([[origin], [hue], [whiteness, blackness], [alpha]]) => ok<HwbFn>({
        kind: ColorKind.HwbFn as const,
        origin,
        components: [hue, whiteness, blackness],
        alpha,
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
  origin?: ColorValue;
  components: ColorComponentTuple<LabSpace, [
    lightness: SyntaxColorComponent,
    a: SyntaxColorComponent,
    b: SyntaxColorComponent,
  ]>;
  alpha?: SyntaxAlphaComponent;
};

export type OklabFn = {
  kind: ColorKind.OklabFn;
  origin?: ColorValue;
  components: ColorComponentTuple<OklabSpace, [
    lightness: SyntaxColorComponent,
    a: SyntaxColorComponent,
    b: SyntaxColorComponent,
  ]>;
  alpha?: SyntaxAlphaComponent;
};

type LabArguments = {
  origin?: ColorValue;
  components: LabFn['components'];
  alpha?: SyntaxAlphaComponent;
};

const LAB_AXIS_COMPONENT_METADATA = defineColorComponentMetadata({
  percentageScale: 1.25,
});

const LAB_METADATA = {
  space: SPACES.lab,
  components: [
    defineColorComponentMetadata({
      numberRange: [0, 100],
      percentageRange: [0, 100],
    }),
    LAB_AXIS_COMPONENT_METADATA,
    LAB_AXIS_COMPONENT_METADATA,
  ],
  resolveAt: ValueStage.Computed,
  convertToSrgb: false,
} as const satisfies ColorMetadata;

function tryConsumeLabFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<LabFn> {
  return consumeLabFunction(c);
}

// <lab()> = lab([ from <color> ]? [ <percentage> | <number> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const consumeLabFunction: TryComponentConsumer<LabFn> =
  createLabFunctionConsumer(
    'lab',
    LAB_METADATA,
    (arguments_) => ({
      kind: ColorKind.LabFn,
      ...arguments_,
    }),
  );

const OKLAB_AXIS_COMPONENT_METADATA = defineColorComponentMetadata({
  percentageScale: 0.4 / 100,
});

const OKLAB_METADATA = {
  space: SPACES.oklab,
  components: [
    defineColorComponentMetadata({
      percentageScale: 1 / 100,
      numberRange: [0, 1],
      percentageRange: [0, 100],
    }),
    OKLAB_AXIS_COMPONENT_METADATA,
    OKLAB_AXIS_COMPONENT_METADATA,
  ],
  resolveAt: ValueStage.Computed,
  convertToSrgb: false,
} as const satisfies ColorMetadata;

function tryConsumeOklabFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<OklabFn> {
  return consumeOklabFunction(c);
}

// <oklab()> = oklab([ from <color> ]? [ <percentage> | <number> | none ]{3} [ / [ <alpha-value> | none ] ]?)
const consumeOklabFunction: TryComponentConsumer<OklabFn> =
  createLabFunctionConsumer(
    'oklab',
    OKLAB_METADATA,
    (arguments_) => ({
      kind: ColorKind.OklabFn,
      ...arguments_,
    }),
  );

function createLabFunctionConsumer<Color extends LabFn | OklabFn>(
  name: 'lab' | 'oklab',
  metadata: ColorMetadata,
  project: (arguments_: LabArguments) => Color,
): TryComponentConsumer<Color> {
  return createFunctionalNotationConsumer(
    name,
    sequenceOf(
      [
        opt(tryConsumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              metadata.space?.keys ?? [],
            ),
        }),
        repeat(withComponentTrivia(oneOf(
          [
            one(tryConsumePercentage),
            one(tryConsumeNumber),
            one(tryConsumeNone),
            one(tryConsumeRelativeColorKeyword),
          ],
          ([component]) => ok(component),
        )), 3, 3),
        opt(tryConsumeModernAlpha),
      ],
      ([[origin], components, [alpha]]) => ok({
        origin,
        components,
        alpha,
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
  origin?: ColorValue;
  components: ColorComponentTuple<LchSpace, [
    lightness: SyntaxColorComponent,
    chroma: SyntaxColorComponent,
    hue: SyntaxHueComponent,
  ]>;
  alpha?: SyntaxAlphaComponent;
};

export type OklchFn = {
  kind: ColorKind.OklchFn;
  origin?: ColorValue;
  components: ColorComponentTuple<OklchSpace, [
    lightness: SyntaxColorComponent,
    chroma: SyntaxColorComponent,
    hue: SyntaxHueComponent,
  ]>;
  alpha?: SyntaxAlphaComponent;
};

type LchArguments = {
  origin?: ColorValue;
  components: LchFn['components'];
  alpha?: SyntaxAlphaComponent;
};

const LCH_METADATA = {
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
  ],
  resolveAt: ValueStage.Computed,
  convertToSrgb: false,
} as const satisfies ColorMetadata;

function tryConsumeLchFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<LchFn> {
  return consumeLchFunction(c);
}

// <lch()> = lch([ from <color> ]? [ <percentage> | <number> | none ]{2} [ <hue> | none ] [ / [ <alpha-value> | none ] ]?)
const consumeLchFunction: TryComponentConsumer<LchFn> =
  createLchFunctionConsumer(
    'lch',
    LCH_METADATA,
    (arguments_) => ({
      kind: ColorKind.LchFn,
      ...arguments_,
    }),
  );

const OKLCH_METADATA = {
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
  ],
  resolveAt: ValueStage.Computed,
  convertToSrgb: false,
} as const satisfies ColorMetadata;

function tryConsumeOklchFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<OklchFn> {
  return consumeOklchFunction(c);
}

// <oklch()> = oklch([ from <color> ]? [ <percentage> | <number> | none ]{2} [ <hue> | none ] [ / [ <alpha-value> | none ] ]?)
const consumeOklchFunction: TryComponentConsumer<OklchFn> =
  createLchFunctionConsumer(
    'oklch',
    OKLCH_METADATA,
    (arguments_) => ({
      kind: ColorKind.OklchFn,
      ...arguments_,
    }),
  );

function createLchFunctionConsumer<Color extends LchFn | OklchFn>(
  name: 'lch' | 'oklch',
  metadata: ColorMetadata,
  project: (arguments_: LchArguments) => Color,
): TryComponentConsumer<Color> {
  return createFunctionalNotationConsumer(
    name,
    sequenceOf(
      [
        opt(tryConsumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              metadata.space?.keys ?? [],
            ),
        }),
        repeat(withComponentTrivia(oneOf(
          [
            one(tryConsumePercentage),
            one(tryConsumeNumber),
            one(tryConsumeNone),
            one(tryConsumeRelativeColorKeyword),
          ],
          ([component]) => ok(component),
        )), 2, 2),
        one(withComponentTrivia(oneOf(
          [
            one(tryConsumeHue),
            one(tryConsumeNone),
            one(tryConsumeRelativeColorKeyword),
          ],
          ([hue]) => ok(hue),
        ))),
        opt(tryConsumeModernAlpha),
      ],
      ([[origin], components, [hue], [alpha]]) => ok({
        origin,
        components: [...components, hue],
        alpha,
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
  origin: ColorValue;
  alpha?: SyntaxAlphaComponent;
};

function tryConsumeAlphaFunction(
  c: ComponentCursor,
): TryComponentConsumerResult<AlphaFn> {
  return consumeAlphaFunction(c);
}

// <alpha()> = alpha([ from <color> ] [ / [ <alpha-value> | none ] ]?)
const consumeAlphaFunction: TryComponentConsumer<AlphaFn> =
  createFunctionalNotationConsumer(
    'alpha',
    sequenceOf(
      [
        one(tryConsumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(
              context,
              [],
            ),
        }),
        opt(tryConsumeModernAlpha),
      ],
      ([[origin], [alpha]]) => ok({
        kind: ColorKind.AlphaFn as const,
        origin,
        alpha,
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

export type ColorFn = {
  kind: ColorKind.ColorFn;
  space: ColorFunctionSpace;
  components: SyntaxColorComponent[];
  alpha?: SyntaxAlphaComponent;
  origin?: ColorValue;
};

const COLOR_FN_METADATA = {
  space: null,
  components: [defineColorComponentMetadata({
    percentageScale: 1 / 100,
  })],
  resolveAt: ValueStage.Computed,
  convertToSrgb: false,
} as const satisfies ColorMetadata;

const CUSTOM_COLOR_FN_METADATA = {
  ...COLOR_FN_METADATA,
  components: [defineColorComponentMetadata({
    percentageScale: 1 / 100,
    numberRange: [0, 1],
    percentageRange: [0, 100],
  })],
} as const satisfies ColorMetadata;

function colorProfileFor(
  space: ColorFunctionSpace,
  context: ColorConversionContext,
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

type ColorFnSpaceParams = {
  space: ColorFunctionSpace;
  components: SyntaxColorComponent[];
};

function tryConsumeColorFunctionNotation(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFn> {
  return consumeColorFunctionNotation(c);
}

// <color()> = color([ from <color> ]? <colorspace-params> [ / [ <alpha-value> | none ] ]?)
const consumeColorFunctionNotation: TryComponentConsumer<ColorFn> =
  createFunctionalNotationConsumer(
    'color',
    sequenceOf(
      [
        opt(tryConsumeRelativeColorOrigin, {
          contextAfter: (_origin, context) =>
            contextWithRelativeColorVariables(context, []),
        }),
        one(tryConsumeColorSpaceParams, {
          contextAfter: (params, context) =>
            contextWithColorFnRelativeVariables(params.space, context),
        }),
        opt(tryConsumeModernAlpha),
      ],
      ([[origin], [params], [alpha]]) => ok({
        kind: ColorKind.ColorFn as const,
        origin,
        ...params,
        alpha,
      }),
    ),
    (color) => color,
  );

function tryConsumeColorSpaceParams(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFnSpaceParams> {
  return consumeColorSpaceParams(c);
}

// <colorspace-params> = <custom-params> | <predefined-rgb-params> | <xyz-params>
const consumeColorSpaceParams: TryComponentConsumer<ColorFnSpaceParams> = oneOf(
  [
    one(tryConsumeCustomParams),
    one(tryConsumePredefinedRgbParams),
    one(tryConsumeXyzParams),
  ],
  ([params]) => ok(params),
);

function tryConsumeCustomParams(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorFnSpaceParams> {
  return consumeCustomParams(c);
}

// <custom-params> = <dashed-ident> [ <number> | <percentage> | none ]+
const consumeCustomParams: TryComponentConsumer<ColorFnSpaceParams> = sequenceOf(
  [
    one(withComponentTrivia(tryConsumeDashedIdent), {
      contextAfter: (space, context) =>
        contextWithColorFnRelativeVariables(space.value, context),
    }),
    plus(withComponentTrivia(oneOf(
      [
        one(tryConsumeNumber),
        one(tryConsumePercentage),
        one(tryConsumeNone),
        one(tryConsumeRelativeColorKeyword),
      ],
      ([component]) => ok(component),
    ))),
  ],
  ([[space], components]) => ok({
    space: space.value,
    components,
  }),
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
      one(withComponentTrivia(tryConsumePredefinedRgb), {
        contextAfter: (space, context) =>
          contextWithColorFnRelativeVariables(space, context),
      }),
      repeat(withComponentTrivia(oneOf(
        [
          one(tryConsumeNumber),
          one(tryConsumePercentage),
          one(tryConsumeNone),
          one(tryConsumeRelativeColorKeyword),
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
    one(withComponentTrivia(tryConsumeXyzSpace), {
      contextAfter: (space, context) =>
        contextWithColorFnRelativeVariables(space, context),
    }),
    repeat(withComponentTrivia(oneOf(
      [
        one(tryConsumeNumber),
        one(tryConsumePercentage),
        one(tryConsumeNone),
        one(tryConsumeRelativeColorKeyword),
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
  syntax: 'legacy' | 'modern';
  components: ColorComponentTuple<DeviceCmykSpace, [
    cyan: SyntaxColorComponent,
    magenta: SyntaxColorComponent,
    yellow: SyntaxColorComponent,
    black: SyntaxColorComponent,
  ]>;
  alpha?: SyntaxAlphaComponent;
};

const DEVICE_CMYK_COMPONENT_METADATA = defineColorComponentMetadata({
  percentageScale: 1 / 100,
  numberRange: [0, 1],
  percentageRange: [0, 100],
});

const DEVICE_CMYK_METADATA = {
  space: null,
  components: [
    DEVICE_CMYK_COMPONENT_METADATA,
    DEVICE_CMYK_COMPONENT_METADATA,
    DEVICE_CMYK_COMPONENT_METADATA,
    DEVICE_CMYK_COMPONENT_METADATA,
  ],
  resolveAt: ValueStage.Computed,
  convertToSrgb: false,
} as const satisfies ColorMetadata;

function tryConsumeDeviceCmykFn(
  c: ComponentCursor,
): TryComponentConsumerResult<DeviceCmykFn> {
  return consumeDeviceCmykFn(c);
}

// <device-cmyk()> = <legacy-device-cmyk-syntax> | <modern-device-cmyk-syntax>
const consumeDeviceCmykFn: TryComponentConsumer<DeviceCmykFn> =
  createFunctionalNotationConsumer(
    'device-cmyk',
    oneOf(
      [
        one(tryConsumeLegacyDeviceCmykSyntax),
        one(tryConsumeModernDeviceCmykSyntax),
      ],
      ([color]) => ok(color),
    ),
    (color) => color,
  );

function tryConsumeLegacyDeviceCmykSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<DeviceCmykFn> {
  return consumeLegacyDeviceCmykSyntax(c);
}

// <legacy-device-cmyk-syntax> = device-cmyk(<number>#{4})
const consumeLegacyDeviceCmykSyntax: TryComponentConsumer<DeviceCmykFn> =
  sequenceOf(
    [commaRepeat(tryConsumeNumber, 4, 4)],
    ([components]) => ok({
      kind: ColorKind.DeviceCmykFn as const,
      syntax: 'legacy' as const,
      components,
    }),
  );

function tryConsumeModernDeviceCmykSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<DeviceCmykFn> {
  return consumeModernDeviceCmykSyntax(c);
}

// <modern-device-cmyk-syntax> = device-cmyk(<cmyk-component>{4} [ / [ <alpha-value> | none ] ]?)
const consumeModernDeviceCmykSyntax: TryComponentConsumer<DeviceCmykFn> =
  sequenceOf(
    [
      repeat(withComponentTrivia(tryConsumeCmykComponent), 4, 4),
      opt(tryConsumeModernAlpha),
    ],
    ([components, [alpha]]) => ok({
      kind: ColorKind.DeviceCmykFn as const,
      syntax: 'modern' as const,
      components,
      alpha,
    }),
  );

function tryConsumeCmykComponent(
  c: ComponentCursor,
): TryComponentConsumerResult<SyntaxColorComponent> {
  return consumeCmykComponent(c);
}

// <cmyk-component> = <number> | <percentage> | none
const consumeCmykComponent: TryComponentConsumer<SyntaxColorComponent> = oneOf(
  [
    one(tryConsumeNumber),
    one(tryConsumePercentage),
    one(tryConsumeNone),
  ],
  ([component]) => ok(component),
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

function tryConsumeLightDarkColor(
  c: ComponentCursor,
): TryComponentConsumerResult<LightDarkColor> {
  return consumeLightDarkColor(c);
}

// <light-dark-color> = light-dark(<color>, <color>)
const consumeLightDarkColor: TryComponentConsumer<LightDarkColor> =
  createFunctionalNotationConsumer(
    'light-dark',
    sequenceOf(
      [
        one(withComponentTrivia(tryConsumeColor)),
        one(withComponentTrivia(tryConsumeComma)),
        one(withComponentTrivia(tryConsumeColor)),
      ],
      ([[light], , [dark]]) => ok({
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

function tryConsumeContrastColorFn(
  c: ComponentCursor,
): TryComponentConsumerResult<ContrastColorFn> {
  return consumeContrastColorFn(c);
}

// <contrast-color()> = contrast-color(<color>)
const consumeContrastColorFn: TryComponentConsumer<ContrastColorFn> =
  createFunctionalNotationConsumer(
    'contrast-color',
    sequenceOf(
      [one(withComponentTrivia(tryConsumeColor))],
      ([[color]]) => ok({
        kind: ColorKind.ContrastColorFn as const,
        color,
      }),
    ),
    (color) => color,
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

export type ColorInterpolationMethod =
  | { space: RectangularColorSpaceName; hue?: never; }
  | { space: PolarColorSpaceName; hue?: HueInterpolationMethod; };

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
    ([, [space], [hue]]): TryComponentConsumerResult<ColorInterpolationMethod> => {
      if (isPolarColorSpace(space)) {
        return ok({
          space,
          hue,
        });
      }

      return hue === undefined
        ? ok({ space })
        : null;
    },
  );

function tryConsumeColorSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorSpaceName> {
  return consumeColorSpace(c);
}

// <color-space> = <rectangular-color-space> | <polar-color-space>
const consumeColorSpace: TryComponentConsumer<ColorSpaceName> = oneOf(
  [
    one(tryConsumeRectangularColorSpace),
    one(tryConsumePolarColorSpace),
  ],
  ([space]) => ok(space),
);

function tryConsumeRectangularColorSpace(
  c: ComponentCursor,
): TryComponentConsumerResult<RectangularColorSpaceName> {
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
): TryComponentConsumerResult<PolarColorSpaceName> {
  return consumePolarColorSpace(c);
}

// <polar-color-space> = hsl | hwb | lch | oklch
const consumePolarColorSpace =
  createKeywordConsumer('hsl', 'hwb', 'lch', 'oklch');

function isPolarColorSpace(
  space: ColorSpaceName,
): space is PolarColorSpaceName {
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
  stage: ValueStage,
  context: ColorResolutionContext = {},
): ColorValue {
  const resolved = resolveColorValueInternal(value, stage, context);

  return (
    context.targetColorSpace !== undefined &&
    resolved.kind === ColorKind.Absolute
  )
    ? convertAbsoluteColor(resolved, context.targetColorSpace, context)
    : resolved;
}

export type ColorResolutionContext = MathContext & ColorConversionContext & {
  currentColor?: AbsoluteColor;
  systemColors?: ReadonlyMap<SystemColorName, AbsoluteColor>;
  colorScheme?: ColorScheme;
  // Converts the final resolved result to this space.
  targetColorSpace?: ColorSpaceName;
};

export type ColorScheme = 'light' | 'dark';

export function tryResolveAbsoluteColor(
  value: ColorValue,
  stage: ValueStage,
  context: ColorResolutionContext = {},
): AbsoluteColor | null {
  const resolved = resolveColorValue(value, stage, context);

  return resolved.kind === ColorKind.Absolute ? resolved : null;
}

function resolveColorValueInternal(
  value: ColorValue,
  stage: ValueStage,
  context: ColorResolutionContext,
): ColorValue {
  switch (value.kind) {
    case ColorKind.Absolute:
      return value;
    case ColorKind.Named:
      return stage >= ValueStage.Computed
        ? resolveNamedColor(value)
        : value;
    case ColorKind.CurrentColor:
      return stage >= ValueStage.Used
        ? context.currentColor ?? value
        : value;
    case ColorKind.System:
      return stage >= ValueStage.Computed
        ? context.systemColors?.get(value.name) ?? value
        : value;
    case ColorKind.Deprecated: {
      if (stage < ValueStage.Computed) {
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
    case ColorKind.AlphaFn:
    case ColorKind.ColorFn:
      return resolveColorFunction(value, stage, context);
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
  stage: ValueStage,
  context: ColorResolutionContext,
): ColorValue {
  const [first, ...rest] = value.items;
  const items: [ColorMixItem, ...ColorMixItem[]] = [
    resolveColorMixItem(first, stage, context),
    ...rest.map((item) => resolveColorMixItem(item, stage, context)),
  ];
  const resolved = items.every(
    (item, index) => item === value.items[index],
  )
    ? value
    : { ...value, items };

  if (
    stage < ValueStage.Computed ||
    !items.every(isResolvedColorMixItem)
  ) {
    return resolved;
  }

  return calculateColorMix(items, value.method, context);
}

function resolveColorMixItem(
  item: ColorMixItem,
  stage: ValueStage,
  context: ColorResolutionContext,
): ColorMixItem {
  const color = resolveColorValueInternal(item.color, stage, context);
  const percentage = item.percentage === undefined
    ? undefined
    : resolvePercentage(item.percentage, stage, {
      ...colorCalculationContext(context, ValueStage.Computed),
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

type RelativeColorFn = ColorFunction;
type RelativeComponentFn = Exclude<RelativeColorFn, AlphaFn>;
type MetadataColorFn = Exclude<RelativeComponentFn, RgbFn | ColorFn>;

const COLOR_METADATA = {
  [ColorKind.RgbFn]: RGB_METADATA,
  [ColorKind.HslFn]: HSL_METADATA,
  [ColorKind.HwbFn]: HWB_METADATA,
  [ColorKind.LabFn]: LAB_METADATA,
  [ColorKind.OklabFn]: OKLAB_METADATA,
  [ColorKind.LchFn]: LCH_METADATA,
  [ColorKind.OklchFn]: OKLCH_METADATA,
  [ColorKind.ColorFn]: COLOR_FN_METADATA,
} as const satisfies Record<
  RelativeComponentFn['kind'],
  ColorMetadata
>;

function resolveColorFunction(
  value: ColorFunction,
  stage: ValueStage,
  context: ColorResolutionContext,
): ColorValue {
  if (value.origin !== undefined) {
    return resolveRelativeFn(value, value.origin, stage, context);
  }

  const alpha = value.alpha;
  const resolvedAlpha = resolveColorAlphaValue(alpha, stage, context);
  const resolvedValue = resolvedAlpha === alpha
    ? value
    : { ...value, alpha: resolvedAlpha };

  switch (resolvedValue.kind) {
    case ColorKind.RgbFn:
      return resolveRgbFn(
        resolvedValue,
        resolvedAlpha,
        stage,
        context,
      );
    case ColorKind.HslFn:
    case ColorKind.HwbFn:
    case ColorKind.LabFn:
    case ColorKind.OklabFn:
    case ColorKind.LchFn:
    case ColorKind.OklchFn:
      return resolveMetadataColorFn(
        resolvedValue,
        resolvedAlpha,
        stage,
        context,
      );
    case ColorKind.ColorFn:
      return resolveColorFn(
        resolvedValue,
        resolvedAlpha,
        stage,
        context,
      );
    case ColorKind.AlphaFn:
      throw new TypeError('Alpha functions require an origin color');
    default:
      return assertNever(resolvedValue);
  }
}

function resolveRelativeFn(
  value: RelativeColorFn,
  originValue: ColorValue,
  stage: ValueStage,
  context: ColorResolutionContext,
): ColorValue {
  if (value.kind === ColorKind.AlphaFn) {
    return resolveAlphaFn(value, stage, context);
  }

  if (value.kind === ColorKind.ColorFn) {
    return resolveRelativeColorFn(value, originValue, stage, context);
  }

  const metadata = COLOR_METADATA[value.kind];
  const prepared = prepareRelativeColorResolution(
    originValue,
    stage,
    context,
    metadata,
  );

  if (!('convertedOrigin' in prepared)) {
    return prepared.origin === originValue
      ? value
      : { ...value, origin: prepared.origin };
  }

  const { origin, convertedOrigin, calculationContext } = prepared;
  const components = mapTuple(
    value.components,
    (component, index) => resolveRelativeFnComponent(
      component,
      index,
      convertedOrigin,
      stage,
      calculationContext,
      metadata,
    ),
  ) as typeof value.components;
  const alpha = resolveRelativeColorAlpha(
    value.alpha,
    convertedOrigin,
    stage,
    calculationContext,
    metadata,
  );

  if (
    hasDeferredColorComponents(components) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...value,
      origin,
      components: canonicalizeFnComponents(components, metadata),
      alpha,
    } as ColorValue;
  }

  const absolute: PredefinedAbsoluteColor = {
    kind: ColorKind.Absolute,
    space: metadata.space,
    components: mapTuple(
      components,
      (component, index) =>
        scaleFnComponent(component, index, metadata),
    ),
    alpha: alpha === 'none' ? undefined : alpha.value,
  };

  return metadata.convertToSrgb && !hasMissingColorComponent(absolute)
    ? convertAbsoluteColor(absolute, 'srgb', context)
    : absolute;
}

function resolveRelativeColorFn(
  value: ColorFn,
  originValue: ColorValue,
  stage: ValueStage,
  context: ColorResolutionContext,
): ColorValue {
  const origin = resolveColorValueInternal(originValue, stage, context);
  const profile = colorProfileFor(value.space, context);

  if (origin.kind !== ColorKind.Absolute || profile === undefined) {
    return origin === originValue
      ? value
      : { ...value, origin };
  }

  const normalizedOrigin = normalizeColorEncoding(origin);
  const predefinedOrigin = tryCoercePredefinedAbsoluteColor(
    normalizedOrigin,
    context,
  );
  const originComponents = predefinedOrigin === null
    ? null
    : profile.fromAbsoluteColor(predefinedOrigin);

  if (originComponents === null) {
    return origin === originValue
      ? value
      : { ...value, origin };
  }

  const variables = relativeColorFnValues(
    profile,
    originComponents,
    normalizedOrigin.alpha,
  );
  const calculationContext: ColorResolutionContext = {
    ...context,
    numericVariables: relativeColorNumericVariables(
      context,
      variables,
    ),
  };
  const metadata = COLOR_METADATA[ColorKind.ColorFn];
  const components = value.components.map(
    (component) => resolveRelativeColorFnComponent(
      component,
      variables,
      stage,
      calculationContext,
    ),
  );
  const alpha = resolveRelativeColorFnAlpha(
    value.alpha,
    variables,
    normalizedOrigin.alpha,
    stage,
    calculationContext,
  );
  const resolved: ColorFn = {
    ...value,
    origin,
    components: canonicalizeFnComponents(components, metadata),
    alpha,
  };

  if (
    hasDeferredColorComponents(components) ||
    isDeferredColorAlpha(alpha)
  ) {
    return resolved;
  }

  const scaled = components.map(
    (component, index) =>
      scaleFnComponent(component, index, metadata),
  );

  if (isCustomColorProfileSpace(value.space)) {
    return absoluteColorInCustomSpace(
      value.space,
      profile,
      scaled,
      alpha,
    );
  }

  return absoluteColorFromProfile(
    profile,
    scaled,
    alpha,
  );
}

function resolveRelativeFnComponent(
  component: ClampableColorComponentValue,
  index: number,
  origin: AbsoluteColor,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorMetadata,
): ClampableColorComponentValue {
  const componentMetadata = colorComponentMetadataAt(metadata, index);

  return componentMetadata.isHue
    ? normalizeHueValue(resolveRelativeColorHue(
      component as SyntaxHueComponent,
      origin,
      stage,
      context,
      metadata,
    ))
    : resolveRelativeColorComponent(
      component as SyntaxColorComponent,
      origin,
      stage,
      context,
      metadata,
    );
}

function canonicalizeFnComponents<
  const Components extends ClampableColorComponentValues,
>(
  components: Components,
  metadata: ColorMetadata,
): Components {
  return mapTuple(components, (component, index) => {
    const componentMetadata = colorComponentMetadataAt(metadata, index);

    return (
      componentMetadata.isHue ||
      !componentMetadata.canonicalize
    )
      ? component
      : canonicalizeColorComponent(
        component as SyntaxColorComponent,
        componentMetadata.numberScale,
        componentMetadata.percentageScale,
      );
  }) as Components;
}

function scaleFnComponent(
  component: ClampableColorComponentValue,
  index: number,
  metadata: ColorMetadata,
): AbsoluteComponent {
  const componentMetadata = colorComponentMetadataAt(metadata, index);

  return componentMetadata.isHue
    ? scaleHue(component as SyntaxHueComponent)
    : scaleColorComponent(
      component as SyntaxColorComponent,
      componentMetadata.numberScale,
      componentMetadata.percentageScale,
    );
}

function resolveAlphaFn(
  value: AlphaFn,
  stage: ValueStage,
  context: ColorResolutionContext,
): ColorValue {
  const origin = resolveColorValueInternal(value.origin, stage, context);

  if (origin.kind !== ColorKind.Absolute) {
    return origin === value.origin
      ? value
      : { ...value, origin };
  }

  if (value.alpha === undefined) {
    return origin;
  }

  const normalizedOrigin = normalizeColorEncoding(origin);
  const calculationContext: ColorResolutionContext = {
    ...context,
    numericVariables: relativeColorVariables(
      normalizedOrigin,
      context,
      null,
    ),
  };
  const alpha = resolveRelativeColorAlpha(
    value.alpha,
    normalizedOrigin,
    stage,
    calculationContext,
    null,
  );

  if (isDeferredColorAlpha(alpha)) {
    return {
      ...value,
      origin,
      alpha,
    };
  }

  const absoluteAlpha = alpha === 'none'
    ? undefined
    : alpha.value;

  if (Object.is(absoluteAlpha, normalizedOrigin.alpha)) {
    return origin;
  }

  return {
    ...normalizedOrigin,
    alpha: absoluteAlpha,
    ...(origin.isLegacySrgb ? { isLegacySrgb: true } : {}),
  };
}

function resolveRgbFn(
  value: RgbFn,
  alpha: SyntaxAlphaComponent,
  stage: ValueStage,
  context: MathContext,
): AbsoluteColor | RgbFn | ColorFn {
  const { components: values } = value;
  const metadata = COLOR_METADATA[ColorKind.RgbFn];

  if (
    alpha !== 'none' &&
    alpha.type !== 'math' &&
    alpha.value === 1 &&
    is8BitRgbComponents(values)
  ) {
    return {
      kind: ColorKind.Absolute,
      space: SPACES.srgb,
      components: mapTuple(
        values,
        (component) => component.value,
      ),
      alpha: 0xff,
      isLegacySrgb: true,
      is8Bit: true,
    };
  }

  const components = resolveColorComponents(
    values,
    stage,
    context,
    metadata.resolveAt,
  );
  const clamped = clampColorComponents(
    components,
    metadata,
    stage,
  );

  if (hasDeferredColorComponents(clamped)) {
    return {
      ...value,
      components: mapTuple(clamped, (component) =>
        canonicalizeColorComponent(
          component,
          1,
          0xff / 100,
        )),
    };
  }

  if (isDeferredColorAlpha(alpha)) {
    return {
      kind: ColorKind.ColorFn,
      space: 'srgb',
      components: mapTuple(
        clamped,
        (component, index) => {
          const componentMetadata = colorComponentMetadataAt(metadata, index);
          return canonicalizeColorComponent(
            component,
            componentMetadata.numberScale,
            componentMetadata.percentageScale,
          );
        },
      ),
      alpha,
    };
  }

  const scaled = mapTuple(
    clamped,
    (component, index) => scaleFnComponent(component, index, metadata),
  );

  return {
    kind: ColorKind.Absolute,
    space: SPACES.srgb,
    components: scaled,
    alpha: alpha === 'none' ? undefined : alpha.value,
    isLegacySrgb: true,
  };
}

function is8BitRgbComponents(
  values: RgbFn['components'],
): values is ColorComponentTuple<SrgbSpace, [
  red: NumberLiteral,
  green: NumberLiteral,
  blue: NumberLiteral,
]> {
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

function resolveMetadataColorFn(
  value: MetadataColorFn,
  alpha: SyntaxAlphaComponent,
  stage: ValueStage,
  context: MathContext,
): AbsoluteColor | MetadataColorFn {
  const metadata = COLOR_METADATA[value.kind];
  const resolved = mapTuple(
    value.components,
    (component, index) => resolveMetadataColorFnComponent(
      component,
      index,
      stage,
      context,
      metadata,
    ),
  ) as typeof value.components;
  const clamped = clampColorComponents(resolved, metadata, stage);
  const normalized = normalizeFnComponents(clamped, metadata);

  if (
    hasDeferredColorComponents(normalized) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...value,
      components: canonicalizeFnComponents(normalized, metadata),
    } as MetadataColorFn;
  }

  const absolute: PredefinedAbsoluteColor = {
    kind: ColorKind.Absolute,
    space: metadata.space,
    components: mapTuple(
      normalized,
      (component, index) => scaleFnComponent(component, index, metadata),
    ),
    alpha: alpha === 'none' ? undefined : alpha.value,
  };

  return metadata.convertToSrgb && !hasMissingColorComponent(absolute)
    ? convertToLegacySrgb(absolute)
    : absolute;
}

function resolveMetadataColorFnComponent(
  component: ClampableColorComponentValue,
  index: number,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorMetadata,
): ClampableColorComponentValue {
  const componentMetadata = colorComponentMetadataAt(metadata, index);

  return componentMetadata.isHue
    ? resolveHue(
      component as SyntaxHueComponent,
      stage,
      context,
      metadata.resolveAt,
    )
    : resolveColorComponent(
      component as SyntaxColorComponent,
      stage,
      context,
      metadata.resolveAt,
    );
}

function normalizeFnComponents<
  const Components extends ClampableColorComponentValues,
>(
  components: Components,
  metadata: ColorMetadata,
): Components {
  return mapTuple(components, (component, index) => (
    colorComponentMetadataAt(metadata, index).isHue
      ? normalizeHueValue(component as SyntaxHueComponent)
      : component
  )) as Components;
}

function convertToLegacySrgb(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  return {
    ...convertPredefinedAbsoluteColor(value, 'srgb'),
    isLegacySrgb: true,
  };
}

function resolveColorFn(
  value: ColorFn,
  alpha: SyntaxAlphaComponent,
  stage: ValueStage,
  context: ColorResolutionContext,
): AbsoluteColor | ColorFn {
  const space = value.space === 'xyz' ? 'xyz-d65' : value.space;
  const isCustom = isCustomColorProfileSpace(space);
  const metadata = isCustom && stage >= ValueStage.Computed
    ? CUSTOM_COLOR_FN_METADATA
    : COLOR_METADATA[ColorKind.ColorFn];
  const components = resolveColorComponents(
    value.components,
    stage,
    context,
    metadata.resolveAt,
  );
  const clamped = clampColorComponents(
    components,
    metadata,
    stage,
  );
  const canonical = canonicalizeFnComponents(clamped, metadata);
  const resolved = {
    ...value,
    space,
    components: canonical,
  };

  if (isCustom && stage < ValueStage.Computed) {
    return resolved;
  }

  if (
    hasDeferredColorComponents(clamped) ||
    isDeferredColorAlpha(alpha)
  ) {
    return resolved;
  }

  const scaled = mapTuple(
    clamped,
    (component, index) => scaleFnComponent(component, index, metadata),
  );
  const profile = colorProfileFor(space, context);

  if (profile === undefined) {
    return resolved;
  }

  if (isCustomColorProfileSpace(space)) {
    return absoluteColorInCustomSpace(
      space,
      profile,
      scaled,
      alpha,
    );
  }

  return absoluteColorFromProfile(
    profile,
    scaled,
    alpha,
  );
}

function absoluteColorInCustomSpace(
  space: CustomColorSpace['name'],
  profile: ColorProfile,
  components: readonly AbsoluteComponent[],
  alpha: AlphaLiteral | 'none',
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
        index < components.length ? components[index] : 0,
    ),
    alpha: alpha === 'none' ? undefined : alpha.value,
  };
}

function absoluteColorFromProfile(
  profile: ColorProfile,
  components: readonly AbsoluteComponent[],
  alpha: AlphaLiteral | 'none',
): PredefinedAbsoluteColor {
  const absolute = profile.toAbsoluteColor(
    components.map((component) => component ?? 0),
  );

  return {
    ...absolute,
    components: mapTuple(
      absolute.components,
      (component, index) =>
        components[index] === undefined ? undefined : component,
    ),
    alpha: alpha === 'none' ? undefined : alpha.value,
  };
}

function resolveColorComponents<
  const Values extends SyntaxColorComponent[],
>(
  values: Values,
  stage: ValueStage,
  context: MathContext,
  unwrapMathAt: ValueStage = ValueStage.Declared,
): { [Index in keyof Values]: SyntaxColorComponent } {
  return mapTuple(
    values,
    (value) => resolveColorComponent(
      value,
      stage,
      context,
      unwrapMathAt,
    ),
  );
}

function resolveColorComponent(
  value: SyntaxColorComponent,
  stage: ValueStage,
  context: MathContext,
  unwrapMathAt: ValueStage,
): SyntaxColorComponent {
  if (value === 'none') {
    return value;
  }

  return resolveColorNumericValue(value, stage, context, unwrapMathAt);
}

function hasDeferredColorComponents(
  values: readonly ClampableColorComponentValue[],
): boolean {
  return values.some(
    (value) => value !== 'none' && value.type === 'math',
  );
}

function canonicalizeColorComponent(
  value: SyntaxColorComponent,
  numberScale: number,
  percentageScale: number,
): SyntaxColorComponent {
  if (value === 'none' || value.type === 'math') {
    return value;
  }

  return {
    type: 'number',
    value: value.value * (
      value.type === 'percentage'
        ? percentageScale
        : numberScale
    ),
  };
}

function scaleColorComponent(
  value: SyntaxColorComponent,
  numberScale: number,
  percentageScale: number,
): AbsoluteComponent {
  if (value === 'none') {
    return undefined;
  }

  if (value.type === 'math') {
    throw new Error('Deferred color components cannot be scaled');
  }

  return value.value * (
    value.type === 'percentage'
      ? percentageScale
      : numberScale
  );
}

function resolveColorAlphaValue(
  value: SyntaxAlphaComponent | undefined,
  stage: ValueStage,
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

  const calculationContext = colorCalculationContext(context, ValueStage.Computed);
  const resolved = isNumberValue(value)
    ? resolveNumber(value, stage, calculationContext)
    : resolvePercentage(value, stage, calculationContext);

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
  stage: ValueStage,
  context: MathContext,
  unwrapMathAt: ValueStage = ValueStage.Declared,
): SyntaxHueComponent {
  if (value === 'none') {
    return value;
  }

  const calculationContext = colorCalculationContext(context, unwrapMathAt);
  return isNumberValue(value)
    ? resolveNumber(value, stage, calculationContext)
    : resolveAngle(value, stage, calculationContext);
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
  stage: ValueStage,
  context: MathContext,
  unwrapMathAt: ValueStage,
): NumberValue | PercentageValue {
  const calculationContext = colorCalculationContext(
    context,
    unwrapMathAt,
  );

  return isNumberValue(value)
    ? resolveNumber(value, stage, calculationContext)
    : resolvePercentage(value, stage, calculationContext);
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

type ClampableColorComponentValue =
  SyntaxColorComponent | SyntaxHueComponent;

type ClampableColorComponentValues = ClampableColorComponentValue[];

function clampColorComponents<
  const Values extends ClampableColorComponentValues,
>(
  components: Values,
  metadata: ColorMetadata,
  stage: ValueStage,
): { [Index in keyof Values]: Values[Index] } {
  const clampNonFinite = stage >= metadata.resolveAt;

  return mapTuple(
    components,
    (component: ClampableColorComponentValue, index) => {
      if (component === 'none' || component.type === 'math') {
        return component;
      }

      if (!clampNonFinite && !Number.isFinite(component.value)) {
        return component;
      }

      const clampable = normalizeForClamping(component.value);
      const componentMetadata = colorComponentMetadataAt(metadata, index);
      const range = component.type === 'percentage'
        ? componentMetadata.percentageRange
        : componentMetadata.numberRange;

      const value = range === null
        ? clampable
        : clamp(clampable, ...range);

      return Object.is(value, component.value)
        ? component
        : { ...component, value };
    },
  );
}

function colorComponentMetadataAt(
  metadata: ColorMetadata,
  index: number,
): ColorComponentMetadata {
  return metadata.components.length === 1
    ? metadata.components[0]!
    : metadata.components[index]!;
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
  context: ColorResolutionContext,
): DeviceCmykFn | AbsoluteColor<DeviceCmykSpace> {
  const alpha = resolveColorAlphaValue(value.alpha, stage, context);
  const components = resolveColorComponents(
    value.components,
    stage,
    context,
    DEVICE_CMYK_METADATA.resolveAt,
  );
  const resolved = (
    alpha === value.alpha &&
    components.every((component, index) => component === value.components[index])
  )
    ? value
    : { ...value, components, alpha };

  if (stage < ValueStage.Computed) {
    return resolved;
  }

  const clamped = clampColorComponents(
    components,
    DEVICE_CMYK_METADATA,
    stage,
  );
  const canonical = canonicalizeFnComponents(
    clamped,
    DEVICE_CMYK_METADATA,
  );

  if (
    hasDeferredColorComponents(canonical) ||
    isDeferredColorAlpha(alpha)
  ) {
    return {
      ...resolved,
      components: canonical,
    };
  }

  return {
    kind: ColorKind.Absolute,
    space: DEVICE_CMYK_SPACE,
    components: mapTuple(
      canonical,
      (component, index) =>
        scaleFnComponent(component, index, DEVICE_CMYK_METADATA),
    ),
    alpha: alpha === 'none' ? undefined : alpha.value,
  };
}

function resolveLightDarkColor(
  value: LightDarkColor,
  stage: ValueStage,
  context: ColorResolutionContext,
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
  context: ColorResolutionContext,
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
    case ColorKind.DeviceCmykFn:
      return serializeDeviceCmykFn(value);
    case ColorKind.LightDarkColor:
      return serializeLightDarkColor(value);
    case ColorKind.ContrastColorFn:
      return serializeContrastColorFn(value);
    case ColorKind.RgbFn:
    case ColorKind.HslFn:
    case ColorKind.HwbFn:
    case ColorKind.LabFn:
    case ColorKind.LchFn:
    case ColorKind.OklabFn:
    case ColorKind.OklchFn:
    case ColorKind.AlphaFn:
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
    case ColorKind.LabFn:
    case ColorKind.OklabFn:
    case ColorKind.LchFn:
    case ColorKind.OklchFn:
      return serializeMetadataColorFn(value);
    case ColorKind.AlphaFn:
      return serializeRelativeColorFn(
        'alpha',
        value.origin,
        [],
        value.alpha,
      );
    case ColorKind.ColorFn:
      return value.origin === undefined
        ? serializeModernColorFunction(
          'color',
          [
            value.space,
            ...serializeFnComponents(value),
          ],
          value.alpha,
        )
        : serializeRelativeColorFn(
          'color',
          value.origin,
          [
            value.space,
            ...serializeFnComponents(value),
          ],
          value.alpha,
        );
    default:
      return assertNever(value);
  }
}

function serializeMetadataColorFn(
  value: Exclude<MetadataColorFn, HslFn>,
): string {
  const metadata = COLOR_METADATA[value.kind];
  const components = serializeFnComponents(value);

  return value.origin === undefined
    ? serializeModernColorFunction(
      metadata.space.name,
      components,
      value.alpha,
    )
    : serializeRelativeColorFn(
      metadata.space.name,
      value.origin,
      components,
      value.alpha,
    );
}

function serializeFnComponents(
  value: Exclude<ColorFunction, AlphaFn>,
): string[] {
  const metadata = COLOR_METADATA[value.kind];
  const relative = value.origin !== undefined;

  return value.components.map((component, index) => {
    const componentMetadata = colorComponentMetadataAt(metadata, index);

    return componentMetadata.isHue
      ? serializeHue(component as SyntaxHueComponent)
      : serializeColorComponent(
        component as SyntaxColorComponent,
        relative ? null : componentMetadata.percentageReference,
      );
  });
}

function serializeRgbFn(
  value: RgbFn,
): string {
  if (value.origin !== undefined) {
    return serializeRelativeColorFn(
      'rgb',
      value.origin,
      serializeFnComponents(value),
      value.alpha,
    );
  }

  const components = serializeFnComponents(value);

  return value.syntax === 'legacy'
      && canUseLegacyColorSerialization([...value.components, value.alpha])
    ? serializeLegacyColorFunction('rgb', components, value.alpha)
    : serializeModernColorFunction('rgb', components, value.alpha);
}

function serializeHslFn(
  value: HslFn,
): string {
  const components = serializeFnComponents(value);

  if (value.origin !== undefined) {
    return serializeRelativeColorFn(
      'hsl',
      value.origin,
      components,
      value.alpha,
    );
  }

  return value.syntax === 'legacy'
      && canUseLegacyColorSerialization([
        ...value.components,
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
  const { name: space } = value.space;

  switch (space) {
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
      return serializeAbsoluteColorComponents(space, value);
    case 'srgb-linear':
    case 'display-p3':
    case 'display-p3-linear':
    case 'a98-rgb':
    case 'prophoto-rgb':
    case 'rec2020':
    case 'xyz-d50':
    case 'xyz-d65':
      return `color(${space} ${serializeAbsoluteColorComponentsBody(value)})`;
    case 'device-cmyk':
      return `device-cmyk(${serializeAbsoluteColorComponentsBody(value)})`;
    default:
      return `color(${space} ${serializeAbsoluteColorComponentsBody(value)})`;
  }
}

function serializeDeviceCmykFn(value: DeviceCmykFn): string {
  const components = value.components.map(
    (component) => serializeColorComponent(component, null),
  );

  return value.syntax === 'legacy' &&
      canUseLegacyColorSerialization(value.components)
    ? `device-cmyk(${components.join(', ')})`
    : serializeModernColorFunction(
      'device-cmyk',
      components,
      value.alpha,
    );
}

function serializeLightDarkColor(value: LightDarkColor): string {
  return `light-dark(${
    serializeColorValue(value.light)
  }, ${
    serializeColorValue(value.dark)
  })`;
}

function serializeContrastColorFn(value: ContrastColorFn): string {
  return `contrast-color(${serializeColorValue(value.color)})`;
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

type ColorVector = [number, number, number];

type ColorMatrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export type ColorConversionContext = {
  colorProfiles?: ReadonlyMap<ColorProfileSpace, ColorProfile>;
};

export function convertAbsoluteColor(
  value: AbsoluteColor,
  target: ColorSpaceName,
  context: ColorConversionContext = {},
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
  context: ColorConversionContext,
): PredefinedAbsoluteColor {
  const predefined = tryCoercePredefinedAbsoluteColor(value, context);

  if (predefined === null) {
    throw new TypeError(`Cannot convert color space ${value.space.name}`);
  }

  return predefined;
}

function tryCoercePredefinedAbsoluteColor(
  value: AbsoluteColor,
  context: ColorConversionContext,
): PredefinedAbsoluteColor | null {
  const { name } = value.space;

  if (isPredefinedColorSpaceName(name)) {
    return value as PredefinedAbsoluteColor;
  }

  const profile = context.colorProfiles?.get(name);

  if (name === DEVICE_CMYK_SPACE.name && profile === undefined) {
    return naivelyConvertDeviceCmykToSrgb(
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
  const normalized = normalizeColorEncoding(value);

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

function normalizeColorEncoding<Space extends AbsoluteColorSpace>(
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

export function naivelyConvertDeviceCmykToSrgb(
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
  };
}

export function naivelyConvertSrgbToDeviceCmyk(
  value: PredefinedAbsoluteColor,
): AbsoluteColor<DeviceCmykSpace> {
  const srgb = convertPredefinedAbsoluteColor(value, 'srgb');
  const [red, green, blue] = mapTuple(
    srgb.components,
    (component) => clamp(component ?? 0, 0, 1),
  );
  const black = 1 - Math.max(red, green, blue);
  const scale = 1 - black;
  const components: AbsoluteColor<DeviceCmykSpace>['components'] =
    scale === 0
      ? [0, 0, 0, 1]
      : [
        (1 - red - black) / scale,
        (1 - green - black) / scale,
        (1 - blue - black) / scale,
        black,
      ];

  return {
    kind: ColorKind.Absolute,
    space: DEVICE_CMYK_SPACE,
    components,
    alpha: srgb.alpha,
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
  context: ColorConversionContext = {},
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
    }, destination, context);
  }

  if (lightness <= 0) {
    return convertAbsoluteColor({
      kind: ColorKind.Absolute,
      space: SPACES.oklab,
      components: [0, 0, 0],
      alpha: origin.alpha,
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
  context: ColorConversionContext,
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
  context: ColorConversionContext,
): boolean {
  const gamutSpace = destination === 'hsl' || destination === 'hwb'
    ? 'srgb'
    : destination;
  const converted = convertAbsoluteColor(value, gamutSpace, context);

  return converted.components.every(
    (component) =>
      component !== undefined
      && component >= 0
      && component <= 1,
  );
}

function clipColorToGamut(
  value: AbsoluteColor,
  destination: ColorSpaceName,
  context: ColorConversionContext,
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
  context: ColorConversionContext = {},
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

export function deltaEOK(
  one: AbsoluteColor,
  two: AbsoluteColor,
  context: ColorConversionContext = {},
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
  context: ColorConversionContext = {},
): boolean {
  const preparedA = prepareAbsoluteColorForComparison(a);
  const preparedB = prepareAbsoluteColorForComparison(b);

  if (preparedA.space.name === preparedB.space.name) {
    return areColorComponentsEquivalent(preparedA, preparedB);
  }

  if (
    hasMissingColorComponent(preparedA)
    || hasMissingColorComponent(preparedB)
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
  space?: ColorSpaceName,
  hue: HueInterpolationMethod = 'shorter',
  context: ColorConversionContext = {},
): PredefinedAbsoluteColor {
  space ??= (a.isLegacySrgb && b.isLegacySrgb
    ? 'srgb'
    : 'oklab');

  const carriedA = findCarriedForwardComponents(a, space);
  const carriedB = findCarriedForwardComponents(b, space);

  const normalizedA = normalizeColorEncoding(a);
  const convertedA = convertPredefinedAbsoluteColor(
    replaceMissingComponents(
      coercePredefinedAbsoluteColor(normalizedA, context),
    ),
    space,
  );

  const normalizedB = normalizeColorEncoding(b);
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

function premultiplyColor(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  if (value.alpha === undefined) {
    return value;
  }

  const alpha = value.alpha;
  const hueIndex = colorHueIndex(value.space.name);
  const components = componentsForConversion(value);
  const premultiplied = value.space.name === 'hsl'
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
  a: PredefinedAbsoluteColor,
  b: PredefinedAbsoluteColor,
  progress: number,
): PredefinedAbsoluteColor {
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

function unpremultiplyColor(
  value: PredefinedAbsoluteColor,
): PredefinedAbsoluteColor {
  if (value.alpha === undefined || value.alpha === 0) {
    return value;
  }

  const alpha = value.alpha;
  const hueIndex = colorHueIndex(value.space.name);
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
  value: PredefinedAbsoluteColor,
  components: ColorVector,
): PredefinedAbsoluteColor['components'] {
  return mapTuple(
    value.components,
    (component, index) =>
      component === undefined ? undefined : components[index],
  );
}

function colorHueIndex(space: ColorSpaceName): 0 | 2 | undefined {
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
  context: ColorConversionContext = {},
): PredefinedAbsoluteColor {
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

  const converted = convertAbsoluteColor(color, method.space, context);

  if (converted.alpha === undefined) {
    return converted;
  }

  return {
    ...converted,
    alpha: converted.alpha * (1 - leftover / 100),
  };
}



// ████████  ████████ ██          ███    ████████ ████ ██     ██ ████████
// ██     ██ ██       ██         ██ ██      ██     ██  ██     ██ ██
// ██     ██ ██       ██        ██   ██     ██     ██  ██     ██ ██
// ████████  ██████   ██       ██     ██    ██     ██  ██     ██ ██████
// ██   ██   ██       ██       █████████    ██     ██   ██   ██  ██
// ██    ██  ██       ██       ██     ██    ██     ██    ██ ██   ██
// ██     ██ ████████ ████████ ██     ██    ██    ████    ███    ████████

type RelativeColorParserContext = ColorResolutionContext & {
  relativeColorVariables?: ReadonlyMap<string, NumericVariable>;
};

type PreparedRelativeColorResolution =
  | { origin: ColorValue; }
  | {
    origin: AbsoluteColor;
    convertedOrigin: AbsoluteColor;
    calculationContext: MathContext;
  };

function tryConsumeRelativeColorOrigin(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorValue> {
  return consumeRelativeColorOrigin(c);
}

const consumeRelativeColorOrigin = sequenceOf(
  [
    one(createKeywordConsumer('from')),
    one(withComponentTrivia(consumeColor)),
  ],
  ([, [origin]]) => ok(origin),
);

function tryConsumeRelativeColorKeyword(
  c: ComponentCursor,
): TryComponentConsumerResult<NumberValue> {
  const start = c.pos();
  const ident = tryConsumeIdent(c);

  if (ident === null || isBad(ident)) {
    return ident;
  }

  const name = asciiLower(ident.value.value);
  const variable = relativeColorVariablesFor(c.context)?.get(name);

  if (variable === undefined) {
    c.restore(start);
    return null;
  }

  return ok(promoteNumericVariable(
    name,
    'number',
    colorResolutionContextFor(c.context),
  ));
}

function contextWithRelativeColorVariables(
  context: unknown,
  components: readonly string[],
  includeAlpha = true,
): RelativeColorParserContext {
  const outer = colorResolutionContextFor(context);
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

  const resolutionContext = colorResolutionContextFor(context);
  const profile = colorProfileFor(space, resolutionContext);

  return contextWithRelativeColorVariables(
    resolutionContext,
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

type RelativeColorValue = NumberLiteral | 'none';
type RelativeColorFnValues = ReadonlyMap<string, RelativeColorValue>;

function relativeColorFnValues(
  profile: ColorProfile,
  components: ColorProfileComponentValues,
  alpha: number | undefined,
): RelativeColorFnValues {
  const values: Map<string, RelativeColorValue> = new Map(
    profile.components.map((name, index) => [
      name,
      {
        type: 'number',
        value: components[index] ?? 0,
      } satisfies NumberLiteral,
    ] as const),
  );

  if (!isCustomColorProfileSpace(profile.space)) {
    values.set(
      'alpha',
      alpha === undefined
        ? 'none'
        : { type: 'number', value: alpha },
    );
  }

  return values;
}

function relativeColorValue(
  values: RelativeColorFnValues,
  name: string,
): RelativeColorValue {
  const value = values.get(name);

  if (value === undefined) {
    throw new TypeError(`Unknown relative color variable: ${name}`);
  }

  return value;
}

function relativeColorNumericVariables(
  context: MathContext,
  values: Iterable<readonly [string, RelativeColorValue]>,
): ReadonlyMap<string, NumericVariable> {
  return new Map([
    ...(context.numericVariables ?? []),
    ...[...values].map(([name, value]) => [
      name,
      relativeColorNumericVariable(value),
    ] as const),
  ]);
}

function prepareRelativeColorResolution(
  originValue: ColorValue,
  stage: ValueStage,
  context: ColorResolutionContext,
  metadata: ColorMetadata,
): PreparedRelativeColorResolution {
  const { space } = metadata;

  if (space === null) {
    throw new TypeError('Relative color metadata requires a color space');
  }

  const origin = resolveColorValueInternal(originValue, stage, context);

  if (origin.kind !== ColorKind.Absolute) {
    return { origin };
  }

  const convertedOrigin = convertRelativeColorOrigin(
    origin,
    space.name,
    context,
  );

  return {
    origin,
    convertedOrigin,
    calculationContext: {
      ...context,
      numericVariables: relativeColorVariables(
        convertedOrigin,
        context,
        metadata,
      ),
    },
  };
}

function convertRelativeColorOrigin(
  origin: AbsoluteColor,
  space: ColorSpaceName,
  context: ColorConversionContext,
): PredefinedAbsoluteColor {
  const normalized = normalizeColorEncoding(origin);

  if (normalized.space.name === space) {
    return convertAbsoluteColor(normalized, space, context);
  }

  const carried = findCarriedForwardComponents(normalized, space);
  const converted = convertAbsoluteColor(normalized, space, context);

  return {
    ...converted,
    components: mapTuple(
      converted.components,
      (component, index) =>
        carried.components[index] ? undefined : component,
    ),
    alpha: carried.alpha ? undefined : converted.alpha,
  };
}

function relativeColorVariables(
  origin: AbsoluteColor,
  context: MathContext,
  metadata: ColorMetadata | null,
): ReadonlyMap<string, NumericVariable> {
  return relativeColorNumericVariables(
    context,
    relativeColorVariableNames(
      metadata?.space?.keys ?? [],
    ).map((name) => [
      name,
      relativeColorChannelValue(name, origin, metadata),
    ] as const),
  );
}

function relativeColorNumericVariable(
  value: RelativeColorValue,
): NumericVariable {
  return {
    value,
    valueType: 'number',
  };
}

function resolveRelativeColorFnComponent(
  value: SyntaxColorComponent,
  origin: RelativeColorFnValues,
  stage: ValueStage,
  context: MathContext,
): SyntaxColorComponent {
  const name = value !== 'none' && value.type === 'math'
    ? promotedNumericVariableName(value)
    : null;

  return name === null
    ? resolveColorComponent(value, stage, context, ValueStage.Computed)
    : relativeColorValue(origin, name);
}

function resolveRelativeColorFnAlpha(
  value: SyntaxAlphaComponent | undefined,
  origin: RelativeColorFnValues,
  originAlpha: number | undefined,
  stage: ValueStage,
  context: ColorResolutionContext,
): SyntaxAlphaComponent {
  if (value === undefined) {
    return originAlpha === undefined
      ? 'none'
      : { type: 'number', value: originAlpha };
  }

  const name = value !== 'none' && value.type === 'math'
    ? promotedNumericVariableName(value)
    : null;

  return resolveColorAlphaValue(
    name === null ? value : relativeColorValue(origin, name),
    stage,
    context,
  );
}

function resolveRelativeColorComponent(
  value: SyntaxColorComponent,
  origin: AbsoluteColor,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorMetadata,
): SyntaxColorComponent {
  const channelName = promotedRelativeColorChannelName(value, metadata);

  if (channelName !== null) {
    return relativeColorChannelValue(channelName, origin, metadata);
  }

  return resolveColorComponent(value, stage, context, ValueStage.Computed);
}

function resolveRelativeColorHue(
  value: SyntaxHueComponent,
  origin: AbsoluteColor,
  stage: ValueStage,
  context: MathContext,
  metadata: ColorMetadata,
): SyntaxHueComponent {
  const channelName = promotedRelativeColorChannelName(value, metadata);

  return channelName === null
    ? resolveHue(value, stage, context, ValueStage.Computed)
    : relativeColorChannelValue(channelName, origin, metadata);
}

function resolveRelativeColorAlpha(
  value: SyntaxAlphaComponent | undefined,
  origin: AbsoluteColor,
  stage: ValueStage,
  context: ColorResolutionContext,
  metadata: ColorMetadata | null,
): SyntaxAlphaComponent {
  if (value === undefined) {
    return origin.alpha === undefined
      ? 'none'
      : { type: 'number', value: origin.alpha };
  }

  const channelName = promotedRelativeColorChannelName(value, metadata);
  return resolveColorAlphaValue(
    channelName === null
      ? value
      : relativeColorChannelValue(channelName, origin, metadata),
    stage,
    context,
  );
}

function relativeColorChannelValue(
  name: string,
  origin: AbsoluteColor,
  metadata: ColorMetadata | null,
): NumberLiteral | 'none' {
  if (name === 'alpha') {
    return origin.alpha === undefined
      ? 'none'
      : { type: 'number', value: origin.alpha };
  }

  const source = relativeColorComponentIndex(metadata, name);

  if (source === null || metadata === null) {
    throw new TypeError(`Unknown relative color variable: ${name}`);
  }

  const value = origin.components[source];

  if (value === undefined) {
    return 'none';
  }

  return {
    type: 'number',
    value: value / metadata.components[source]!.numberScale,
  };
}

function promotedRelativeColorChannelName(
  value: SyntaxColorComponent | SyntaxHueComponent,
  metadata: ColorMetadata | null,
): string | null {
  if (value === 'none' || value.type !== 'math') {
    return null;
  }

  const name = promotedNumericVariableName(value);

  if (name === null) {
    return null;
  }

  if (
    name !== 'alpha' &&
    relativeColorComponentIndex(metadata, name) === null
  ) {
    throw new TypeError(`Unknown promoted relative color variable: ${name}`);
  }

  return name;
}

function relativeColorComponentIndex(
  metadata: ColorMetadata | null,
  name: string,
): number | null {
  if (metadata?.space === null || metadata?.space === undefined) {
    return null;
  }

  const keys: readonly string[] = metadata.space.keys;
  const index = keys.indexOf(name);
  return index === -1 ? null : index;
}

function serializeRelativeColorFn(
  name: string,
  origin: ColorValue,
  components: string[],
  alphaValue: SyntaxAlphaComponent | undefined,
): string {
  const alpha = alphaValue === undefined
    ? null
    : serializeColorComponent(alphaValue, null);
  const body = [
    'from',
    serializeRelativeColorOrigin(origin),
    ...components,
  ].join(' ');

  return alpha === null
    ? `${name}(${body})`
    : `${name}(${body} / ${alpha})`;
}

function serializeRelativeColorOrigin(
  value: ColorValue,
): string {
  return value.kind === ColorKind.Hex
    ? value.text
    : serializeColorValue(value);
}
