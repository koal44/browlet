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
import type { CalculationContext } from './calc';
import {
  ColorName, colorNameFromText, systemColorNameFromText,
  type SystemColorName,
} from './color-keywords';
import { tryConsumeIdent } from './ident';
import { createKeywordConsumer } from './keyword';
import { tryConsumeNumber, type NumberValue } from './number';
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

export type ColorValue = ColorBase | CurrentColor | SystemColor;

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
