import { assertNever, clamp } from '../../shared/util';
import type { ComponentCursor } from '../parser/component-cursor';
import { createDelimConsumer, createFunctionalNotationConsumer, tryConsumeHashToken } from '../parser/component-consumers';
import {
  commaRepeat, one, oneOf, opt, repeat, sequenceOf, withComponentTrivia,
} from '../parser/component-grammar';
import {
  isBad, ok,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import { tryConsumeAngle, type AngleValue } from './angle';
import {
  serializeMathValue,
  type CalculationContext, type CalculationSerializationContext,
} from './calc';
import { ColorName, colorNameFromText, SystemColorName, systemColorNameFromText } from './color-keywords';
import { tryConsumeIdent } from './ident';
import { createKeywordConsumer } from './keyword';
import { resolveAngle } from './numeric-literal/angle';
import { serializeCssNumber } from './numeric-literal/number';
import { serializeNumber, tryConsumeNumber, type NumberValue } from './number';
import { tryConsumePercentage, type PercentageValue } from './percentage';

/*
 * <color> = <color-base> | currentColor | <system-color>
 *
 * <color-base> = <hex-color> | <color-function> | <named-color> | transparent
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
  | NumericColor
  | ColorBase
  | CurrentColor
  | SystemColor;

// Not a grammar production. This numerical form is inferred by the color
// resolution, conversion, interpolation, and serialization algorithms.
export type NumericColor = {
  kind: ColorKind.Numeric;
  space: ColorSpace;
  components: ColorComponents;
  alpha: number | undefined;
};

type ColorSpace =
  // Internal variant for colors serialized with rgb() or rgba().
  | 'srgb-legacy'
  | 'srgb'
  | 'srgb-linear'
  | 'hsl'
  | 'hwb'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch'
  | 'display-p3'
  | 'display-p3-linear'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020'
  | 'xyz-d50'
  | 'xyz-d65';

type ColorComponent = number | undefined;

type ColorComponents = [
  ColorComponent,
  ColorComponent,
  ColorComponent,
];

export type ColorBase =
  | HexColor
  | ColorFunction
  | NamedColor
  | TransparentColor;

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
  Hex,
  Rgb,
  Hsl,
  Hwb,
  Lab,
  Lch,
  Oklab,
  Oklch,
  Color,
  Numeric,
}

type AlphaValue = NumberValue | PercentageValue;
type HueValue = NumberValue | AngleValue;

export function parseColorValue(
  input: ParserInput,
  context: CalculationContext = {},
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
  return consumeColor(c);
}

const consumeColor: TryComponentConsumer<ColorValue> = oneOf(
  [
    one(tryConsumeColorBase),
    one(tryConsumeCurrentColor),
    one(tryConsumeSystemColor),
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
    one(tryConsumeTransparent),
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
 * Named colors are CSS identifiers recognized by colorNameFromText.
 */

export type NamedColor = {
  kind: ColorKind.Named;
  name: Exclude<ColorName, ColorName.transparent>;
};

export type TransparentColor = {
  kind: ColorKind.Named;
  name: ColorName.transparent;
};

function tryConsumeNamedColor(
  c: ComponentCursor,
): TryComponentConsumerResult<NamedColor> {
  const start = c.pos();
  const ident = tryConsumeIdent(c);

  if (ident === null || isBad(ident)) {
    return ident;
  }

  const name = colorNameFromText(ident.value.value);

  if (name === undefined || name === ColorName.transparent) {
    c.restore(start);
    return null;
  }

  return ok({
    kind: ColorKind.Named,
    name,
  });
}

/*
 * <system-color>
 *
 * System colors are CSS identifiers recognized by systemColorNameFromText.
 */

export type SystemColor = {
  kind: ColorKind.System;
  name: SystemColorName;
};

function tryConsumeSystemColor(
  c: ComponentCursor,
): TryComponentConsumerResult<SystemColor> {
  const start = c.pos();
  const ident = tryConsumeIdent(c);

  if (ident === null || isBad(ident)) {
    return ident;
  }

  const name = systemColorNameFromText(ident.value.value);

  if (name === undefined) {
    c.restore(start);
    return null;
  }

  return ok({
    kind: ColorKind.System,
    name,
  });
}

/*
 * transparent
 */

function tryConsumeTransparent(
  c: ComponentCursor,
): TryComponentConsumerResult<TransparentColor> {
  const keyword = tryConsumeTransparentKeyword(c);

  if (keyword === null || isBad(keyword)) {
    return keyword;
  }

  return ok({
    kind: ColorKind.Named,
    name: ColorName.transparent,
  });
}

const tryConsumeTransparentKeyword = createKeywordConsumer('transparent');

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

//  ██████  ████████ ████████  ████    ███    ██
// ██    ██ ██       ██     ██  ██    ██ ██   ██
// ██       ██       ██     ██  ██   ██   ██  ██
//  ██████  ██████   ████████   ██  ██     ██ ██
//       ██ ██       ██   ██    ██  █████████ ██
// ██    ██ ██       ██    ██   ██  ██     ██ ██
//  ██████  ████████ ██     ██ ████ ██     ██ ████████

export function serializeColorValue(
  value: ColorValue,
  context: CalculationSerializationContext = {},
): string {
  switch (value.kind) {
    case ColorKind.Numeric:
      return serializeNumericColor(value);
    case ColorKind.Hex:
      return value.text.toLowerCase();
    case ColorKind.Rgb:
    case ColorKind.Hsl:
    case ColorKind.Hwb:
    case ColorKind.Lab:
    case ColorKind.Lch:
    case ColorKind.Oklab:
    case ColorKind.Oklch:
    case ColorKind.Color:
      return serializeColorFunction(value, context);
    case ColorKind.Named:
      return ColorName[value.name];
    case ColorKind.CurrentColor:
      return 'currentcolor';
    case ColorKind.System:
      return SystemColorName[value.name].toLowerCase();
    default:
      return assertNever(value);
  }
}

function serializeColorFunction(
  value: ColorFunction,
  context: CalculationSerializationContext,
): string {
  switch (value.kind) {
    case ColorKind.Rgb:
      return serializeRgbColor(value, context);
    case ColorKind.Hsl:
      return serializeHslColor(value, context);
    case ColorKind.Hwb:
      return serializeModernColorFunction(
        'hwb',
        [
          serializeHue(value.hue, context),
          serializeColorComponent(value.whiteness, 100, context),
          serializeColorComponent(value.blackness, 100, context),
        ],
        value.alpha,
        context,
      );
    case ColorKind.Lab:
    case ColorKind.Oklab: {
      const oklab = value.kind === ColorKind.Oklab;

      return serializeModernColorFunction(
        oklab ? 'oklab' : 'lab',
        [
          serializeColorComponent(value.lightness, oklab ? 1 : 100, context),
          serializeColorComponent(value.a, oklab ? 0.4 : 125, context),
          serializeColorComponent(value.b, oklab ? 0.4 : 125, context),
        ],
        value.alpha,
        context,
      );
    }
    case ColorKind.Lch:
    case ColorKind.Oklch: {
      const oklch = value.kind === ColorKind.Oklch;

      return serializeModernColorFunction(
        oklch ? 'oklch' : 'lch',
        [
          serializeColorComponent(value.lightness, oklch ? 1 : 100, context),
          serializeColorComponent(value.chroma, oklch ? 0.4 : 150, context),
          serializeHue(value.hue, context),
        ],
        value.alpha,
        context,
      );
    }
    case ColorKind.Color:
      return serializeModernColorFunction(
        'color',
        [
          value.space === 'xyz' ? 'xyz-d65' : value.space,
          ...value.components.map(
            (component) => serializeColorComponent(component, 1, context),
          ),
        ],
        value.alpha,
        context,
      );
    default:
      return assertNever(value);
  }
}

function serializeRgbColor(
  value: RgbColor,
  context: CalculationSerializationContext,
): string {
  const components = value.components.map(
    (component) => serializeColorComponent(component, 255, context),
  );

  return value.syntax === 'legacy'
    ? serializeLegacyColorFunction('rgb', components, value.alpha, context)
    : serializeModernColorFunction('rgb', components, value.alpha, context);
}

function serializeHslColor(
  value: HslColor,
  context: CalculationSerializationContext,
): string {
  const components = [
    serializeHue(value.hue, context),
    serializeColorComponent(value.saturation, 100, context),
    serializeColorComponent(value.lightness, 100, context),
  ];

  return value.syntax === 'legacy'
    ? serializeLegacyColorFunction('hsl', components, value.alpha, context)
    : serializeModernColorFunction('hsl', components, value.alpha, context);
}

function serializeLegacyColorFunction(
  name: 'rgb' | 'hsl',
  components: string[],
  alphaValue: AlphaValue | 'none' | undefined,
  context: CalculationSerializationContext,
): string {
  const alpha = serializeColorAlpha(alphaValue, context);

  return alpha === null
    ? `${name}(${components.join(', ')})`
    : `${name}a(${components.join(', ')}, ${alpha})`;
}

function serializeModernColorFunction(
  name: string,
  components: string[],
  alphaValue: AlphaValue | 'none' | undefined,
  context: CalculationSerializationContext,
): string {
  const alpha = serializeColorAlpha(alphaValue, context);

  return alpha === null
    ? `${name}(${components.join(' ')})`
    : `${name}(${components.join(' ')} / ${alpha})`;
}

function serializeHue(
  value: HueValue | 'none',
  context: CalculationSerializationContext,
): string {
  if (value === 'none') {
    return value;
  }

  if (value.type === 'angle') {
    return serializeCssNumber(resolveAngle(value).value);
  }

  return serializeColorComponent(value, 1, context);
}

function serializeColorComponent(
  value: NumberValue | PercentageValue | 'none',
  percentageReference: number,
  context: CalculationSerializationContext,
): string {
  if (value === 'none') {
    return value;
  }

  switch (value.type) {
    case 'number':
      return serializeNumber(value);
    case 'percentage':
      return serializeCssNumber(
        value.value * percentageReference / 100,
      );
    case 'math':
      return serializeMathValue(value, context);
    default:
      return assertNever(value);
  }
}

function serializeColorAlpha(
  value: AlphaValue | 'none' | undefined,
  context: CalculationSerializationContext,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (value === 'none') {
    return value;
  }

  if (value.type === 'math') {
    return serializeMathValue(value, context);
  }

  const alpha = value.type === 'percentage'
    ? value.value / 100
    : value.value;
  const clamped = Number.isNaN(alpha)
    ? 0
    : clamp(alpha, 0, 1);

  return clamped === 1
    ? null
    : serializeCssNumber(clamped);
}

function serializeNumericColor(value: NumericColor): string {
  switch (value.space) {
    case 'srgb-legacy':
      return serializeNumericRgb(value);
    case 'hsl':
      return serializeNumericHsl(value);
    case 'hwb':
      return serializeNumericHwb(value);
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch':
      return serializeNumericComponents(value.space, value);
    case 'srgb':
    case 'srgb-linear':
    case 'display-p3':
    case 'display-p3-linear':
    case 'a98-rgb':
    case 'prophoto-rgb':
    case 'rec2020':
    case 'xyz-d50':
    case 'xyz-d65':
      return `color(${value.space} ${serializeNumericComponentsBody(value)})`;
    default:
      return assertNever(value.space);
  }
}

function serializeNumericRgb(
  value: NumericColor,
): string {
  if (
    value.components.some((component) => component === undefined) ||
    value.alpha === undefined
  ) {
    return `color(srgb ${serializeNumericComponentsBody(value)})`;
  }

  const components = value.components.map(
    (component) => serializeCssNumber(clamp(component!, 0, 1) * 255),
  );
  const alpha = serializeNumericAlpha(value.alpha);

  return alpha === null
    ? `rgb(${components.join(', ')})`
    : `rgba(${components.join(', ')}, ${alpha})`;
}

function serializeNumericHsl(
  value: NumericColor,
): string {
  const [hue, saturation, lightness] = value.components;
  const components = [
    serializeNumericComponent(hue),
    serializeNumericPercentage(saturation),
    serializeNumericPercentage(lightness),
  ];

  return serializeNumericFunction('hsl', components, value.alpha);
}

function serializeNumericHwb(
  value: NumericColor,
): string {
  const [hue, whiteness, blackness] = value.components;
  const components = [
    serializeNumericComponent(hue),
    serializeNumericPercentage(whiteness),
    serializeNumericPercentage(blackness),
  ];

  return serializeNumericFunction('hwb', components, value.alpha);
}

function serializeNumericComponents(
  name: 'lab' | 'lch' | 'oklab' | 'oklch',
  value: NumericColor,
): string {
  return serializeNumericFunction(
    name,
    value.components.map(serializeNumericComponent),
    value.alpha,
  );
}

function serializeNumericComponentsBody(value: NumericColor): string {
  const components = value.components
    .map(serializeNumericComponent)
    .join(' ');
  const alpha = serializeNumericAlpha(value.alpha);

  return alpha === null
    ? components
    : `${components} / ${alpha}`;
}

function serializeNumericFunction(
  name: string,
  components: string[],
  alphaValue: number | undefined,
): string {
  const alpha = serializeNumericAlpha(alphaValue);

  return alpha === null
    ? `${name}(${components.join(' ')})`
    : `${name}(${components.join(' ')} / ${alpha})`;
}

function serializeNumericComponent(value: ColorComponent): string {
  return value === undefined
    ? 'none'
    : serializeCssNumber(value);
}

function serializeNumericPercentage(value: ColorComponent): string {
  return value === undefined
    ? 'none'
    : `${serializeCssNumber(value)}%`;
}

function serializeNumericAlpha(value: number | undefined): string | null {
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
