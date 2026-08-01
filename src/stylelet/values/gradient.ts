import { assertNever, mapTuple } from '../../shared/util';
import type { ComponentCursor } from '../parser/component-cursor';
import { createFunctionalNotationConsumer } from '../parser/component-consumers';
import {
  one, oneOf, opt, repeat, requiredSequenceOf, requiredSomeOf, sequenceOf,
  withComponentTrivia,
} from '../parser/component-grammar';
import {
  isBad, ok,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import { ValueStage } from '../value-processing';
import { resolveAngle, serializeAngle, tryConsumeAngle, type AngleValue } from './angle';
import {
  resolveAnglePercentage, serializeAnglePercentage, tryConsumeAnglePercentage,
  type AnglePercentageValue,
} from './angle-percentage';
import {
  ColorKind, interpolateColors, isLegacySrgbColor, resolveColorValue,
  serializeColorInterpolationMethod,
  serializeColorValue, tryConsumeColor, tryConsumeColorInterpolationMethod,
  type AbsoluteColor, type ColorInterpolationMethod, type ColorContext, type ColorValue,
} from './color';
import { createKeywordConsumer } from './keyword';
import {
  createLengthPercentageConsumer, resolveLengthPercentage, serializeLengthPercentage,
  tryConsumeLengthPercentage, type LengthPercentageValue,
} from './length-percentage';
import {
  angleLiteral, canonicalizeAngle,
  type CanonicalAngleLiteral,
} from './numeric-literal/angle';
import { tryResolveAnglePercentage as tryResolveAnglePercentageLiteral } from './numeric-literal/angle-percentage';
import { dimensionLiteral, type DimensionLiteral } from './numeric-literal/dimension';
import { lengthLiteral, type CanonicalLengthLiteral } from './numeric-literal/length';
import { percentageLiteral, type PercentageLiteral } from './numeric-literal/percentage';
import {
  resolvePosition, serializePosition, tryConsumePosition,
  positionLiteral, type PositionContext, type PositionOffsets, type PositionValue,
} from './position';
import { serializeNumber } from './number';
import { tryConsumeZero, type ZeroValue } from './zero';

/*
 * <gradient> =
 *   <linear-gradient()> | <repeating-linear-gradient()> |
 *   <radial-gradient()> | <repeating-radial-gradient()> |
 *   <conic-gradient()> | <repeating-conic-gradient()>
 *
 * <linear-gradient()> = linear-gradient( [ <linear-gradient-syntax> ] )
 * <linear-gradient-syntax> =
 *   [ [ <angle> | <zero> | to <side-or-corner> ] ||
 *     <color-interpolation-method> ]? ,
 *   <color-stop-list>
 * <side-or-corner> = [left | right] || [top | bottom]
 *
 * <radial-gradient()> = radial-gradient( [ <radial-gradient-syntax> ] )
 * <radial-gradient-syntax> =
 *   [ [ [ <radial-shape> || <radial-size> ]? [ at <position> ]? ] ||
 *     <color-interpolation-method> ]? ,
 *   <color-stop-list>
 * <radial-size> =
 *   <radial-extent>{1,2} | <length-percentage [0,infinity]>{1,2}
 * <radial-extent> =
 *   closest-corner | closest-side | farthest-corner | farthest-side
 * <radial-shape> = circle | ellipse
 *
 * <conic-gradient()> = conic-gradient( [ <conic-gradient-syntax> ] )
 * <conic-gradient-syntax> =
 *   [ [ [ from [ <angle> | <zero> ] ]? [ at <position> ]? ] ||
 *     <color-interpolation-method> ]? ,
 *   <angular-color-stop-list>
 *
 * <repeating-linear-gradient()> =
 *   repeating-linear-gradient( [ <linear-gradient-syntax> ] )
 * <repeating-radial-gradient()> =
 *   repeating-radial-gradient( [ <radial-gradient-syntax> ] )
 * <repeating-conic-gradient()> =
 *   repeating-conic-gradient( [ <conic-gradient-syntax> ] )
 *
 * <color-stop-list> =
 *   <linear-color-stop> , [ <linear-color-hint>? , <linear-color-stop> ]#?
 * <linear-color-stop> = <color> <color-stop-length>?
 * <linear-color-hint> = <length-percentage>
 * <color-stop-length> = <length-percentage>{1,2}
 *
 * <angular-color-stop-list> =
 *   <angular-color-stop> , [ <angular-color-hint>? , <angular-color-stop> ]#?
 * <angular-color-stop> = <color> <color-stop-angle>?
 * <angular-color-hint> = <angle-percentage> | <zero>
 * <color-stop-angle> = [ <angle-percentage> | <zero> ]{1,2}
 */

export type GradientValue = LinearGradient | RadialGradient | ConicGradient;

type GradientType = 'linear' | 'radial' | 'conic';

type Gradient<
  Type extends GradientType,
  Offset extends GradientStopOffsetFor<Type>,
> = {
  type: 'gradient';
  gradientType: Type;
  repeating: boolean;
  method: ColorInterpolationMethod;
  stops: GradientStops<Offset>;
};

export type GradientContext = {
  /** Concrete dimensions into which the gradient is drawn, in CSS pixels. */
  gradientBoxSize?: GradientBoxSize;
} & ColorContext & PositionContext;

type GradientBoxSize = {
  width: number;
  height: number;
};

export type LinearGradient = Gradient<'linear', LengthPercentageValue> & {
  direction: LinearGradientDirection;
};

type LinearGradientDirection = AngleValue | ZeroValue | SideOrCorner;

type SideOrCorner =
  | {
    type: 'side-or-corner';
    horizontal: HorizontalSide;
    vertical?: VerticalSide;
  }
  | {
    type: 'side-or-corner';
    horizontal?: never;
    vertical: VerticalSide;
  };

type HorizontalSide = 'left' | 'right';
type VerticalSide = 'top' | 'bottom';

export type RadialGradient = Gradient<'radial', LengthPercentageValue> & {
  shape: RadialShape;
  size: RadialSize;
  position: PositionValue;
};

type RadialShape = 'circle' | 'ellipse';

type RadialSize = RadialExtentSize | RadialRadiiSize;

type RadialExtentSize = {
  type: 'radial-extent';
  extents: [RadialExtent] | [RadialExtent, RadialExtent];
};

type RadialRadiiSize = {
  type: 'radial-radii';
  radii: [LengthPercentageValue] | [LengthPercentageValue, LengthPercentageValue];
};

type RadialExtent =
  | 'closest-corner'
  | 'closest-side'
  | 'farthest-corner'
  | 'farthest-side';

type RadialCenter = [horizontal: number, vertical: number];
type RadialRadii = [horizontal: number, vertical: number];

export type ConicGradient = Gradient<'conic', AngularColorStopOffset> & {
  angle: AngleValue | ZeroValue;
  position: PositionValue;
};

type GradientStops<Offset> = [
  first: GradientColorStop<Offset>,
  ...rest: (GradientColorStop<Offset> | GradientColorHint<Offset>)[],
];

type StopOffsets<Offset> = [Offset] | [Offset, Offset];

type GradientColorStop<Offset> = {
  type: 'color-stop';
  color: ColorValue;
  offsets?: StopOffsets<Offset>;
};

type GradientColorHint<Offset> = {
  type: 'color-hint';
  offset: Offset;
};

type ColorStops = GradientStops<LengthPercentageValue>;
type LinearColorStop = GradientColorStop<LengthPercentageValue>;
type LinearColorHint = GradientColorHint<LengthPercentageValue>;

type AngularColorStopOffset = AnglePercentageValue | ZeroValue;
type GradientStopOffsetFor<Type extends GradientType> =
  Type extends 'conic' ? AngularColorStopOffset : LengthPercentageValue;
type GradientStopOffset = GradientStopOffsetFor<GradientType>;
type ColorStopLength = StopOffsets<LengthPercentageValue>;
type ColorStopAngle = StopOffsets<AngularColorStopOffset>;

type LinearGradientSyntax = Omit<LinearGradient, 'type' | 'gradientType' | 'repeating'>;
type RadialGradientSyntax = Omit<RadialGradient, 'type' | 'gradientType' | 'repeating'>;
type ConicGradientSyntax =  Omit<ConicGradient,  'type' | 'gradientType' | 'repeating'>;

const MAX_COLOR_STOPS = 2_048;

export function parseGradient(
  input: ParserInput,
  context: GradientContext = {},
): GradientValue | null {
  const result = parseAsComponentGrammar(
    input,
    withComponentTrivia(tryConsumeGradient),
    context,
  );

  return result === null || isBad(result) ? null : result.value;
}

export function tryConsumeGradient(
  c: ComponentCursor,
): TryComponentConsumerResult<GradientValue> {
  return consumeGradient(c);
}

// <gradient> = <linear-gradient()> | <repeating-linear-gradient()> | <radial-gradient()> | <repeating-radial-gradient()> | <conic-gradient()> | <repeating-conic-gradient()>
const consumeGradient: TryComponentConsumer<GradientValue> = oneOf(
  [
    one(tryConsumeLinearGradientFn),
    one(tryConsumeRepeatingLinearGradientFn),
    one(tryConsumeRadialGradientFn),
    one(tryConsumeRepeatingRadialGradientFn),
    one(tryConsumeConicGradientFn),
    one(tryConsumeRepeatingConicGradientFn),
  ],
  ([gradient]) => ok(gradient),
);

function tryConsumeLinearGradientFn(
  c: ComponentCursor,
): TryComponentConsumerResult<LinearGradient> {
  return consumeLinearGradientFn(c);
}

// <linear-gradient()> = linear-gradient( [ <linear-gradient-syntax> ] )
const consumeLinearGradientFn = createFunctionalNotationConsumer(
  'linear-gradient',
  tryConsumeLinearGradientSyntax,
  (syntax): LinearGradient => ({
    type: 'gradient',
    gradientType: 'linear',
    repeating: false,
    ...syntax,
  }),
);

function tryConsumeLinearGradientSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<LinearGradientSyntax> {
  return consumeLinearGradientSyntax(c);
}

// <linear-gradient-syntax> = [ [ <angle> | <zero> | to <side-or-corner> ] || <color-interpolation-method> ]? , <color-stop-list>
// Comma-explicit: [ [ [ <angle> | <zero> | to <side-or-corner> ] || <color-interpolation-method> ] ,]? <color-stop-list>
const consumeLinearGradientSyntax: TryComponentConsumer<LinearGradientSyntax> = sequenceOf(
  [
    opt(sequenceOf(
      [
        one(requiredSomeOf(
          [
            one(withComponentTrivia(oneOf(
              [
                one(tryConsumeAngle),
                one(tryConsumeZero),
                one(sequenceOf(
                  [
                    one(createKeywordConsumer('to')),
                    one(withComponentTrivia(tryConsumeSideOrCorner)),
                  ],
                  ([, [sideOrCorner]]) => ok<LinearGradientDirection>(sideOrCorner),
                )),
              ],
              ([direction]) => ok(direction),
            ))),
            one(withComponentTrivia(tryConsumeColorInterpolationMethod)),
          ],
          ([direction, method]) => ok({
            ...(direction === undefined ? {} : { direction: direction[0] }),
            ...(method === undefined ? {} : { method: method[0] }),
          }),
        )),
        one(withComponentTrivia(tryConsumeComma)),
      ],
      ([[prelude]]) => ok(prelude),
    )),
    one(withComponentTrivia(tryConsumeColorStopList)),
  ],
  ([prelude, [stops]]) => {
    const syntax = prelude.length === 0 ? {} : prelude[0];
    return ok({
      direction: syntax.direction ?? defaultLinearGradientDirection(),
      method: syntax.method ?? defaultGradientMethod(stops),
      stops,
    });
  },
);

function tryConsumeSideOrCorner(
  c: ComponentCursor,
): TryComponentConsumerResult<SideOrCorner> {
  return consumeSideOrCorner(c);
}

// <side-or-corner> = [left | right] || [top | bottom]
const consumeSideOrCorner: TryComponentConsumer<SideOrCorner> = requiredSomeOf(
  [
    one(withComponentTrivia(createKeywordConsumer('left', 'right'))),
    one(withComponentTrivia(createKeywordConsumer('top', 'bottom'))),
  ],
  ([horizontal, vertical]) => {
    if (horizontal === undefined) {
      return ok<SideOrCorner>({
        type: 'side-or-corner',
        vertical: vertical![0],
      });
    }

    return ok<SideOrCorner>({
      type: 'side-or-corner',
      horizontal: horizontal[0],
      ...(vertical === undefined ? {} : { vertical: vertical[0] }),
    });
  },
);

function tryConsumeRadialGradientFn(
  c: ComponentCursor,
): TryComponentConsumerResult<RadialGradient> {
  return consumeRadialGradientFn(c);
}

// <radial-gradient()> = radial-gradient( [ <radial-gradient-syntax> ] )
const consumeRadialGradientFn = createFunctionalNotationConsumer(
  'radial-gradient',
  tryConsumeRadialGradientSyntax,
  (syntax): RadialGradient => ({
    type: 'gradient',
    gradientType: 'radial',
    repeating: false,
    ...syntax,
  }),
);

function tryConsumeRadialGradientSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<RadialGradientSyntax> {
  return consumeRadialGradientSyntax(c);
}

// <radial-gradient-syntax> = [ [ [ <radial-shape> || <radial-size> ]? [ at <position> ]? ] || <color-interpolation-method> ]? , <color-stop-list>
// Comma-explicit: [ [ [ [ <radial-shape> || <radial-size> ]? [ at <position> ]? ] || <color-interpolation-method> ] ,]? <color-stop-list>
const consumeRadialGradientSyntax: TryComponentConsumer<RadialGradientSyntax> = sequenceOf(
  [
    opt(sequenceOf(
      [
        one(requiredSomeOf(
          [
            one(withComponentTrivia(requiredSequenceOf(
              [
                opt(requiredSomeOf(
                  [
                    one(withComponentTrivia(tryConsumeRadialShape)),
                    one(withComponentTrivia(tryConsumeRadialSize)),
                  ],
                  ([shape, size]) => {
                    const radialShape = shape?.[0];
                    const radialSize = size?.[0];
                    const sizeArity = radialSize?.type === 'radial-extent'
                      ? radialSize.extents.length
                      : radialSize?.radii.length;

                    if (radialShape === 'circle' && sizeArity === 2) {
                      return null;
                    }

                    return ok({
                      ...(radialShape === undefined ? {} : { shape: radialShape }),
                      ...(radialSize === undefined ? {} : { size: radialSize }),
                    });
                  },
                )),
                opt(sequenceOf(
                  [
                    one(withComponentTrivia(createKeywordConsumer('at'))),
                    one(withComponentTrivia(tryConsumePosition)),
                  ],
                  ([, [position]]) => ok(position),
                )),
              ],
              ([shapeAndSize, position]) => ok({
                ...(shapeAndSize.length === 0 ? {} : shapeAndSize[0]),
                ...(position.length === 0 ? {} : { position: position[0] }),
              }),
            ))),
            one(withComponentTrivia(tryConsumeColorInterpolationMethod)),
          ],
          ([geometry, method]) => ok({
            ...(geometry === undefined ? {} : geometry[0]),
            ...(method === undefined ? {} : { method: method[0] }),
          }),
        )),
        one(withComponentTrivia(tryConsumeComma)),
      ],
      ([[prelude]]) => ok(prelude),
    )),
    one(withComponentTrivia(tryConsumeColorStopList)),
  ],
  ([prelude, [stops]]) => {
    const syntax = prelude.length === 0 ? {} : prelude[0];
    const size = syntax.size ?? defaultRadialGradientSize();
    return ok({
      shape: syntax.shape ?? defaultRadialGradientShape(size),
      size,
      position: syntax.position ?? defaultGradientPosition(),
      method: syntax.method ?? defaultGradientMethod(stops),
      stops,
    });
  },
);

function tryConsumeRadialSize(
  c: ComponentCursor,
): TryComponentConsumerResult<RadialSize> {
  return consumeRadialSize(c);
}

// <radial-size> = <radial-extent>{1,2} | <length-percentage [0,infinity]>{1,2}
const consumeRadialSize: TryComponentConsumer<RadialSize> = oneOf(
  [
    one(sequenceOf(
      [
        one(tryConsumeRadialExtent),
        opt(withComponentTrivia(tryConsumeRadialExtent)),
      ],
      ([[first], second]) => ok<RadialExtentSize>({
        type: 'radial-extent',
        extents: second.length === 0 ? [first] : [first, second[0]],
      }),
    )),
    one(sequenceOf(
      [
        one(createLengthPercentageConsumer({ min: 0 })),
        opt(withComponentTrivia(createLengthPercentageConsumer({ min: 0 }))),
      ],
      ([[first], second]) => ok<RadialRadiiSize>({
        type: 'radial-radii',
        radii: second.length === 0 ? [first] : [first, second[0]],
      }),
    )),
  ],
  ([size]) => ok(size),
);

function tryConsumeRadialExtent(
  c: ComponentCursor,
): TryComponentConsumerResult<RadialExtent> {
  return consumeRadialExtent(c);
}

// <radial-extent> = closest-corner | closest-side | farthest-corner | farthest-side
const consumeRadialExtent = createKeywordConsumer(
  'closest-corner', 'closest-side', 'farthest-corner', 'farthest-side',
);

function tryConsumeRadialShape(
  c: ComponentCursor,
): TryComponentConsumerResult<RadialShape> {
  return consumeRadialShape(c);
}

// <radial-shape> = circle | ellipse
const consumeRadialShape = createKeywordConsumer('circle', 'ellipse');

function tryConsumeConicGradientFn(
  c: ComponentCursor,
): TryComponentConsumerResult<ConicGradient> {
  return consumeConicGradientFn(c);
}

// <conic-gradient()> = conic-gradient( [ <conic-gradient-syntax> ] )
const consumeConicGradientFn = createFunctionalNotationConsumer(
  'conic-gradient',
  tryConsumeConicGradientSyntax,
  (syntax): ConicGradient => ({
    type: 'gradient',
    gradientType: 'conic',
    repeating: false,
    ...syntax,
  }),
);

function tryConsumeConicGradientSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<ConicGradientSyntax> {
  return consumeConicGradientSyntax(c);
}

// <conic-gradient-syntax> = [ [ [ from [ <angle> | <zero> ] ]? [ at <position> ]? ] || <color-interpolation-method> ]? , <angular-color-stop-list>
// Comma-explicit: [ [ [ [ from [ <angle> | <zero> ] ]? [ at <position> ]? ] || <color-interpolation-method> ] ,]? <angular-color-stop-list>
const consumeConicGradientSyntax: TryComponentConsumer<ConicGradientSyntax> = sequenceOf(
  [
    opt(sequenceOf(
      [
        one(requiredSomeOf(
          [
            one(withComponentTrivia(requiredSequenceOf(
              [
                opt(sequenceOf(
                  [
                    one(createKeywordConsumer('from')),
                    one(withComponentTrivia(oneOf(
                      [one(tryConsumeAngle), one(tryConsumeZero)],
                      ([angle]) => ok(angle),
                    ))),
                  ],
                  ([, [angle]]) => ok(angle),
                )),
                opt(sequenceOf(
                  [
                    one(withComponentTrivia(createKeywordConsumer('at'))),
                    one(withComponentTrivia(tryConsumePosition)),
                  ],
                  ([, [position]]) => ok(position),
                )),
              ],
              ([angle, position]) => ok({
                ...(angle.length === 0 ? {} : { angle: angle[0] }),
                ...(position.length === 0 ? {} : { position: position[0] }),
              }),
            ))),
            one(withComponentTrivia(tryConsumeColorInterpolationMethod)),
          ],
          ([geometry, method]) => ok({
            ...(geometry === undefined ? {} : geometry[0]),
            ...(method === undefined ? {} : { method: method[0] }),
          }),
        )),
        one(withComponentTrivia(tryConsumeComma)),
      ],
      ([[prelude]]) => ok(prelude),
    )),
    one(withComponentTrivia(tryConsumeAngularColorStopList)),
  ],
  ([prelude, [stops]]) => {
    const syntax = prelude.length === 0 ? {} : prelude[0];
    return ok({
      angle: syntax.angle ?? defaultConicGradientAngle(),
      position: syntax.position ?? defaultGradientPosition(),
      method: syntax.method ?? defaultGradientMethod(stops),
      stops,
    });
  },
);

function tryConsumeRepeatingLinearGradientFn(
  c: ComponentCursor,
): TryComponentConsumerResult<LinearGradient> {
  return consumeRepeatingLinearGradientFn(c);
}

// <repeating-linear-gradient()> = repeating-linear-gradient( [ <linear-gradient-syntax> ] )
const consumeRepeatingLinearGradientFn = createFunctionalNotationConsumer(
  'repeating-linear-gradient',
  tryConsumeLinearGradientSyntax,
  (syntax): LinearGradient => ({
    type: 'gradient',
    gradientType: 'linear',
    repeating: true,
    ...syntax,
  }),
);

function tryConsumeRepeatingRadialGradientFn(
  c: ComponentCursor,
): TryComponentConsumerResult<RadialGradient> {
  return consumeRepeatingRadialGradientFn(c);
}

// <repeating-radial-gradient()> = repeating-radial-gradient( [ <radial-gradient-syntax> ] )
const consumeRepeatingRadialGradientFn = createFunctionalNotationConsumer(
  'repeating-radial-gradient',
  tryConsumeRadialGradientSyntax,
  (syntax): RadialGradient => ({
    type: 'gradient',
    gradientType: 'radial',
    repeating: true,
    ...syntax,
  }),
);

function tryConsumeRepeatingConicGradientFn(
  c: ComponentCursor,
): TryComponentConsumerResult<ConicGradient> {
  return consumeRepeatingConicGradientFn(c);
}

// <repeating-conic-gradient()> = repeating-conic-gradient( [ <conic-gradient-syntax> ] )
const consumeRepeatingConicGradientFn = createFunctionalNotationConsumer(
  'repeating-conic-gradient',
  tryConsumeConicGradientSyntax,
  (syntax): ConicGradient => ({
    type: 'gradient',
    gradientType: 'conic',
    repeating: true,
    ...syntax,
  }),
);

function tryConsumeColorStopList(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorStops> {
  return consumeColorStopList(c);
}

// <color-stop-list> = <linear-color-stop> , [ <linear-color-hint>? , <linear-color-stop> ]#?
// Comma-explicit: <linear-color-stop> [ , [ <linear-color-hint> ,]? <linear-color-stop> ]*
const consumeColorStopList: TryComponentConsumer<ColorStops> =
  createGradientStopListConsumer(tryConsumeLinearColorStop, tryConsumeLinearColorHint);

function tryConsumeLinearColorStop(
  c: ComponentCursor,
): TryComponentConsumerResult<LinearColorStop> {
  return consumeLinearColorStop(c);
}

// <linear-color-stop> = <color> <color-stop-length>?
const consumeLinearColorStop: TryComponentConsumer<LinearColorStop> = sequenceOf(
  [
    one(tryConsumeColor),
    opt(withComponentTrivia(tryConsumeColorStopLength)),
  ],
  ([[color], offsets]) => ok({
    type: 'color-stop',
    color,
    ...(offsets.length === 0 ? {} : { offsets: offsets[0] }),
  }),
);

function tryConsumeLinearColorHint(
  c: ComponentCursor,
): TryComponentConsumerResult<LinearColorHint> {
  return consumeLinearColorHint(c);
}

// <linear-color-hint> = <length-percentage>
const consumeLinearColorHint: TryComponentConsumer<LinearColorHint> = sequenceOf(
  [one(tryConsumeLengthPercentage)],
  ([[offset]]) => ok({ type: 'color-hint', offset }),
);

function tryConsumeColorStopLength(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorStopLength> {
  return consumeColorStopLength(c);
}

// <color-stop-length> = <length-percentage>{1,2}
const consumeColorStopLength: TryComponentConsumer<ColorStopLength> =
  sequenceOf(
    [
      one(tryConsumeLengthPercentage),
      opt(withComponentTrivia(tryConsumeLengthPercentage)),
    ],
    ([[first], second]) => ok(
      second.length === 0 ? [first] : [first, second[0]],
    ),
  );

function tryConsumeAngularColorStopList(
  c: ComponentCursor,
): TryComponentConsumerResult<GradientStops<AngularColorStopOffset>> {
  return consumeAngularColorStopList(c);
}

// <angular-color-stop-list> = <angular-color-stop> , [ <angular-color-hint>? , <angular-color-stop> ]#?
// Comma-explicit: <angular-color-stop> [ , [ <angular-color-hint> ,]? <angular-color-stop> ]*
const consumeAngularColorStopList: TryComponentConsumer<GradientStops<AngularColorStopOffset>> =
  createGradientStopListConsumer(tryConsumeAngularColorStop, tryConsumeAngularColorHint);

function tryConsumeAngularColorStop(
  c: ComponentCursor,
): TryComponentConsumerResult<GradientColorStop<AngularColorStopOffset>> {
  return consumeAngularColorStop(c);
}

// <angular-color-stop> = <color> <color-stop-angle>?
const consumeAngularColorStop: TryComponentConsumer<GradientColorStop<AngularColorStopOffset>> = sequenceOf(
  [
    one(tryConsumeColor),
    opt(withComponentTrivia(tryConsumeColorStopAngle)),
  ],
  ([[color], offsets]) => ok({
    type: 'color-stop',
    color,
    ...(offsets.length === 0 ? {} : { offsets: offsets[0] }),
  }),
);

function tryConsumeAngularColorHint(
  c: ComponentCursor,
): TryComponentConsumerResult<GradientColorHint<AngularColorStopOffset>> {
  return consumeAngularColorHint(c);
}

// <angular-color-hint> = <angle-percentage> | <zero>
const consumeAngularColorHint: TryComponentConsumer<GradientColorHint<AngularColorStopOffset>> = sequenceOf(
  [one(oneOf(
    [one(tryConsumeAnglePercentage), one(tryConsumeZero)],
    ([offset]) => ok(offset),
  ))],
  ([[offset]]) => ok({ type: 'color-hint', offset }),
);

function tryConsumeColorStopAngle(
  c: ComponentCursor,
): TryComponentConsumerResult<ColorStopAngle> {
  return consumeColorStopAngle(c);
}

// <color-stop-angle> = [ <angle-percentage> | <zero> ]{1,2}
const consumeColorStopAngle: TryComponentConsumer<ColorStopAngle> =
  sequenceOf(
    [
      one(oneOf(
        [one(tryConsumeAnglePercentage), one(tryConsumeZero)],
        ([offset]) => ok(offset),
      )),
      opt(withComponentTrivia(oneOf(
        [one(tryConsumeAnglePercentage), one(tryConsumeZero)],
        ([offset]) => ok(offset),
      ))),
    ],
    ([[first], second]) => ok(
      second.length === 0 ? [first] : [first, second[0]],
    ),
  );

function createGradientStopListConsumer<Offset>(
  tryConsumeStop: TryComponentConsumer<GradientColorStop<Offset>>,
  tryConsumeHint: TryComponentConsumer<GradientColorHint<Offset>>,
): TryComponentConsumer<GradientStops<Offset>> {
  return sequenceOf(
    [
      one(tryConsumeStop),
      repeat(
        sequenceOf(
          [
            one(withComponentTrivia(tryConsumeComma)),
            opt(sequenceOf(
              [
                one(withComponentTrivia(tryConsumeHint)),
                one(withComponentTrivia(tryConsumeComma)),
              ],
              ([[hint]]) => ok(hint),
            )),
            one(withComponentTrivia(tryConsumeStop)),
          ],
          ([, hint, [stop]]) => ok([
            ...(hint.length === 0 ? [] : [hint[0]]),
            stop,
          ]),
        ),
        0,
        MAX_COLOR_STOPS - 1,
      ),
    ],
    ([[first], tails]) => {
      const stops: GradientStops<Offset> = [first];

      for (const tail of tails) {
        stops.push(...tail);
      }

      return ok(stops);
    },
  );
}

function tryConsumeComma(
  c: ComponentCursor,
): TryComponentConsumerResult<','> {
  return c.match(TokenKind.Comma) ? ok(',') : null;
}



// ██████   ███████ ███████  █████  ██    ██ ██      ████████
// ██   ██  ██      ██      ██   ██ ██    ██ ██         ██
// ██    ██ ██      ██      ██   ██ ██    ██ ██         ██
// ██    ██ █████   █████   ███████ ██    ██ ██         ██
// ██    ██ ██      ██      ██   ██ ██    ██ ██         ██
// ██   ██  ██      ██      ██   ██ ██    ██ ██         ██
// ██████   ███████ ██      ██   ██  ██████  ███████    ██

function defaultGradientStopOffset(
  value: 0 | 100,
): PercentageLiteral {
  return percentageLiteral(value);
}

function defaultLinearGradientDirection(): LinearGradientDirection {
  return angleLiteral(180);
}

function defaultRadialGradientShape(size: RadialSize): RadialShape {
  return size.type === 'radial-radii'
    && size.radii.length === 1
    && size.radii[0].type === 'length'
    ? 'circle'
    : 'ellipse';
}

function defaultRadialGradientSize(): RadialSize {
  return { type: 'radial-extent', extents: ['farthest-corner'] };
}

function defaultConicGradientAngle(): AngleValue {
  return angleLiteral(0);
}

function defaultGradientPosition(): PositionValue {
  return positionLiteral('center');
}

function defaultGradientMethod<Offset>(
  stops: GradientStops<Offset>,
): ColorInterpolationMethod {
  const colors = stops.flatMap((stop) =>
    stop.type === 'color-stop' ? [stop.color] : []);

  return {
    space: colors.every(isLegacySrgbColor) ? 'srgb' : 'oklab',
  };
}

function isDefaultLinearGradientDirection(
  value: LinearGradientDirection,
): boolean {
  return value.type === 'angle'
    ? canonicalizeAngle(value).value === 180
    : value.type === 'side-or-corner'
      && value.horizontal === undefined
      && value.vertical === 'bottom';
}

function isDefaultRadialGradientShape(
  shape: RadialShape,
  size: RadialSize,
): boolean {
  return shape === defaultRadialGradientShape(size);
}

function isDefaultRadialGradientSize(size: RadialSize): boolean {
  return size.type === 'radial-extent'
    && size.extents.length === 1
    && size.extents[0] === 'farthest-corner';
}

function isZeroAngle(value: AngleValue | ZeroValue): boolean {
  return value.type === 'number'
    || value.type === 'angle' && value.value === 0;
}

function isCenterPosition(value: PositionValue): boolean {
  const components = value.offsets ?? value.components;

  return components.length <= 2
    && components.every((component) => component === 'center'
      || typeof component !== 'string'
        && component.type === 'percentage'
        && component.value === 50);
}

function isDefaultGradientMethod<Offset>(
  method: ColorInterpolationMethod,
  stops: GradientStops<Offset>,
): boolean {
  if (method.hue !== undefined && method.hue !== 'shorter') {
    return false;
  }

  return method.space === defaultGradientMethod(stops).space;
}

function isZeroGradientStopOffset(value: GradientStopOffset): boolean {
  return value.type !== 'math' && value.value === 0;
}

function isFullGradientStopOffset(value: GradientStopOffset): boolean {
  return value.type === 'percentage' && value.value === 100;
}

function isSideExtent(extent: RadialExtent): extent is 'closest-side' | 'farthest-side' {
  return extent === 'closest-side' || extent === 'farthest-side';
}



// ████████  ████████  ██████   ███████  ██       ██     ██ ████████
// ██     ██ ██       ██    ██ ██     ██ ██       ██     ██ ██
// ██     ██ ██       ██       ██     ██ ██       ██     ██ ██
// ████████  ██████    ██████  ██     ██ ██       ██     ██ ██████
// ██   ██   ██             ██ ██     ██ ██        ██   ██  ██
// ██    ██  ██       ██    ██ ██     ██ ██         ██ ██   ██
// ██     ██ ████████  ██████   ███████  ████████    ███    ████████

export function resolveGradient(
  value: GradientValue,
  stage: ValueStage,
  context: GradientContext = {},
): GradientValue {
  switch (value.gradientType) {
    case 'linear':
      return resolveLinearGradient(value, stage, context);
    case 'radial':
      return resolveRadialGradient(value, stage, context);
    case 'conic':
      return resolveConicGradient(value, stage, context);
    default:
      return assertNever(value);
  }
}

function resolveLinearGradient(
  value: LinearGradient,
  stage: ValueStage,
  context: GradientContext,
): LinearGradient {
  const direction = resolveLinearGradientDirection(value.direction, stage, context);
  const lineLength = linearGradientLineLength(direction, context.gradientBoxSize);
  const percentageReferenceValue = resolvePercentageReference(lineLength, 'px', stage);
  const resolved = { ...value, direction };
  const stops = resolveGradientStops(
    resolved,
    stage,
    { ...context, percentageReferenceValue },
  );

  return {
    ...resolved,
    stops,
  };
}

function resolveLinearGradientDirection(
  value: LinearGradientDirection,
  stage: ValueStage,
  context: GradientContext,
): LinearGradientDirection {
  return value.type === 'angle' || value.type === 'math'
    ? resolveAngle(value, stage, context)
    : value;
}

function resolvePercentageReference<Unit extends string>(
  value: number | undefined,
  unit: Unit,
  stage: ValueStage,
): DimensionLiteral<'dimension', Unit> | undefined {
  return stage < ValueStage.Used || value === undefined
    ? undefined
    : dimensionLiteral('dimension', value, unit);
}

function linearGradientLineLength(
  direction: LinearGradientDirection,
  boxSize: GradientBoxSize | undefined,
): number | undefined {
  if (boxSize === undefined) {
    return undefined;
  }

  const { width, height } = boxSize;
  const angle = linearGradientAngle(direction, boxSize);

  if (angle === undefined) {
    return undefined;
  }

  if (angle % 180 === 0) {
    return height;
  }

  if ((angle - 90) % 180 === 0) {
    return width;
  }

  const radians = angle * Math.PI / 180;

  return Math.abs(width * Math.sin(radians))
    + Math.abs(height * Math.cos(radians));
}

function linearGradientAngle(
  direction: LinearGradientDirection,
  boxSize: GradientBoxSize | undefined,
): number | undefined {
  let angle: number;

  if (direction.type === 'math') {
    return undefined;
  } else if (direction.type === 'number') {
    angle = 0;
  } else if (direction.type === 'angle') {
    angle = canonicalizeAngle(direction).value;
  } else if (direction.horizontal === undefined) {
    angle = direction.vertical === 'top' ? 0 : 180;
  } else if (direction.vertical === undefined) {
    angle = direction.horizontal === 'right' ? 90 : 270;
  } else {
    if (boxSize === undefined) {
      return undefined;
    }

    const { width, height } = boxSize;
    const cornerAngle = Math.atan2(height, width) * 180 / Math.PI;

    if (direction.vertical === 'top') {
      angle = direction.horizontal === 'right'
        ? cornerAngle
        : 360 - cornerAngle;
    } else {
      angle = direction.horizontal === 'right'
        ? 180 - cornerAngle
        : 180 + cornerAngle;
    }
  }

  return angle;
}

function resolveRadialGradient(
  value: RadialGradient,
  stage: ValueStage,
  context: GradientContext,
): RadialGradient {
  const geometryContext = { ...context, percentageReferenceValue: undefined };
  const size = resolveRadialGradientSize(value.size, stage, geometryContext);
  const position = resolvePosition(value.position, stage, geometryContext);
  const resolved = { ...value, size, position };
  const lineLength = radialGradientLineLength(resolved, stage, geometryContext);
  const percentageReferenceValue = resolvePercentageReference(lineLength, 'px', stage);
  const stops = resolveGradientStops(resolved, stage, { ...context, percentageReferenceValue });

  return {
    ...resolved,
    stops,
  };
}

function radialGradientLineLength(
  gradient: RadialGradient,
  stage: ValueStage,
  context: GradientContext,
): number | undefined {
  return radialGradientGeometry(gradient, stage, context)?.radii[0];
}

function radialGradientGeometry(
  gradient: RadialGradient,
  stage: ValueStage,
  context: GradientContext,
): { center: RadialCenter; radii: RadialRadii; } | undefined {
  const boxSize = context.gradientBoxSize;

  if (stage < ValueStage.Used || boxSize === undefined) {
    return undefined;
  }

  const center = radialGradientCenter(gradient.position, boxSize, stage, context);

  if (center === undefined) {
    return undefined;
  }

  const radii = gradient.size.type === 'radial-radii'
    ? resolveRadialRadii(gradient.shape, gradient.size.radii, boxSize, stage, context)
    : extentRadialGradientRadii(gradient.shape, gradient.size.extents, center, boxSize);

  // Degenerate radial gradients use arbitrary radii and have no unique length.
  return radii === undefined
    || radii.some((radius) => !Number.isFinite(radius) || radius <= 0)
    ? undefined
    : { center, radii };
}

function radialGradientCenter(
  position: PositionValue,
  boxSize: GradientBoxSize,
  stage: ValueStage,
  context: GradientContext,
): RadialCenter | undefined {
  if (position.offsets === undefined) {
    return undefined;
  }

  const horizontal = resolveLengthPercentageInPixels(position.offsets[0], boxSize.width, stage, context);
  const vertical = resolveLengthPercentageInPixels(position.offsets[1], boxSize.height, stage, context);

  return horizontal === undefined || vertical === undefined
    ? undefined
    : [horizontal, vertical];
}

function resolveRadialRadii(
  shape: RadialShape,
  radii: RadialRadiiSize['radii'],
  boxSize: GradientBoxSize,
  stage: ValueStage,
  context: GradientContext,
): RadialRadii | undefined {
  if (shape === 'ellipse' && radii.length === 1) {
    // Images 4 accepts this syntax without defining the missing vertical radius.
    return undefined;
  }

  const horizontalBasis = shape === 'circle'
    ? Math.hypot(boxSize.width, boxSize.height) / Math.SQRT2
    : boxSize.width;
  const horizontal = resolveLengthPercentageInPixels(radii[0], horizontalBasis, stage, context);
  const vertical = shape === 'circle'
    ? horizontal
    : resolveLengthPercentageInPixels(radii[1]!, boxSize.height, stage, context);

  return horizontal === undefined || vertical === undefined
    ? undefined
    : [horizontal, vertical];
}

function extentRadialGradientRadii(
  shape: RadialShape,
  extents: RadialExtentSize['extents'],
  center: RadialCenter,
  boxSize: GradientBoxSize,
): RadialRadii | undefined {
  const [horizontalExtent, verticalExtent = horizontalExtent] = extents;
  const horizontalDistances: [number, number] = [
    Math.abs(center[0]),
    Math.abs(boxSize.width - center[0]),
  ];
  const verticalDistances: [number, number] = [
    Math.abs(center[1]),
    Math.abs(boxSize.height - center[1]),
  ];

  if (extents.length === 2) {
    // Corner extents describe a whole shape, not one independent axis.
    return shape === 'ellipse'
      && isSideExtent(horizontalExtent)
      && isSideExtent(verticalExtent)
      ? [
        extentSideDistance(horizontalExtent, horizontalDistances),
        extentSideDistance(verticalExtent, verticalDistances),
      ]
      : undefined;
  }

  if (isSideExtent(horizontalExtent)) {
    if (shape === 'ellipse') {
      return [
        extentSideDistance(horizontalExtent, horizontalDistances),
        extentSideDistance(horizontalExtent, verticalDistances),
      ];
    }

    const distances = [...horizontalDistances, ...verticalDistances];
    const radius = horizontalExtent === 'closest-side'
      ? Math.min(...distances)
      : Math.max(...distances);

    return [radius, radius];
  }

  const closest = horizontalExtent === 'closest-corner';
  const sideExtent = closest ? 'closest-side' : 'farthest-side';
  const sideRadii: RadialRadii = [
    extentSideDistance(sideExtent, horizontalDistances),
    extentSideDistance(sideExtent, verticalDistances),
  ];

  if (shape === 'circle') {
    const radius = Math.hypot(...sideRadii);

    return [radius, radius];
  }

  if (sideRadii[0] === 0 || sideRadii[1] === 0) {
    return undefined;
  }

  return mapTuple(sideRadii, (radius) => radius * Math.SQRT2);
}

function extentSideDistance(
  extent: 'closest-side' | 'farthest-side',
  distances: [number, number],
): number {
  return extent === 'closest-side'
    ? Math.min(...distances)
    : Math.max(...distances);
}

function resolveLengthPercentageInPixels(
  value: LengthPercentageValue,
  percentageBasis: number,
  stage: ValueStage,
  context: GradientContext,
): number | undefined {
  const resolved = resolveLengthPercentage(value, stage, {
    ...context,
    percentageReferenceValue: dimensionLiteral('dimension', percentageBasis, 'px'),
  });

  return resolved.type === 'length' && resolved.unit === 'px'
    ? resolved.value
    : undefined;
}

function resolveRadialGradientSize(
  value: RadialSize,
  stage: ValueStage,
  context: GradientContext,
): RadialSize {
  return value.type === 'radial-radii'
    ? {
      ...value,
      radii: mapTuple(value.radii, (radius) =>
        resolveLengthPercentage(radius, stage, context)),
    }
    : value;
}

function resolveConicGradient(
  value: ConicGradient,
  stage: ValueStage,
  context: GradientContext,
): ConicGradient {
  const percentageReferenceValue = resolvePercentageReference(360, 'deg', stage);
  const angle = resolveAngleOrZero(value.angle, stage, context);
  const position = resolvePosition(value.position, stage, context);
  const resolved = { ...value, angle, position };
  const stops = resolveGradientStops(
    resolved,
    stage,
    { ...context, percentageReferenceValue },
  );

  return {
    ...resolved,
    stops,
  };
}

function resolveGradientStops<
  Type extends GradientType,
  Offset extends GradientStopOffsetFor<Type>,
>(
  gradient: Gradient<Type, Offset>,
  stage: ValueStage,
  context: GradientContext,
): GradientStops<Offset> {
  const { stops } = gradient;
  const resolved = mapTuple(stops, (stop) => {
    if (stop.type === 'color-hint') {
      return {
        ...stop,
        offset: resolveStopOffset(stop.offset, gradient, stage, context),
      };
    }

    return {
      ...stop,
      color: resolveColorValue(stop.color, stage, context),
      offsets: stop.offsets === undefined
        ? undefined
        : mapTuple(stop.offsets, (offset) =>
          resolveStopOffset(offset, gradient, stage, context)),
    };
  }) as GradientStops<Offset>;

  return colorStopFixup(resolved, gradient, stage, context);
}

function resolveStopOffset<
  Type extends GradientType,
  Offset extends GradientStopOffsetFor<Type>,
>(
  offset: Offset,
  gradient: Gradient<Type, Offset>,
  stage: ValueStage,
  context: GradientContext,
): Offset {
  return (gradient.gradientType === 'conic'
    ? resolveAngularColorStopOffset(
      offset as AngularColorStopOffset,
      stage,
      context,
    )
    : resolveLengthPercentage(
      offset as LengthPercentageValue,
      stage,
      context,
    )) as Offset;
}

function resolveAngularColorStopOffset(
  value: AngularColorStopOffset,
  stage: ValueStage,
  context: GradientContext,
): AngularColorStopOffset {
  if (value.type === 'number') {
    return stage < ValueStage.Used ? value : angleLiteral(0);
  }

  if (stage >= ValueStage.Used && value.type !== 'math') {
    return tryResolveAnglePercentageLiteral(value, { percentageBasis: 360 })!;
  }

  return resolveAnglePercentage(value, stage, context);
}

function resolveAngleOrZero(
  value: AngleValue | ZeroValue,
  stage: ValueStage,
  context: GradientContext,
): AngleValue | ZeroValue {
  return value.type === 'number' ? value : resolveAngle(value, stage, context);
}



// ████████ ████ ██     ██ ██     ██ ████████
// ██        ██   ██   ██  ██     ██ ██     ██
// ██        ██    ██ ██   ██     ██ ██     ██
// ██████    ██     ███    ██     ██ ████████
// ██        ██    ██ ██   ██     ██ ██
// ██        ██   ██   ██  ██     ██ ██
// ██       ████ ██     ██  ███████  ██

function hasComparableGradientStopOffsets(
  stops: GradientStops<GradientStopOffset>,
  gradientType: GradientType,
): boolean {
  let kind: ExplicitGradientStopOffset['type'] | undefined;

  for (const stop of stops) {
    const offsets = stop.type === 'color-hint'
      ? [stop.offset]
      : stop.offsets ?? [];

    for (const offset of offsets) {
      if (!isComparableGradientStopOffset(offset, gradientType)) {
        return false;
      }

      if (kind !== undefined && kind !== offset.type) {
        return false;
      }

      kind = offset.type;
    }
  }

  return true;
}

function isComparableGradientStopOffset(
  offset: GradientStopOffset,
  gradientType: GradientType,
): offset is ExplicitGradientStopOffset {
  return offset.type === 'percentage'
    || (gradientType === 'conic'
      ? offset.type === 'angle' && offset.unit === 'deg'
      : offset.type === 'length' && offset.unit === 'px');
}

function colorStopFixup<
  Type extends GradientType,
  Offset extends GradientStopOffsetFor<Type>,
>(
  stops: GradientStops<Offset>,
  gradient: Gradient<Type, Offset>,
  stage: ValueStage,
  context: GradientContext,
): GradientStops<Offset> {
  if (stage < ValueStage.Used) {
    return stops;
  }

  // 1. If the first color stop has no offset, set it to 0%.
  stops[0].offsets ??= [
    gradient.gradientType === 'conic' ? angleLiteral(0) : lengthLiteral(0),
  ] as StopOffsets<Offset>;

  // 2. If the last color stop has no offset, set it to 100%.
  const last = stops.at(-1)!;

  if (last.type === 'color-stop' && last.offsets === undefined) {
    const percentageReference = context.percentageReferenceValue;
    const offset = percentageReference === undefined
      ? defaultGradientStopOffset(100)
      : gradient.gradientType === 'conic'
        ? angleLiteral(percentageReference.value)
        : lengthLiteral(percentageReference.value);

    last.offsets = [offset as Offset];
  }

  if (!hasComparableGradientStopOffsets(stops, gradient.gradientType)) {
    return stops;
  }

  type ExplicitItem =
    | GradientColorStop<ExplicitGradientStopOffset>
    | GradientColorHint<ExplicitGradientStopOffset>;
  const explicit = stops as GradientStops<ExplicitGradientStopOffset>;

  const offsetOf = (item: ExplicitItem): ExplicitGradientStopOffset | undefined =>
    item.type === 'color-hint' ? item.offset : item.offsets?.[0];
  const withOffset = (
    item: ExplicitItem,
    offset: ExplicitGradientStopOffset,
  ): ExplicitItem =>
    item.type === 'color-hint'
      ? { ...item, offset }
      : { ...item, offsets: [offset] };
  const interpolateOffset = (
    a: ExplicitGradientStopOffset,
    b: ExplicitGradientStopOffset,
    p: number,
  ): ExplicitGradientStopOffset => ({
    ...a,
    value: (1 - p) * a.value + p * b.value,
  });
  const fixed: ExplicitItem[] = [];

  for (const stop of explicit) {
    if (stop.type === 'color-stop' && stop.offsets?.length === 2) {
      fixed.push(
        { ...stop, offsets: [stop.offsets[0]] },
        { ...stop, offsets: [stop.offsets[1]] },
      );
    } else {
      fixed.push(stop);
    }
  }

  // 3. Move every positioned item at least as far as all preceding items.
  let largest: ExplicitGradientStopOffset | undefined;

  for (let index = 0; index < fixed.length; index += 1) {
    const item = fixed[index]!;
    const offset = offsetOf(item);

    if (offset === undefined) {
      continue;
    }

    if (largest === undefined) {
      largest = offset;
      continue;
    }

    if (offset.value < largest.value) {
      fixed[index] = withOffset(item, largest);
    } else {
      largest = offset;
    }
  }

  // 4. Evenly distribute each run of color stops without offsets.
  let index = 1;

  while (index < fixed.length - 1) {
    if (offsetOf(fixed[index]!) !== undefined) {
      index += 1;
      continue;
    }

    const start = index;

    while (offsetOf(fixed[index]!) === undefined) {
      index += 1;
    }

    const before = offsetOf(fixed[start - 1]!)!;
    const after = offsetOf(fixed[index]!)!;
    const count = index - start;

    for (let offset = 0; offset < count; offset += 1) {
      fixed[start + offset] = withOffset(
        fixed[start + offset]!,
        interpolateOffset(
          before,
          after,
          (offset + 1) / (count + 1),
        ),
      );
    }
  }

  return fixed as GradientStops<Offset>;
}



// ███████ ██     ██ ████████  ██       ████  ██████  ████ ████████
// ██       ██   ██  ██     ██ ██        ██  ██        ██     ██
// ██        ██ ██   ██     ██ ██        ██  ██        ██     ██
// █████      ███    ████████  ██        ██  ██        ██     ██
// ██        ██ ██   ██        ██        ██  ██        ██     ██
// ██       ██   ██  ██        ██        ██  ██        ██     ██
// ███████ ██     ██ ██        ████████ ████  ██████  ████   ██

/**
 * An interpolation-ready extension of CSS Images 4's explicit gradient form,
 * which names only canonical linear direction and radial size. This stronger
 * form also has resolved positions and colors, with all geometry and offsets.
 */
export type ExplicitGradient =
  | ExplicitLinearGradient
  | ExplicitRadialGradient
  | ExplicitConicGradient;

type ExplicitLinearGradient = Omit<LinearGradient, 'direction' | 'stops'> & {
  direction: CanonicalAngleLiteral;
  lineLength: CanonicalLengthLiteral;
  stops: ExplicitGradientStops<ExplicitLengthPercentageLiteral>;
};

type ExplicitRadialGradient = Omit<
  RadialGradient,
  'shape' | 'size' | 'position' | 'stops'
> & {
  shape: 'ellipse';
  size: ExplicitRadialSize;
  position: ExplicitGradientPosition;
  stops: ExplicitGradientStops<ExplicitLengthPercentageLiteral>;
};

type ExplicitConicGradient = Omit<ConicGradient, 'angle' | 'position' | 'stops'> & {
  angle: CanonicalAngleLiteral;
  position: ExplicitGradientPosition;
  stops: ExplicitGradientStops<ExplicitAnglePercentageLiteral>;
};

type ExplicitRadialSize = {
  type: 'radial-radii';
  radii: [
    horizontal: ExplicitLengthPercentageLiteral,
    vertical: ExplicitLengthPercentageLiteral,
  ];
};

type ExplicitGradientPosition = Omit<PositionOffsets, 'offsets'> & {
  offsets: [
    horizontal: ExplicitLengthPercentageLiteral,
    vertical: ExplicitLengthPercentageLiteral,
  ];
};

type ExplicitGradientStops<Offset extends ExplicitGradientStopOffset> = [
  first: ExplicitGradientColorStop<Offset>,
  ...rest: (
    | ExplicitGradientColorStop<Offset>
    | GradientColorHint<Offset>
  )[],
];

type ExplicitGradientColorStop<Offset extends ExplicitGradientStopOffset> =
  Omit<GradientColorStop<Offset>, 'color' | 'offsets'> & {
    color: AbsoluteColor;
    offsets: [Offset];
  };

type ExplicitLengthPercentageLiteral = CanonicalLengthLiteral | PercentageLiteral;
type ExplicitAnglePercentageLiteral = CanonicalAngleLiteral | PercentageLiteral;
type ExplicitGradientStopOffset =
  | ExplicitLengthPercentageLiteral
  | ExplicitAnglePercentageLiteral;

export function tryResolveExplicitGradient(
  value: GradientValue,
  stage: ValueStage,
  context: GradientContext = {},
): ExplicitGradient | null {
  if (stage < ValueStage.Used) {
    return null;
  }

  const resolved = resolveGradient(value, ValueStage.Computed, context);
  const boxSize = context.gradientBoxSize;
  const stops = tryResolveExplicitGradientStops(resolved, value, stage, context);

  if (stops === null) {
    return null;
  }

  switch (resolved.gradientType) {
    case 'linear': {
      const direction = resolveLinearGradientDirection(
        resolved.direction,
        stage,
        context,
      );
      const angle = linearGradientAngle(direction, boxSize);
      const lineLength = linearGradientLineLength(direction, boxSize);

      return angle === undefined || lineLength === undefined
        ? null
        : {
          ...resolved,
          direction: angleLiteral(angle),
          lineLength: lengthLiteral(lineLength),
          stops,
        } as ExplicitLinearGradient;
    }
    case 'radial': {
      const size = resolved.shape === 'ellipse'
        && resolved.size.type === 'radial-radii'
        && resolved.size.radii.length === 2
        && resolved.size.radii.every(isExplicitLengthPercentage)
        ? resolved.size as ExplicitRadialSize
        : null;
      const position = isExplicitGradientPosition(resolved.position)
        ? resolved.position
        : null;
      const geometry = size === null || position === null
        ? radialGradientGeometry(resolved, stage, context)
        : undefined;

      if ((size === null || position === null) && geometry === undefined) {
        return null;
      }

      return {
        ...resolved,
        shape: 'ellipse',
        size: size ?? {
          type: 'radial-radii',
          radii: mapTuple(geometry!.radii, (radius) => lengthLiteral(radius)),
        },
        position: position ?? explicitGradientPosition(geometry!.center),
        stops,
      } as ExplicitRadialGradient;
    }
    case 'conic': {
      const center = boxSize === undefined
        ? undefined
        : radialGradientCenter(resolved.position, boxSize, stage, context);
      const position = isExplicitGradientPosition(resolved.position)
        ? resolved.position
        : center === undefined
          ? null
          : explicitGradientPosition(center);
      const resolvedAngle = resolveAngleOrZero(resolved.angle, stage, context);
      const angle = resolvedAngle.type === 'number'
        ? angleLiteral(0)
        : resolvedAngle.type === 'angle'
          ? canonicalizeAngle(resolvedAngle)
          : null;

      return position === null || angle === null
        ? null
        : {
          ...resolved,
          angle,
          position,
          stops,
        } as ExplicitConicGradient;
    }
    default:
      return assertNever(resolved);
  }
}

function tryResolveExplicitGradientStops(
  computed: GradientValue,
  original: GradientValue,
  stage: ValueStage,
  context: GradientContext,
): GradientStops<ExplicitGradientStopOffset> | null {
  const stops = computed.stops as GradientStops<GradientStopOffset>;

  stops[0].offsets ??= [defaultGradientStopOffset(0)];

  const fixed = colorStopFixup(
    stops,
    computed as Gradient<GradientType, GradientStopOffset>,
    ValueStage.Used,
    {},
  );

  if (hasExplicitGradientStops(fixed, computed.gradientType)) {
    return fixed as GradientStops<ExplicitGradientStopOffset>;
  }

  const used = resolveGradient(original, stage, context);

  return hasExplicitGradientStops(used.stops, used.gradientType)
    ? used.stops as GradientStops<ExplicitGradientStopOffset>
    : null;
}

export function isExplicitGradient(
  value: GradientValue,
): value is ExplicitGradient {
  if (!hasExplicitGradientStops(value.stops, value.gradientType)) {
    return false;
  }

  switch (value.gradientType) {
    case 'linear':
      return isCanonicalAngle(value.direction)
        && 'lineLength' in value
        && isCanonicalLength(value.lineLength);
    case 'radial':
      return value.shape === 'ellipse'
        && value.size.type === 'radial-radii'
        && value.size.radii.length === 2
        && value.size.radii.every(isExplicitLengthPercentage)
        && isExplicitGradientPosition(value.position);
    case 'conic':
      return isCanonicalAngle(value.angle)
        && isExplicitGradientPosition(value.position);
    default:
      return assertNever(value);
  }
}

function hasExplicitGradientStops(
  stops: GradientStops<GradientStopOffset>,
  gradientType: GradientType,
): boolean {
  return hasComparableGradientStopOffsets(stops, gradientType)
    && stops.every((stop) => stop.type === 'color-hint'
      || stop.color.kind === ColorKind.Absolute && stop.offsets?.length === 1);
}

function isCanonicalAngle(
  value: LinearGradientDirection | AngleValue | ZeroValue,
): value is CanonicalAngleLiteral {
  return value.type === 'angle' && value.unit === 'deg';
}

function isCanonicalLength(value: unknown): value is CanonicalLengthLiteral {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'length'
    && 'unit' in value
    && value.unit === 'px'
    && 'value' in value
    && typeof value.value === 'number';
}

function isExplicitLengthPercentage(
  value: LengthPercentageValue,
): value is ExplicitLengthPercentageLiteral {
  return value.type === 'percentage'
    || value.type === 'length' && value.unit === 'px';
}

function isExplicitGradientPosition(
  value: PositionValue,
): value is ExplicitGradientPosition {
  return value.offsets !== undefined
    && value.offsets.every(isExplicitLengthPercentage);
}

function explicitGradientPosition(
  center: RadialCenter,
): ExplicitGradientPosition {
  return {
    type: 'position',
    offsets: mapTuple(center, (offset) => lengthLiteral(offset)),
  };
}



//  ██████  ████████ ████████  ████    ███    ██
// ██    ██ ██       ██     ██  ██    ██ ██   ██
// ██       ██       ██     ██  ██   ██   ██  ██
//  ██████  ██████   ████████   ██  ██     ██ ██
//       ██ ██       ██   ██    ██  █████████ ██
// ██    ██ ██       ██    ██   ██  ██     ██ ██
//  ██████  ████████ ██     ██ ████ ██     ██ ████████

export function serializeGradient(value: GradientValue): string {
  const name = `${value.repeating ? 'repeating-' : ''}${value.gradientType}-gradient`;
  let prelude: string[];

  switch (value.gradientType) {
    case 'linear':
      prelude = serializeLinearGradientPrelude(value);
      break;
    case 'radial':
      prelude = serializeRadialGradientPrelude(value);
      break;
    case 'conic':
      prelude = serializeConicGradientPrelude(value);
      break;
    default:
      return assertNever(value);
  }

  const stops = value.gradientType === 'conic'
    ? serializeGradientStops(value.stops, serializeAngularColorStopOffset)
    : serializeGradientStops(value.stops, serializeLengthPercentage);
  const body = prelude.length === 0
    ? stops
    : `${prelude.join(' ')}, ${stops}`;

  return `${name}(${body})`;
}

function serializeLinearGradientPrelude(value: LinearGradient): string[] {
  const prelude: string[] = [];

  if (!isDefaultLinearGradientDirection(value.direction)) {
    prelude.push(serializeLinearGradientDirection(value.direction));
  }

  if (!isDefaultGradientMethod(value.method, value.stops)) {
    prelude.push(serializeColorInterpolationMethod(value.method));
  }

  return prelude;
}

function serializeLinearGradientDirection(
  value: LinearGradientDirection,
): string {
  if (value.type === 'side-or-corner') {
    return `to ${[value.horizontal, value.vertical]
      .filter((side) => side !== undefined)
      .join(' ')}`;
  }

  return value.type === 'number'
    ? serializeNumber(value)
    : serializeAngle(value);
}

function serializeRadialGradientPrelude(value: RadialGradient): string[] {
  const prelude: string[] = [];

  if (!isDefaultRadialGradientShape(value.shape, value.size)) {
    prelude.push(value.shape);
  }

  if (!isDefaultRadialGradientSize(value.size)) {
    prelude.push(value.size.type === 'radial-extent'
      ? value.size.extents.join(' ')
      : value.size.radii.map(serializeLengthPercentage).join(' '));
  }

  if (!isCenterPosition(value.position)) {
    prelude.push(`at ${serializePosition(value.position)}`);
  }

  if (!isDefaultGradientMethod(value.method, value.stops)) {
    prelude.push(serializeColorInterpolationMethod(value.method));
  }

  return prelude;
}

function serializeConicGradientPrelude(value: ConicGradient): string[] {
  const prelude: string[] = [];

  if (!isZeroAngle(value.angle)) {
    prelude.push(`from ${value.angle.type === 'number'
      ? serializeNumber(value.angle)
      : serializeAngle(value.angle)}`);
  }

  if (!isCenterPosition(value.position)) {
    prelude.push(`at ${serializePosition(value.position)}`);
  }

  if (!isDefaultGradientMethod(value.method, value.stops)) {
    prelude.push(serializeColorInterpolationMethod(value.method));
  }

  return prelude;
}

function serializeGradientStops<
  Offset extends GradientStopOffset,
>(
  stops: GradientStops<Offset>,
  serializeStopOffset: (
    value: Offset,
  ) => string,
): string {
  return stops.map((stop, index) => {
    if (stop.type === 'color-hint') {
      return serializeStopOffset(stop.offset);
    }

    const offsets = stop.offsets?.length === 1
      && (index === 0 && isZeroGradientStopOffset(stop.offsets[0])
        || index === stops.length - 1
          && isFullGradientStopOffset(stop.offsets[0]))
      ? []
      : stop.offsets ?? [];

    return [
      serializeColorValue(stop.color),
      ...offsets.map(serializeStopOffset),
    ].join(' ');
  })
    .join(', ');
}

function serializeAngularColorStopOffset(
  value: AngularColorStopOffset,
): string {
  return value.type === 'number'
    ? serializeNumber(value)
    : serializeAnglePercentage(value);
}



// ████ ██    ██ ████████ ████████ ████████  ████████   ███████  ██          ███    ████████ ████████
//  ██  ███   ██    ██    ██       ██     ██ ██     ██ ██     ██ ██         ██ ██      ██    ██
//  ██  ████  ██    ██    ██       ██     ██ ██     ██ ██     ██ ██        ██   ██     ██    ██
//  ██  ██ ██ ██    ██    ██████   ████████  ████████  ██     ██ ██       ██     ██    ██    ██████
//  ██  ██  ████    ██    ██       ██   ██   ██        ██     ██ ██       █████████    ██    ██
//  ██  ██   ███    ██    ██       ██    ██  ██        ██     ██ ██       ██     ██    ██    ██
// ████ ██    ██    ██    ████████ ██     ██ ██         ███████  ████████ ██     ██    ██    ████████

export function interpolateGradients(
  a: GradientValue,
  b: GradientValue,
  progress: number,
  context: GradientContext = {},
): ExplicitGradient {
  const colorStopCountA = gradientColorStopCount(a.stops);
  const colorStopCountB = gradientColorStopCount(b.stops);

  if (a.gradientType !== b.gradientType
    || a.repeating !== b.repeating
    || !a.repeating && colorStopCountA !== colorStopCountB) {
    // TODO: Return cross-fade() once image combinations are represented.
    throw new Error('Gradient interpolation requires cross-fade()');
  }

  if (a.repeating && colorStopCountA !== colorStopCountB) {
    throw new Error('TODO: Align repeating gradient stop lists before interpolation');
  }

  const explicitA = tryResolveExplicitGradient(a, ValueStage.Used, context);
  const explicitB = tryResolveExplicitGradient(b, ValueStage.Used, context);

  if (explicitA === null || explicitB === null) {
    throw new Error('Gradient interpolation requires explicit used values');
  }

  if (usesMixedLengthPercentageStops(a) || usesMixedLengthPercentageStops(b)) {
    return progress < 0.5 ? explicitA : explicitB;
  }

  if (explicitA.stops[0].offsets[0].type
    !== explicitB.stops[0].offsets[0].type) {
    return progress < 0.5 ? explicitA : explicitB;
  }

  switch (a.gradientType) {
    case 'linear':
      return interpolateLinearGradients(
        a,
        b as LinearGradient,
        explicitA as ExplicitLinearGradient,
        explicitB as ExplicitLinearGradient,
        progress,
        context,
      );
    case 'radial':
      return interpolateRadialGradients(
        explicitA as ExplicitRadialGradient,
        explicitB as ExplicitRadialGradient,
        progress,
        context,
      );
    case 'conic':
      // Images 4 omits conic gradients from its incomplete interpolation prose;
      // apply the same component-wise model used for the other gradient forms.
      return interpolateConicGradients(
        explicitA as ExplicitConicGradient,
        explicitB as ExplicitConicGradient,
        progress,
        context,
      );
    default:
      return assertNever(a);
  }
}

function interpolateLinearGradients(
  originalA: LinearGradient,
  originalB: LinearGradient,
  a: ExplicitLinearGradient,
  b: ExplicitLinearGradient,
  progress: number,
  context: GradientContext,
): ExplicitLinearGradient {
  let angleA = a.direction.value;
  let angleB = b.direction.value;
  const method = discreteGradientMethod(a.method, b.method, progress);

  if (originalA.direction.type === 'side-or-corner'
    && originalB.direction.type === 'side-or-corner'
    && Math.abs(angleA - angleB) > 180) {
    if (angleA < angleB) {
      angleA += 360;
    } else {
      angleB += 360;
    }
  }

  return {
    ...a,
    method,
    direction: angleLiteral(interpolateNumber(angleA, angleB, progress)),
    lineLength: lengthLiteral(interpolateNumber(
      a.lineLength.value,
      b.lineLength.value,
      progress,
    )),
    stops: interpolateExplicitGradientStops(
      a.stops,
      b.stops,
      method,
      progress,
      context,
    ),
  };
}

function interpolateRadialGradients(
  a: ExplicitRadialGradient,
  b: ExplicitRadialGradient,
  progress: number,
  context: GradientContext,
): ExplicitRadialGradient {
  const method = discreteGradientMethod(a.method, b.method, progress);

  return {
    ...a,
    method,
    size: {
      type: 'radial-radii',
      radii: interpolateLengthTuple(
        a.size.radii,
        b.size.radii,
        progress,
        context,
      ),
    },
    position: interpolateExplicitGradientPosition(a.position, b.position, progress, context),
    stops: interpolateExplicitGradientStops(
      a.stops,
      b.stops,
      method,
      progress,
      context,
    ),
  };
}

function interpolateConicGradients(
  a: ExplicitConicGradient,
  b: ExplicitConicGradient,
  progress: number,
  context: GradientContext,
): ExplicitConicGradient {
  const method = discreteGradientMethod(a.method, b.method, progress);

  return {
    ...a,
    method,
    angle: angleLiteral(interpolateNumber(a.angle.value, b.angle.value, progress)),
    position: interpolateExplicitGradientPosition(a.position, b.position, progress, context),
    stops: interpolateExplicitGradientStops(
      a.stops,
      b.stops,
      method,
      progress,
      context,
    ),
  };
}

function interpolateExplicitGradientPosition(
  a: ExplicitGradientPosition,
  b: ExplicitGradientPosition,
  progress: number,
  context: GradientContext,
): ExplicitGradientPosition {
  return {
    type: 'position',
    offsets: interpolateLengthTuple(a.offsets, b.offsets, progress, context),
  };
}

function interpolateLengthTuple(
  a: [ExplicitLengthPercentageLiteral, ExplicitLengthPercentageLiteral],
  b: [ExplicitLengthPercentageLiteral, ExplicitLengthPercentageLiteral],
  progress: number,
  context: GradientContext,
): [ExplicitLengthPercentageLiteral, ExplicitLengthPercentageLiteral] {
  const boxSize = context.gradientBoxSize;
  const percentageBases = [boxSize?.width, boxSize?.height] as const;

  return mapTuple(a, (value, index) =>
    interpolateExplicitLengthPercentage(
      value,
      b[index]!,
      progress,
      percentageBases[index],
      context,
    ));
}

function interpolateExplicitLengthPercentage(
  a: ExplicitLengthPercentageLiteral,
  b: ExplicitLengthPercentageLiteral,
  progress: number,
  percentageBasis: number | undefined,
  context: GradientContext,
): ExplicitLengthPercentageLiteral {
  if (a.type === b.type) {
    return {
      ...a,
      value: interpolateNumber(a.value, b.value, progress),
    };
  }

  if (percentageBasis === undefined) {
    throw new Error('Gradient interpolation requires a percentage basis');
  }

  const resolvedA = resolveLengthPercentageInPixels(
    a,
    percentageBasis,
    ValueStage.Used,
    context,
  );
  const resolvedB = resolveLengthPercentageInPixels(
    b,
    percentageBasis,
    ValueStage.Used,
    context,
  );

  if (resolvedA === undefined || resolvedB === undefined) {
    throw new Error('Gradient interpolation could not resolve its geometry');
  }

  return lengthLiteral(interpolateNumber(resolvedA, resolvedB, progress));
}

function interpolateExplicitGradientStops<
  Offset extends ExplicitGradientStopOffset,
>(
  a: ExplicitGradientStops<Offset>,
  b: ExplicitGradientStops<Offset>,
  method: ColorInterpolationMethod,
  progress: number,
  context: GradientContext,
): ExplicitGradientStops<Offset> {
  if (a.length !== b.length) {
    throw new Error('TODO: Define interpolation for unmatched gradient hints');
  }

  return mapTuple(a, (stop, index) => {
    const other = b[index]!;

    if (stop.type === 'color-hint' && other.type === 'color-hint') {
      return {
        type: 'color-hint',
        offset: interpolateExplicitGradientStopOffset(
          stop.offset,
          other.offset,
          progress,
        ),
      };
    }

    if (stop.type === 'color-stop' && other.type === 'color-stop') {
      return {
        type: 'color-stop',
        color: (method.hue === undefined || method.hue === 'shorter')
          && areIdenticalAbsoluteColors(stop.color, other.color)
          ? stop.color
          : interpolateColors(
            stop.color,
            other.color,
            progress,
            method.space,
            method.hue,
            context,
          ),
        offsets: [interpolateExplicitGradientStopOffset(
          stop.offsets[0],
          other.offsets[0],
          progress,
        )],
      };
    }

    throw new Error('TODO: Define interpolation for unmatched gradient hints');
  }) as ExplicitGradientStops<Offset>;
}

function areIdenticalAbsoluteColors(a: AbsoluteColor, b: AbsoluteColor): boolean {
  return a.space.name === b.space.name
    && a.alpha === b.alpha
    && a.isLegacySrgb === b.isLegacySrgb
    && a.is8Bit === b.is8Bit
    && a.components.length === b.components.length
    && a.components.every((component, index) => component === b.components[index]);
}

function interpolateExplicitGradientStopOffset<
  Offset extends ExplicitGradientStopOffset,
>(
  a: Offset,
  b: Offset,
  progress: number,
): Offset {
  if (a.type !== b.type) {
    throw new Error('Explicit gradient stop offsets must use the same unit');
  }

  return {
    ...a,
    value: interpolateNumber(a.value, b.value, progress),
  };
}

function discreteGradientMethod(
  a: ColorInterpolationMethod,
  b: ColorInterpolationMethod,
  progress: number,
): ColorInterpolationMethod {
  return progress < 0.5 ? a : b;
}

function interpolateNumber(a: number, b: number, progress: number): number {
  return (1 - progress) * a + progress * b;
}

function gradientColorStopCount(
  stops: GradientStops<GradientStopOffset>,
): number {
  return stops.reduce((count, stop) => stop.type === 'color-hint'
    ? count
    : count + (stop.offsets?.length === 2 ? 2 : 1), 0);
}

function usesMixedLengthPercentageStops(value: GradientValue): boolean {
  if (value.gradientType === 'conic') {
    return false;
  }

  let hasLength = false;
  let hasPercentage = false;

  for (const stop of value.stops) {
    const offsets = stop.type === 'color-hint'
      ? [stop.offset]
      : stop.offsets ?? [];

    for (const offset of offsets) {
      if (offset.type === 'math') {
        return true;
      }

      if (offset.type === 'length') {
        hasLength = true;
      } else {
        hasPercentage = true;
      }
    }
  }

  return hasLength && hasPercentage;
}
