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

// ████████  ████████  ██████   ███████  ██       ██     ██ ████████
// ██     ██ ██       ██    ██ ██     ██ ██       ██     ██ ██
// ██     ██ ██       ██       ██     ██ ██       ██     ██ ██
// ████████  ██████    ██████  ██     ██ ██       ██     ██ ██████
// ██   ██   ██             ██ ██     ██ ██        ██   ██  ██
// ██    ██  ██       ██    ██ ██     ██ ██         ██ ██   ██
// ██     ██ ████████  ██████   ███████  ████████    ███    ████████



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

type WhitePoint = 'd50' | 'd65';

type ColorVector = [number, number, number];

type ColorMatrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export function convertNumericColor(
  value: NumericColor,
  target: ColorSpace,
): NumericColor {
  if (value.space === target) {
    return value;
  }

  const source = replaceMissingColorComponents(
    prepareNumericColorForConversion(value),
  );
  const rectangularTarget = rectangularColorSpace(target);
  let converted: NumericColor;

  if (source.space === rectangularTarget) {
    converted = source;
  } else {
    let xyz = convertNumericColorToXyz(source);
    const targetWhitePoint = colorSpaceWhitePoint(rectangularTarget);

    if (colorSpaceWhitePoint(source.space) !== targetWhitePoint) {
      xyz = targetWhitePoint === 'd50'
        ? adaptD65ToD50(xyz)
        : adaptD50ToD65(xyz);
    }

    converted = convertXyzToNumericColor(xyz, rectangularTarget);
  }

  return convertRectangularNumericColor(converted, target);
}

function prepareNumericColorForConversion(
  value: NumericColor,
): NumericColor {
  const prepared = replacePowerlessColorComponents(value);

  switch (prepared.space) {
    case 'srgb-legacy':
      return { ...prepared, space: 'srgb' };
    case 'hsl':
      return convertHslToRgb(prepared);
    case 'hwb':
      return convertHwbToRgb(prepared);
    case 'lch':
      return convertLchToLab(prepared);
    case 'oklch':
      return convertOklchToOklab(prepared);
    default:
      return prepared;
  }
}

function replacePowerlessColorComponents(value: NumericColor): NumericColor {
  const [firstComp, secondComp, thirdComp] = value.components;
  const second = secondComp ?? 0;
  const third = thirdComp ?? 0;

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
      return second <= 0.0015 && thirdComp !== undefined
        ? { ...value, components: [firstComp, second, undefined] }
        : value;
    case 'oklch':
      return second <= 0.000004 && thirdComp !== undefined
        ? { ...value, components: [firstComp, second, undefined] }
        : value;
    default:
      return value;
  }
}

function replaceMissingColorComponents(value: NumericColor): NumericColor {
  return {
    ...value,
    components: componentsForConversion(value),
  };
}

function rectangularColorSpace(value: ColorSpace): ColorSpace {
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

function convertNumericColorToXyz(value: NumericColor): NumericColor {
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
    kind: ColorKind.Numeric,
    space,
    components: xyz,
    alpha: value.alpha,
  };
}

function convertXyzToNumericColor(
  value: NumericColor,
  target: ColorSpace,
): NumericColor {
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
      throw new Error(`Cannot convert XYZ directly to ${target}`);
  }

  return {
    kind: ColorKind.Numeric,
    space: target,
    components,
    alpha: value.alpha,
  };
}

function convertRectangularNumericColor(
  value: NumericColor,
  target: ColorSpace,
): NumericColor {
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

function convertHslToRgb(value: NumericColor): NumericColor {
  const components = componentsForConversion(value);

  return {
    kind: ColorKind.Numeric,
    space: 'srgb',
    components: hslToRgb(...components),
    alpha: value.alpha,
  };
}

function convertRgbToHsl(value: NumericColor): NumericColor {
  const [red, green, blue] = componentsForConversion(value);
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue);

  return {
    kind: ColorKind.Numeric,
    space: 'hsl',
    components: [
      Number.isNaN(hue) ? undefined : hue,
      saturation,
      lightness,
    ],
    alpha: value.alpha,
  };
}

function convertHwbToRgb(value: NumericColor): NumericColor {
  const components = componentsForConversion(value);

  return {
    kind: ColorKind.Numeric,
    space: 'srgb',
    components: hwbToRgb(...components),
    alpha: value.alpha,
  };
}

function convertRgbToHwb(value: NumericColor): NumericColor {
  const [red, green, blue] = componentsForConversion(value);
  const [hue, whiteness, blackness] = rgbToHwb(red, green, blue);

  return {
    kind: ColorKind.Numeric,
    space: 'hwb',
    components: [
      Number.isNaN(hue) ? undefined : hue,
      whiteness,
      blackness,
    ],
    alpha: value.alpha,
  };
}

function convertLabToLch(value: NumericColor): NumericColor {
  const [lightness, chroma, hue] = labToLch(
    componentsForConversion(value),
  );

  return {
    kind: ColorKind.Numeric,
    space: 'lch',
    components: [
      lightness,
      chroma,
      Number.isNaN(hue) ? undefined : hue,
    ],
    alpha: value.alpha,
  };
}

function convertLchToLab(value: NumericColor): NumericColor {
  const [lightness = 0, chroma = 0, hue] = value.components;

  return {
    kind: ColorKind.Numeric,
    space: 'lab',
    components: hue === undefined
      ? [lightness, 0, 0]
      : lchToLab([lightness, chroma, hue]),
    alpha: value.alpha,
  };
}

function convertOklabToOklch(value: NumericColor): NumericColor {
  const [lightness, chroma, hue] = oklabToOklch(
    componentsForConversion(value),
  );

  return {
    kind: ColorKind.Numeric,
    space: 'oklch',
    components: [
      lightness,
      chroma,
      Number.isNaN(hue) ? undefined : hue,
    ],
    alpha: value.alpha,
  };
}

function convertOklchToOklab(value: NumericColor): NumericColor {
  const [lightness = 0, chroma = 0, hue] = value.components;

  return {
    kind: ColorKind.Numeric,
    space: 'oklab',
    components: hue === undefined
      ? [lightness, 0, 0]
      : oklchToOklab([lightness, chroma, hue]),
    alpha: value.alpha,
  };
}

function componentsForConversion(
  value: NumericColor,
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
  const epsilon = 1 / 100000;

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

  if (sat <= epsilon) {
    hue = Number.NaN;
  }

  return [hue, sat * 100, light * 100];
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
  const epsilon = 1 / 100000;
  let hue = rgbToHue(red, green, blue);
  const white = Math.min(red, green, blue);
  const black = 1 - Math.max(red, green, blue);

  if (white + black >= 1 - epsilon) {
    hue = Number.NaN;
  }

  return [hue, white * 100, black * 100];
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

function adaptD65ToD50(value: NumericColor): NumericColor {
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

function adaptD50ToD65(value: NumericColor): NumericColor {
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
  const epsilon = 0.0015;
  const chroma = Math.sqrt(value[1] ** 2 + value[2] ** 2);
  let hue = Math.atan2(value[2], value[1]) * 180 / Math.PI;

  if (hue < 0) {
    hue += 360;
  }

  if (chroma <= epsilon) {
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
  const epsilon = 0.000004;
  const chroma = Math.sqrt(value[1] ** 2 + value[2] ** 2);
  let hue = Math.atan2(value[2], value[1]) * 180 / Math.PI;

  if (hue < 0) {
    hue += 360;
  }

  if (chroma <= epsilon) {
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
