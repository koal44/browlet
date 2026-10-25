import { assertNever, mapTuple } from '../../infra/util';
import { InternalError } from '../../infra/internal-error';

import {
  createKeywordConsumer, createFunctionalNotationConsumer, consumeComma, adaptConsumer, one, oneOf, opt, repeat,
  requiredSequenceOf, requiredSomeOf, sequenceOf, withTrivia, createComponentParser,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage, type ValueContext } from '../value-processing/index';
import {
  AngleLiteral, LengthLiteral, PercentageLiteral, ZeroLiteral,
  type CanonicalAngleLiteral, type CanonicalLengthLiteral,
} from './numeric-literal/index';

import type { Value } from './value';
import { AngleValue } from './angle';
import { AnglePercentageValue } from './angle-percentage';
import {
  ColorValue, ColorKind, serializeColorInterpolationMethod, consumeColorInterpolationMethod,
  type AbsoluteColor, type ColorInterpolationMethod, type ColorValueContext,
} from './color';
import { LengthPercentageValue } from './length-percentage';
import { MathValue } from './math-value';
import { PositionValue, type PositionOffsets, type PositionValueContext } from './position';

/** A gradient whose geometry, stops, and colors resolve together. */
// https://drafts.csswg.org/css-images-4/#gradients
export class GradientValue<R extends Gradient = Gradient> implements Value<GradientValueContext> {
  /** Gradient geometry and color stops at their current lifecycle stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse a complete linear, radial, or conic gradient. */
  static parse(input: ParserInput, context: GradientValueContext): GradientValue | null {
    return gradientParser(input, context);
  }

  /** Consume one gradient function. */
  static consume(this: void, c: TokenCursor<ComponentValue, GradientValueContext>): TryConsumerResult<GradientValue> {
    return gradientConsumer(c);
  }

  /** Resolve child values with the available color and geometry context. */
  resolve(stage: ValueStage, context: GradientValueContext): GradientValue {
    return new GradientValue(this.repr.resolve(stage, context));
  }

  /** Resolve the geometry and stops required for interpolation, when enough context exists. */
  tryResolveExplicit(stage: ValueStage, context: GradientValueContext): GradientValue<ExplicitGradient> | null {
    const explicit = this.repr.tryResolveExplicit(stage, context);
    return explicit === null ? null : new GradientValue(explicit);
  }

  /** Whether the retained representation already contains explicit geometry and stops. */
  isExplicit(): this is GradientValue<ExplicitGradient> {
    return this.repr.isExplicit();
  }

  /** Serialize the current geometry and stops without resolving them. */
  serialize(): string {
    return this.repr.serialize();
  }

  /** Interpolate compatible gradients using their explicit used values. */
  interpolate(
    other: GradientValue,
    progress: number,
    context: GradientValueContext,
  ): GradientValue<ExplicitGradient> {
    const a: Gradient = this.repr;
    const b = other.repr;
    const colorStopCountA = a.colorStopCount();
    const colorStopCountB = b.colorStopCount();

    if (a.gradientType !== b.gradientType ||
      a.repeating !== b.repeating ||
      !a.repeating && colorStopCountA !== colorStopCountB) {
      // TODO: Return cross-fade() once image combinations are represented.
      throw new InternalError('Gradient interpolation requires cross-fade()');
    }

    if (a.repeating && colorStopCountA !== colorStopCountB) {
      throw new InternalError('TODO: Align repeating gradient stop lists before interpolation');
    }

    const explicitA = a.tryResolveExplicit(ValueStage.Used, context);
    const explicitB = b.tryResolveExplicit(ValueStage.Used, context);

    if (explicitA === null || explicitB === null) {
      throw new InternalError('Gradient interpolation requires explicit used values');
    }

    if (a.hasMixedLengthPercentageStops() || b.hasMixedLengthPercentageStops()) {
      return new GradientValue(progress < 0.5 ? explicitA : explicitB);
    }

    if (explicitA.stops[0].offsets[0].repr.type
      !== explicitB.stops[0].offsets[0].repr.type) {
      return new GradientValue(progress < 0.5 ? explicitA : explicitB);
    }

    switch (a.gradientType) {
      case 'linear':
        return new GradientValue((explicitA as ExplicitLinearGradient).interpolate(
          explicitB as ExplicitLinearGradient, progress, context, a, b as LinearGradient,
        ));
      case 'radial':
        return new GradientValue((explicitA as ExplicitRadialGradient).interpolate(
          explicitB as ExplicitRadialGradient, progress, context,
        ));
      case 'conic':
        // Images 4 omits conic gradients from its incomplete interpolation prose;
        // apply the same component-wise model used for the other gradient forms.
        return new GradientValue((explicitA as ExplicitConicGradient).interpolate(
          explicitB as ExplicitConicGradient, progress, context,
        ));
      default:
        return assertNever(a);
    }
  }
}

type Gradient = LinearGradient | RadialGradient | ConicGradient;

type GradientType = 'linear' | 'radial' | 'conic';

/** Shared stop-list processing and notation for the three gradient geometries. */
abstract class GradientBase<
  Type extends GradientType,
  Offset extends GradientStopOffsetFor<Type>,
  Stops extends GradientStops<Offset> = GradientStops<Offset>,
> implements Value<GradientValueContext> {
  /** The geometry used by the function and its stop offsets. */
  abstract gradientType: Type;
  /** Whether the stop sequence repeats beyond its first and last stops. */
  repeating: boolean;
  /** The color space and hue path used between stops. */
  method: ColorInterpolationMethod;
  /** Ordered color stops and interpolation hints. */
  stops: Stops;

  constructor(method: ColorInterpolationMethod, stops: Stops, repeating: boolean) {
    this.method = method;
    this.stops = stops;
    this.repeating = repeating;
  }

  /** Legacy sRGB stops retain their historical default interpolation space. */
  static defaultColorSpace<Offset>(stops: GradientStops<Offset>): 'srgb' | 'oklab' {
    return stops.every((stop) => stop.type === 'color-hint' || stop.color.isLegacySrgb()) ? 'srgb' : 'oklab';
  }

  /** Interpolate two explicit stop lists in the selected color space. */
  protected static interpolateStops<
    Offset extends ExplicitGradientStopOffset,
  >(
    a: ExplicitGradientStops<Offset>,
    b: ExplicitGradientStops<Offset>,
    method: ColorInterpolationMethod,
    progress: number,
    context: GradientValueContext,
  ): ExplicitGradientStops<Offset> {
    if (a.length !== b.length) {
      throw new InternalError('TODO: Define interpolation for unmatched gradient hints');
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
          color: (method.hue === undefined || method.hue === 'shorter') &&
            areIdenticalAbsoluteColors(stop.color.repr, other.color.repr)
            ? stop.color
            : stop.color.interpolate(other.color, progress, context, method.space, method.hue),
          offsets: [interpolateExplicitGradientStopOffset(
            stop.offsets[0],
            other.offsets[0],
            progress,
          )],
        };
      }

      throw new InternalError('TODO: Define interpolation for unmatched gradient hints');
    }) as ExplicitGradientStops<Offset>;
  }

  abstract resolve(stage: ValueStage, context: GradientValueContext): GradientBase<Type, Offset>;

  /** Resolve the complete geometry and stop list needed for interpolation. */
  tryResolveExplicit(stage: ValueStage, context: GradientValueContext): ExplicitGradient | null {
    if (stage < ValueStage.Used) return null;
    const computed = this.resolve(ValueStage.Computed, context);
    // Keep comparable percentages when possible; geometry is only the fallback.
    computed.stops[0].offsets ??= [computed.#defaultStopOffset(0)];
    let stops = computed.#fixupStops(computed.stops, ValueStage.Used, { env: context.env });
    if (!computed.hasExplicitStops(stops)) {
      stops = this.resolve(stage, context).stops;
      if (!computed.hasExplicitStops(stops)) return null;
    }
    return computed.resolveExplicitGeometry(stops as GradientStops<ExplicitGradientStopOffset>, stage, context);
  }

  /** Whether geometry, colors, and offsets are already explicit. */
  abstract isExplicit(): boolean;

  serialize(): string {
    const name = `${this.repeating ? 'repeating-' : ''}${this.gradientType}-gradient`;
    const prelude = this.serializePrelude();
    if (this.method.hue !== undefined && this.method.hue !== 'shorter' ||
      this.method.space !== GradientBase.defaultColorSpace(this.stops)) {
      prelude.push(serializeColorInterpolationMethod(this.method));
    }
    const stops = this.#serializeStops();
    const body = prelude.length === 0 ? stops : `${prelude.join(' ')}, ${stops}`;
    return `${name}(${body})`;
  }

  /** Count both positions of a double-position color stop, excluding hints. */
  colorStopCount(): number {
    return this.stops.reduce((count, stop) => stop.type === 'color-hint'
      ? count
      : count + (stop.offsets?.length === 2 ? 2 : 1), 0);
  }

  /** Whether length and percentage stops prevent component-wise interpolation. */
  hasMixedLengthPercentageStops(): boolean {
    if (this.gradientType === 'conic') {
      return false;
    }

    let hasLength = false;
    let hasPercentage = false;

    for (const stop of this.stops) {
      const offsets = stop.type === 'color-hint'
        ? [stop.offset]
        : stop.offsets ?? [];

      for (const offset of offsets) {
        const literal = offset instanceof ZeroLiteral ? offset : offset.repr;
        if (literal instanceof MathValue) {
          return true;
        }

        if (literal instanceof LengthLiteral) {
          hasLength = true;
        } else {
          hasPercentage = true;
        }
      }
    }

    return hasLength && hasPercentage;
  }

  /** Resolve child colors and offsets, then apply the used-stage stop fixup. */
  protected resolveStops(stage: ValueStage, context: GradientValueContext): GradientStops<Offset> {
    const resolved = mapTuple(this.stops, (stop) => {
      if (stop.type === 'color-hint') {
        return {
          ...stop,
          offset: resolveStopOffset(stop.offset, stage, context),
        };
      }

      return {
        ...stop,
        color: stop.color.resolve(stage, context),
        offsets: stop.offsets === undefined
          ? undefined
          : mapTuple(stop.offsets, (offset) =>
            resolveStopOffset(offset, stage, context)),
      };
    }) as GradientStops<Offset>;

    return this.#fixupStops(resolved, stage, context);
  }

  /** Whether every stop has an absolute color and one comparable canonical offset. */
  protected hasExplicitStops(stops: GradientStops<GradientStopOffset> = this.stops): boolean {
    return this.#hasComparableStopOffsets(stops) &&
      stops.every((stop) => stop.type === 'color-hint' ||
        stop.color.repr.kind === ColorKind.Absolute && stop.offsets?.length === 1);
  }

  protected abstract resolveExplicitGeometry(
    stops: GradientStops<ExplicitGradientStopOffset>, stage: ValueStage, context: GradientValueContext,
  ): ExplicitGradient | null;

  protected abstract serializePrelude(): string[];

  /** Construct an endpoint percentage in this gradient's angular or length grammar. */
  #defaultStopOffset(value: 0 | 100): Offset {
    const percentage = new PercentageLiteral(value);
    return (this.gradientType === 'conic'
      ? new AnglePercentageValue(percentage)
      : new LengthPercentageValue(percentage)) as Offset;
  }

  /** Whether all present offsets can be ordered without another conversion. */
  #hasComparableStopOffsets(stops: GradientStops<GradientStopOffset>): boolean {
    let kind: ExplicitGradientStopOffset['repr']['type'] | undefined;
    const conic = this.gradientType === 'conic';

    for (const stop of stops) {
      const offsets = stop.type === 'color-hint'
        ? [stop.offset]
        : stop.offsets ?? [];

      for (const offset of offsets) {
        if (!isComparableGradientStopOffset(offset, conic)) {
          return false;
        }

        if (kind !== undefined && kind !== offset.repr.type) {
          return false;
        }

        kind = offset.repr.type;
      }
    }

    return true;
  }

  /** Fill missing offsets, clamp decreasing offsets, and distribute unpositioned stops. */
  #fixupStops(
    stops: GradientStops<Offset>, stage: ValueStage, context: GradientValueContext,
  ): GradientStops<Offset> {
    if (stage < ValueStage.Used) {
      return stops;
    }

    // 1. If the first color stop has no offset, set it to 0%.
    stops[0].offsets ??= [
      this.gradientType === 'conic' ? new AnglePercentageValue(new AngleLiteral(0, 'deg')) : new LengthPercentageValue(new LengthLiteral(0, 'px')),
    ] as StopOffsets<Offset>;

    // 2. If the last color stop has no offset, set it to 100%.
    const last = stops.at(-1)!;

    if (last.type === 'color-stop' && last.offsets === undefined) {
      const percentageReference = context.percentageReferenceValue;
      const offset = percentageReference === undefined
        ? this.#defaultStopOffset(100)
        : this.gradientType === 'conic'
          ? new AnglePercentageValue(new AngleLiteral(percentageReference.value, 'deg'))
          : new LengthPercentageValue(new LengthLiteral(percentageReference.value, 'px'));

      last.offsets = [offset as Offset];
    }

    if (!this.#hasComparableStopOffsets(stops)) {
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

      if (offset.repr.value < largest.repr.value) {
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
          interpolateExplicitGradientStopOffset(
            before,
            after,
            (offset + 1) / (count + 1),
          ),
        );
      }
    }

    return fixed as GradientStops<Offset>;
  }

  /** Serialize stop colors, offsets, and hints in their retained order. */
  #serializeStops(): string {
    return this.stops.map((stop, index) => {
      if (stop.type === 'color-hint') {
        return stop.offset.serialize();
      }

      const offsets = stop.offsets?.length === 1 &&
        (index === 0 && isZeroGradientStopOffset(stop.offsets[0]) ||
          index === this.stops.length - 1 &&
          isFullGradientStopOffset(stop.offsets[0]))
        ? []
        : stop.offsets ?? [];

      return [
        stop.color.serialize(),
        ...offsets.map((offset) => offset.serialize()),
      ].join(' ');
    })
      .join(', ');
  }
}

export interface GradientContext extends ValueContext {
  /** Concrete dimensions into which the gradient is drawn, in CSS pixels. */
  gradientBoxSize?: GradientBoxSize;
}

export type GradientValueContext =
  & GradientContext
  & ColorValueContext
  & PositionValueContext;

type GradientBoxSize = {
  width: number;
  height: number;
};

/** A straight gradient line, directed by an angle or a box side/corner. */
export class LinearGradient<Stops extends ColorStops = ColorStops>
  extends GradientBase<'linear', LengthPercentageValue, Stops> {
  gradientType = 'linear' as const;
  /** The direction of the gradient line. */
  direction: LinearGradientDirection;
  /** The concrete line length retained by an explicit gradient. */
  lineLength?: CanonicalLengthLiteral;

  constructor(
    direction: LinearGradientDirection, method: ColorInterpolationMethod, stops: Stops,
    repeating = false, lineLength?: CanonicalLengthLiteral,
  ) {
    super(method, stops, repeating);
    this.direction = direction;
    this.lineLength = lineLength;
  }

  /** Resolve an angle or side/corner direction against the gradient box. */
  static #angleForDirection(
    direction: LinearGradientDirection, boxSize: GradientBoxSize,
  ): number | undefined {
    let angle: number;

    if (direction instanceof AngleValue) {
      if (!(direction.repr instanceof AngleLiteral)) return undefined;
      angle = direction.repr.canonicalize().value;
    } else if (direction instanceof ZeroLiteral) {
      angle = 0;
    } else if (direction.horizontal === undefined) {
      angle = direction.vertical === 'top' ? 0 : 180;
    } else if (direction.vertical === undefined) {
      angle = direction.horizontal === 'right' ? 90 : 270;
    } else {
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

  /** Measure the gradient line for a resolved angle in the concrete box. */
  static #lineLengthForAngle(
    angle: number | undefined, boxSize: GradientBoxSize,
  ): number | undefined {
    if (angle === undefined) {
      return undefined;
    }

    const { width, height } = boxSize;
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

  resolve(stage: ValueStage, context: GradientValueContext): LinearGradient {
    const direction = this.direction instanceof AngleValue
      ? this.direction.resolve(stage, context) : this.direction;
    const boxSize = context.gradientBoxSize;
    const lineLength = stage >= ValueStage.Used && boxSize !== undefined
      ? LinearGradient.#lineLengthForAngle(LinearGradient.#angleForDirection(direction, boxSize), boxSize)
      : undefined;
    const percentageReferenceValue = lineLength === undefined ? undefined : new LengthLiteral(lineLength, 'px');
    const stops = this.resolveStops(stage, { ...context, percentageReferenceValue });
    return new LinearGradient(direction, this.method, stops, this.repeating, this.lineLength);
  }

  isExplicit(): this is ExplicitLinearGradient {
    return this.hasExplicitStops() &&
      isCanonicalAngle(this.direction) && this.lineLength !== undefined;
  }

  /** Interpolate explicit line geometry, retaining the original keyword-angle rule. */
  interpolate(
    this: ExplicitLinearGradient, other: ExplicitLinearGradient, progress: number, context: GradientValueContext,
    originalA: LinearGradient, originalB: LinearGradient,
  ): ExplicitLinearGradient {
    let angleA = this.direction.repr.value;
    let angleB = other.direction.repr.value;
    const method = discreteGradientMethod(this.method, other.method, progress);
    if (!(originalA.direction instanceof AngleValue) && !(originalA.direction instanceof ZeroLiteral) &&
      !(originalB.direction instanceof AngleValue) && !(originalB.direction instanceof ZeroLiteral) &&
      Math.abs(angleA - angleB) > 180) {
      if (angleA < angleB) angleA += 360;
      else angleB += 360;
    }
    return new LinearGradient(
      new AngleValue(new AngleLiteral(interpolateNumber(angleA, angleB, progress), 'deg')),
      method, GradientBase.interpolateStops(this.stops, other.stops, method, progress, context), this.repeating,
      new LengthLiteral(interpolateNumber(this.lineLength.value, other.lineLength.value, progress), 'px'),
    ) as ExplicitLinearGradient;
  }

  protected resolveExplicitGeometry(
    stops: GradientStops<ExplicitGradientStopOffset>, stage: ValueStage, context: GradientValueContext,
  ): ExplicitLinearGradient | null {
    const boxSize = context.gradientBoxSize;
    if (boxSize === undefined) return null;
    const direction = this.direction instanceof AngleValue
      ? this.direction.resolve(stage, context) : this.direction;
    const angle = LinearGradient.#angleForDirection(direction, boxSize);
    const lineLength = LinearGradient.#lineLengthForAngle(angle, boxSize);
    return angle === undefined || lineLength === undefined ? null : new LinearGradient(
      new AngleValue(new AngleLiteral(angle, 'deg')), this.method,
      stops as ExplicitGradientStops<ExplicitLengthPercentage>, this.repeating, new LengthLiteral(lineLength, 'px'),
    ) as ExplicitLinearGradient;
  }

  protected serializePrelude(): string[] {
    const prelude: string[] = [];

    if (!this.#hasDefaultDirection()) {
      const direction = this.direction;
      prelude.push(direction instanceof AngleValue || direction instanceof ZeroLiteral
        ? direction.serialize()
        : 'to ' + [direction.horizontal, direction.vertical].filter((side) => side !== undefined).join(' '));
    }
    return prelude;
  }

  /** Whether the direction can be omitted without changing the gradient line. */
  #hasDefaultDirection(): boolean {
    const { direction } = this;
    if (direction instanceof AngleValue) return direction.repr instanceof AngleLiteral && direction.repr.canonicalize().value === 180;
    return !(direction instanceof ZeroLiteral) && direction.horizontal === undefined && direction.vertical === 'bottom';
  }
}

type LinearGradientDirection = AngleValue | ZeroLiteral | SideOrCorner;

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

/** A circle or ellipse whose radii determine the gradient line. */
export class RadialGradient<Stops extends ColorStops = ColorStops>
  extends GradientBase<'radial', LengthPercentageValue, Stops> {
  gradientType = 'radial' as const;
  /** The shape of the ending contour. */
  shape: RadialShape;
  /** Explicit radii or extents relative to the gradient box. */
  size: RadialSize;
  /** The center of the ending contour. */
  position: PositionValue;

  constructor(
    shape: RadialShape, size: RadialSize, position: PositionValue,
    method: ColorInterpolationMethod, stops: Stops, repeating = false,
  ) {
    super(method, stops, repeating);
    this.shape = shape;
    this.size = size;
    this.position = position;
  }

  /** Infer a circle from a single literal length radius, otherwise an ellipse. */
  static defaultShape(size: RadialSize): RadialShape {
    return size.type === 'radial-radii' &&
      size.radii.length === 1 &&
      size.radii[0].repr instanceof LengthLiteral
      ? 'circle'
      : 'ellipse';
  }

  resolve(stage: ValueStage, context: GradientValueContext): RadialGradient {
    const geometryContext = { ...context, percentageReferenceValue: undefined };
    const size: RadialSize = this.size.type === 'radial-radii'
      ? { ...this.size, radii: mapTuple(this.size.radii, (radius) => radius.resolve(stage, geometryContext)) }
      : this.size;
    const resolved: RadialGradient = new RadialGradient(
      this.shape, size,
      this.position.resolve(stage, geometryContext), this.method, this.stops, this.repeating,
    );
    const lineLength = resolved.#geometry(stage, geometryContext)?.radii[0];
    const percentageReferenceValue = stage >= ValueStage.Used && lineLength !== undefined
      ? new LengthLiteral(lineLength, 'px') : undefined;
    resolved.stops = resolved.resolveStops(stage, { ...context, percentageReferenceValue });
    return resolved;
  }

  isExplicit(): this is ExplicitRadialGradient {
    return this.hasExplicitStops() &&
      this.shape === 'ellipse' && this.size.type === 'radial-radii' &&
      this.size.radii.length === 2 && this.size.radii.every(isExplicitLengthPercentage) &&
      isExplicitGradientPosition(this.position);
  }

  /** Interpolate the explicit radii, center, and color stops. */
  interpolate(
    this: ExplicitRadialGradient, other: ExplicitRadialGradient, progress: number, context: GradientValueContext,
  ): ExplicitRadialGradient {
    const method = discreteGradientMethod(this.method, other.method, progress);
    return new RadialGradient(
      'ellipse', { type: 'radial-radii', radii: interpolateLengthTuple(this.size.radii, other.size.radii, progress, context) },
      interpolateExplicitGradientPosition(this.position, other.position, progress, context),
      method, GradientBase.interpolateStops(this.stops, other.stops, method, progress, context), this.repeating,
    ) as ExplicitRadialGradient;
  }

  protected resolveExplicitGeometry(
    stops: GradientStops<ExplicitGradientStopOffset>, stage: ValueStage, context: GradientValueContext,
  ): ExplicitRadialGradient | null {
    const size = this.shape === 'ellipse' && this.size.type === 'radial-radii' &&
      this.size.radii.length === 2 && this.size.radii.every(isExplicitLengthPercentage)
      ? this.size as ExplicitRadialSize : null;
    const position = isExplicitGradientPosition(this.position) ? this.position : null;
    const geometry = size === null || position === null ? this.#geometry(stage, context) : undefined;
    if ((size === null || position === null) && geometry === undefined) return null;
    return new RadialGradient(
      'ellipse', size ?? {
        type: 'radial-radii',
        radii: mapTuple(geometry!.radii, (radius) => new LengthPercentageValue(new LengthLiteral(radius, 'px'))),
      }, position ?? explicitGradientPosition(geometry!.center), this.method,
      stops as ExplicitGradientStops<ExplicitLengthPercentage>, this.repeating,
    ) as ExplicitRadialGradient;
  }

  protected serializePrelude(): string[] {
    const prelude: string[] = [];

    if (this.shape !== RadialGradient.defaultShape(this.size)) {
      prelude.push(this.shape);
    }

    if (!(this.size.type === 'radial-extent' && this.size.extents.length === 1 &&
      this.size.extents[0] === 'farthest-corner')) {
      prelude.push(this.size.type === 'radial-extent'
        ? this.size.extents.join(' ')
        : this.size.radii.map((radius) => radius.serialize()).join(' '));
    }

    if (!isCenterPosition(this.position)) {
      prelude.push(`at ${this.position.serialize()}`);
    }
    return prelude;
  }

  #geometry(
    stage: ValueStage, context: GradientValueContext,
  ): { center: RadialCenter; radii: RadialRadii; } | undefined {
    const boxSize = context.gradientBoxSize;

    if (stage < ValueStage.Used || boxSize === undefined) {
      return undefined;
    }

    const center = radialGradientCenter(this.position, boxSize, stage, context);

    if (center === undefined) {
      return undefined;
    }

    const radii = this.size.type === 'radial-radii'
      ? resolveRadialRadii(this.shape, this.size.radii, boxSize, stage, context)
      : extentRadialGradientRadii(this.shape, this.size.extents, center, boxSize);

    // Degenerate radial gradients use arbitrary radii and have no unique length.
    return radii === undefined ||
      radii.some((radius) => !Number.isFinite(radius) || radius <= 0)
      ? undefined
      : { center, radii };
  }
}

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

/** A gradient whose stop offsets turn around a center point. */
export class ConicGradient<Stops extends GradientStops<AngularColorStopOffset> = GradientStops<AngularColorStopOffset>>
  extends GradientBase<'conic', AngularColorStopOffset, Stops> {
  gradientType = 'conic' as const;
  /** The starting angle of the sweep. */
  angle: AngleValue | ZeroLiteral;
  /** The center of rotation. */
  position: PositionValue;

  constructor(
    angle: AngleValue | ZeroLiteral, position: PositionValue,
    method: ColorInterpolationMethod, stops: Stops, repeating = false,
  ) {
    super(method, stops, repeating);
    this.angle = angle;
    this.position = position;
  }

  resolve(stage: ValueStage, context: GradientValueContext): ConicGradient {
    const percentageReferenceValue = stage >= ValueStage.Used ? new AngleLiteral(360, 'deg') : undefined;
    return new ConicGradient(
      this.#resolveAngle(stage, context), this.position.resolve(stage, context), this.method,
      this.resolveStops(stage, { ...context, percentageReferenceValue }), this.repeating,
    );
  }

  isExplicit(): this is ExplicitConicGradient {
    return this.hasExplicitStops() &&
      isCanonicalAngle(this.angle) && isExplicitGradientPosition(this.position);
  }

  /** Interpolate the explicit angle, center, and color stops. */
  interpolate(
    this: ExplicitConicGradient, other: ExplicitConicGradient, progress: number, context: GradientValueContext,
  ): ExplicitConicGradient {
    const method = discreteGradientMethod(this.method, other.method, progress);
    return new ConicGradient(
      new AngleValue(new AngleLiteral(interpolateNumber(this.angle.repr.value, other.angle.repr.value, progress), 'deg')),
      interpolateExplicitGradientPosition(this.position, other.position, progress, context),
      method, GradientBase.interpolateStops(this.stops, other.stops, method, progress, context), this.repeating,
    ) as ExplicitConicGradient;
  }

  protected resolveExplicitGeometry(
    stops: GradientStops<ExplicitGradientStopOffset>, stage: ValueStage, context: GradientValueContext,
  ): ExplicitConicGradient | null {
    const center = context.gradientBoxSize === undefined ? undefined
      : radialGradientCenter(this.position, context.gradientBoxSize, stage, context);
    const position = isExplicitGradientPosition(this.position) ? this.position
      : center === undefined ? null : explicitGradientPosition(center);
    const resolvedAngle = this.#resolveAngle(stage, context);
    const angle = resolvedAngle instanceof ZeroLiteral ? new AngleValue(new AngleLiteral(0, 'deg'))
      : resolvedAngle.repr instanceof AngleLiteral ? new AngleValue(resolvedAngle.repr.canonicalize()) : null;
    return position === null || angle === null ? null : new ConicGradient(
      angle, position, this.method, stops as ExplicitGradientStops<ExplicitAnglePercentage>, this.repeating,
    ) as ExplicitConicGradient;
  }

  protected serializePrelude(): string[] {
    const prelude: string[] = [];

    if (!isZeroAngle(this.angle)) {
      prelude.push(`from ${this.angle.serialize()}`);
    }

    if (!isCenterPosition(this.position)) {
      prelude.push(`at ${this.position.serialize()}`);
    }
    return prelude;
  }

  /** Resolve an authored angle while retaining the unitless zero alternative. */
  #resolveAngle(stage: ValueStage, context: GradientValueContext): AngleValue | ZeroLiteral {
    return this.angle instanceof ZeroLiteral ? this.angle : this.angle.resolve(stage, context);
  }
}

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

type AngularColorStopOffset = AnglePercentageValue | ZeroLiteral;
type GradientStopOffsetFor<Type extends GradientType> =
  Type extends 'conic' ? AngularColorStopOffset : LengthPercentageValue;
type GradientStopOffset = GradientStopOffsetFor<GradientType>;
type ColorStopLength = StopOffsets<LengthPercentageValue>;
type ColorStopAngle = StopOffsets<AngularColorStopOffset>;

/**
 * An interpolation-ready extension of CSS Images 4's explicit gradient form,
 * which names only canonical linear direction and radial size. This stronger
 * form also has resolved positions and colors, with all geometry and offsets.
 */
export type ExplicitGradient =
  | ExplicitLinearGradient
  | ExplicitRadialGradient
  | ExplicitConicGradient;

type ExplicitLinearGradient = LinearGradient<ExplicitGradientStops<ExplicitLengthPercentage>> & {
  direction: AngleValue<CanonicalAngleLiteral>;
  lineLength: CanonicalLengthLiteral;
};

type ExplicitRadialGradient = RadialGradient<ExplicitGradientStops<ExplicitLengthPercentage>> & {
  shape: 'ellipse';
  size: ExplicitRadialSize;
  position: ExplicitGradientPosition;
};

type ExplicitConicGradient = ConicGradient<ExplicitGradientStops<ExplicitAnglePercentage>> & {
  angle: AngleValue<CanonicalAngleLiteral>;
  position: ExplicitGradientPosition;
};

type ExplicitRadialSize = {
  type: 'radial-radii';
  radii: [
    horizontal: ExplicitLengthPercentage,
    vertical: ExplicitLengthPercentage,
  ];
};

type ExplicitGradientPosition = PositionValue<Omit<PositionOffsets, 'offsets'> & {
  offsets: [
    horizontal: ExplicitLengthPercentage,
    vertical: ExplicitLengthPercentage,
  ];
}>;

type ExplicitGradientStops<Offset extends ExplicitGradientStopOffset> = [
  first: ExplicitGradientColorStop<Offset>,
  ...rest: (
    | ExplicitGradientColorStop<Offset>
    | GradientColorHint<Offset>
  )[],
];

type ExplicitGradientColorStop<Offset extends ExplicitGradientStopOffset> =
  Omit<GradientColorStop<Offset>, 'color' | 'offsets'> & {
    color: ColorValue<AbsoluteColor>;
    offsets: [Offset];
  };

type ExplicitLengthPercentage = LengthPercentageValue<CanonicalLengthLiteral | PercentageLiteral>;
type ExplicitAnglePercentage = AnglePercentageValue<CanonicalAngleLiteral | PercentageLiteral>;
type ExplicitGradientStopOffset =
  | ExplicitLengthPercentage
  | ExplicitAnglePercentage;

type LinearGradientSyntax = { direction: LinearGradientDirection; method: ColorInterpolationMethod; stops: ColorStops; };
type RadialGradientSyntax = {
  shape: RadialShape; size: RadialSize; position: PositionValue; method: ColorInterpolationMethod; stops: ColorStops;
};
type ConicGradientSyntax = {
  angle: AngleValue | ZeroLiteral; position: PositionValue; method: ColorInterpolationMethod; stops: GradientStops<AngularColorStopOffset>;
};

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

const MAX_COLOR_STOPS = 2_048;

function createGradientStopListConsumer<Offset>(
  consumeStop: TryConsumer<GradientColorStop<Offset>, GradientValueContext>,
  consumeHint: TryConsumer<GradientColorHint<Offset>, GradientValueContext>,
): TryConsumer<GradientStops<Offset>, GradientValueContext> {
  return sequenceOf(
    [
      one(consumeStop),
      repeat(
        sequenceOf(
          [
            one(withTrivia(consumeComma)),
            opt(sequenceOf(
              [
                one(withTrivia(consumeHint)),
                one(withTrivia(consumeComma)),
              ],
              ([[hint]]) => hint,
            )),
            one(withTrivia(consumeStop)),
          ],
          ([, hint, [stop]]) => [
            ...(hint.length === 0 ? [] : [hint[0]]),
            stop,
          ],
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

      return stops;
    },
  );
}

// <color-stop-length> = <length-percentage>{1,2}
const colorStopLengthConsumer: TryConsumer<ColorStopLength, GradientValueContext> = sequenceOf(
  [
    one(LengthPercentageValue.consume),
    opt(withTrivia(LengthPercentageValue.consume)),
  ],
  ([[first], second]) => second.length === 0 ? [first] : [first, second[0]],
);

// <linear-color-hint> = <length-percentage>
const linearColorHintConsumer: TryConsumer<LinearColorHint, GradientValueContext> = adaptConsumer(
  LengthPercentageValue.consume,
  (offset) => ({ type: 'color-hint', offset }),
);

// <linear-color-stop> = <color> <color-stop-length>?
const linearColorStopConsumer: TryConsumer<LinearColorStop, GradientValueContext> = sequenceOf(
  [
    one(ColorValue.consume),
    opt(withTrivia(colorStopLengthConsumer)),
  ],
  ([[color], offsets]) => ({
    type: 'color-stop',
    color,
    ...(offsets.length === 0 ? {} : { offsets: offsets[0] }),
  }),
);

// <angle-percentage> | <zero>
const angularColorStopOffsetConsumer: TryConsumer<AngularColorStopOffset, GradientValueContext> = oneOf(
  [one(AnglePercentageValue.consume), one(ZeroLiteral.consume)],
  ([offset]) => offset,
);

// <color-stop-angle> = [ <angle-percentage> | <zero> ]{1,2}
const colorStopAngleConsumer: TryConsumer<ColorStopAngle, GradientValueContext> = sequenceOf(
  [
    one(angularColorStopOffsetConsumer),
    opt(withTrivia(angularColorStopOffsetConsumer)),
  ],
  ([[first], second]) => second.length === 0 ? [first] : [first, second[0]],
);

// <angular-color-hint> = <angle-percentage> | <zero>
const angularColorHintConsumer: TryConsumer<GradientColorHint<AngularColorStopOffset>, GradientValueContext> =
  adaptConsumer(
    angularColorStopOffsetConsumer,
    (offset) => ({ type: 'color-hint', offset }),
  );

// <angular-color-stop> = <color> <color-stop-angle>?
const angularColorStopConsumer: TryConsumer<GradientColorStop<AngularColorStopOffset>, GradientValueContext> =
  sequenceOf(
    [
      one(ColorValue.consume),
      opt(withTrivia(colorStopAngleConsumer)),
    ],
    ([[color], offsets]) => ({
      type: 'color-stop',
      color,
      ...(offsets.length === 0 ? {} : { offsets: offsets[0] }),
    }),
  );

// <color-stop-list> = <linear-color-stop> , [ <linear-color-hint>? , <linear-color-stop> ]#?
// Comma-explicit: <linear-color-stop> [ , [ <linear-color-hint> ,]? <linear-color-stop> ]*
const colorStopListConsumer: TryConsumer<ColorStops, GradientValueContext> =
  createGradientStopListConsumer(linearColorStopConsumer, linearColorHintConsumer);

// <angular-color-stop-list> = <angular-color-stop> , [ <angular-color-hint>? , <angular-color-stop> ]#?
// Comma-explicit: <angular-color-stop> [ , [ <angular-color-hint> ,]? <angular-color-stop> ]*
const angularColorStopListConsumer: TryConsumer<GradientStops<AngularColorStopOffset>, GradientValueContext> =
  createGradientStopListConsumer(angularColorStopConsumer, angularColorHintConsumer);

// <side-or-corner> = [left | right] || [top | bottom]
const sideOrCornerConsumer: TryConsumer<SideOrCorner, GradientValueContext> = requiredSomeOf(
  [
    one(withTrivia(createKeywordConsumer('left', 'right'))),
    one(withTrivia(createKeywordConsumer('top', 'bottom'))),
  ],
  ([horizontal, vertical]) => {
    if (horizontal === undefined) {
      return {
        type: 'side-or-corner',
        vertical: vertical![0],
      };
    }

    return {
      type: 'side-or-corner',
      horizontal: horizontal[0],
      ...(vertical === undefined ? {} : { vertical: vertical[0] }),
    };
  },
);

// <radial-extent> = closest-corner | closest-side | farthest-corner | farthest-side
const radialExtentConsumer = createKeywordConsumer(
  'closest-corner', 'closest-side', 'farthest-corner', 'farthest-side',
);

// <radial-shape> = circle | ellipse
const radialShapeConsumer = createKeywordConsumer('circle', 'ellipse');

// <radial-size> = <radial-extent>{1,2} | <length-percentage [0,infinity]>{1,2}
const radialSizeConsumer: TryConsumer<RadialSize, GradientValueContext> = oneOf(
  [
    one(sequenceOf(
      [
        one(radialExtentConsumer),
        opt(withTrivia(radialExtentConsumer)),
      ],
      ([[first], second]): RadialExtentSize => ({
        type: 'radial-extent',
        extents: second.length === 0 ? [first] : [first, second[0]],
      }),
    )),
    one(sequenceOf(
      [
        one(LengthPercentageValue.createConsumer({ min: 0 })),
        opt(withTrivia(LengthPercentageValue.createConsumer({ min: 0 }))),
      ],
      ([[first], second]): RadialRadiiSize => ({
        type: 'radial-radii',
        radii: second.length === 0 ? [first] : [first, second[0]],
      }),
    )),
  ],
  ([size]) => size,
);

// <linear-gradient-syntax> = [ [ <angle> | <zero> | to <side-or-corner> ] || <color-interpolation-method> ]? , <color-stop-list>
// Comma-explicit: [ [ [ <angle> | <zero> | to <side-or-corner> ] || <color-interpolation-method> ] ,]? <color-stop-list>
const linearGradientSyntaxConsumer: TryConsumer<LinearGradientSyntax, GradientValueContext> = sequenceOf(
  [
    opt(sequenceOf(
      [
        one(requiredSomeOf(
          [
            one(withTrivia(oneOf(
              [
                one(AngleValue.consume),
                one(ZeroLiteral.consume),
                one(sequenceOf(
                  [
                    one(createKeywordConsumer('to')),
                    one(withTrivia(sideOrCornerConsumer)),
                  ],
                  ([, [sideOrCorner]]) => sideOrCorner,
                )),
              ],
              ([direction]) => direction,
            ))),
            one(withTrivia(consumeColorInterpolationMethod)),
          ],
          ([direction, method]) => ({
            ...(direction === undefined ? {} : { direction: direction[0] }),
            ...(method === undefined ? {} : { method: method[0] }),
          }),
        )),
        one(withTrivia(consumeComma)),
      ],
      ([[prelude]]) => prelude,
    )),
    one(withTrivia(colorStopListConsumer)),
  ],
  ([prelude, [stops]]) => {
    const syntax = prelude.length === 0 ? {} : prelude[0];
    return {
      direction: syntax.direction ?? new AngleValue(new AngleLiteral(180, 'deg')),
      method: syntax.method ?? { space: GradientBase.defaultColorSpace(stops) },
      stops,
    };
  },
);

// <radial-gradient-syntax> = [ [ [ <radial-shape> || <radial-size> ]? [ at <position> ]? ] || <color-interpolation-method> ]? , <color-stop-list>
// Comma-explicit: [ [ [ [ <radial-shape> || <radial-size> ]? [ at <position> ]? ] || <color-interpolation-method> ] ,]? <color-stop-list>
const radialGradientSyntaxConsumer: TryConsumer<RadialGradientSyntax, GradientValueContext> = sequenceOf(
  [
    opt(sequenceOf(
      [
        one(requiredSomeOf(
          [
            one(withTrivia(requiredSequenceOf(
              [
                opt(requiredSomeOf(
                  [
                    one(withTrivia(radialShapeConsumer)),
                    one(withTrivia(radialSizeConsumer)),
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

                    return {
                      ...(radialShape === undefined ? {} : { shape: radialShape }),
                      ...(radialSize === undefined ? {} : { size: radialSize }),
                    };
                  },
                )),
                opt(sequenceOf(
                  [
                    one(withTrivia(createKeywordConsumer('at'))),
                    one(withTrivia(PositionValue.consume)),
                  ],
                  ([, [position]]) => position,
                )),
              ],
              ([shapeAndSize, position]) => ({
                ...(shapeAndSize.length === 0 ? {} : shapeAndSize[0]),
                ...(position.length === 0 ? {} : { position: position[0] }),
              }),
            ))),
            one(withTrivia(consumeColorInterpolationMethod)),
          ],
          ([geometry, method]) => ({
            ...(geometry === undefined ? {} : geometry[0]),
            ...(method === undefined ? {} : { method: method[0] }),
          }),
        )),
        one(withTrivia(consumeComma)),
      ],
      ([[prelude]]) => prelude,
    )),
    one(withTrivia(colorStopListConsumer)),
  ],
  ([prelude, [stops]]) => {
    const syntax = prelude.length === 0 ? {} : prelude[0];
    const size: RadialSize = syntax.size ?? { type: 'radial-extent', extents: ['farthest-corner'] };
    return {
      shape: syntax.shape ?? RadialGradient.defaultShape(size),
      size,
      position: syntax.position ?? PositionValue.fromComponents('center'),
      method: syntax.method ?? { space: GradientBase.defaultColorSpace(stops) },
      stops,
    };
  },
);

// <conic-gradient-syntax> = [ [ [ from [ <angle> | <zero> ] ]? [ at <position> ]? ] || <color-interpolation-method> ]? , <angular-color-stop-list>
// Comma-explicit: [ [ [ [ from [ <angle> | <zero> ] ]? [ at <position> ]? ] || <color-interpolation-method> ] ,]? <angular-color-stop-list>
const conicGradientSyntaxConsumer: TryConsumer<ConicGradientSyntax, GradientValueContext> = sequenceOf(
  [
    opt(sequenceOf(
      [
        one(requiredSomeOf(
          [
            one(withTrivia(requiredSequenceOf(
              [
                opt(sequenceOf(
                  [
                    one(createKeywordConsumer('from')),
                    one(withTrivia(oneOf(
                      [one(AngleValue.consume), one(ZeroLiteral.consume)],
                      ([angle]) => angle,
                    ))),
                  ],
                  ([, [angle]]) => angle,
                )),
                opt(sequenceOf(
                  [
                    one(withTrivia(createKeywordConsumer('at'))),
                    one(withTrivia(PositionValue.consume)),
                  ],
                  ([, [position]]) => position,
                )),
              ],
              ([angle, position]) => ({
                ...(angle.length === 0 ? {} : { angle: angle[0] }),
                ...(position.length === 0 ? {} : { position: position[0] }),
              }),
            ))),
            one(withTrivia(consumeColorInterpolationMethod)),
          ],
          ([geometry, method]) => ({
            ...(geometry === undefined ? {} : geometry[0]),
            ...(method === undefined ? {} : { method: method[0] }),
          }),
        )),
        one(withTrivia(consumeComma)),
      ],
      ([[prelude]]) => prelude,
    )),
    one(withTrivia(angularColorStopListConsumer)),
  ],
  ([prelude, [stops]]) => {
    const syntax = prelude.length === 0 ? {} : prelude[0];
    return {
      angle: syntax.angle ?? new AngleValue(new AngleLiteral(0, 'deg')),
      position: syntax.position ?? PositionValue.fromComponents('center'),
      method: syntax.method ?? { space: GradientBase.defaultColorSpace(stops) },
      stops,
    };
  },
);

// <linear-gradient()> = linear-gradient( [ <linear-gradient-syntax> ] )
const linearGradientFnConsumer = createFunctionalNotationConsumer(
  'linear-gradient',
  linearGradientSyntaxConsumer,
  (syntax) => new LinearGradient(syntax.direction, syntax.method, syntax.stops, false),
);

// <repeating-linear-gradient()> = repeating-linear-gradient( [ <linear-gradient-syntax> ] )
const repeatingLinearGradientFnConsumer = createFunctionalNotationConsumer(
  'repeating-linear-gradient',
  linearGradientSyntaxConsumer,
  (syntax) => new LinearGradient(syntax.direction, syntax.method, syntax.stops, true),
);

// <radial-gradient()> = radial-gradient( [ <radial-gradient-syntax> ] )
const radialGradientFnConsumer = createFunctionalNotationConsumer(
  'radial-gradient',
  radialGradientSyntaxConsumer,
  (syntax) => new RadialGradient(syntax.shape, syntax.size, syntax.position, syntax.method, syntax.stops, false),
);

// <repeating-radial-gradient()> = repeating-radial-gradient( [ <radial-gradient-syntax> ] )
const repeatingRadialGradientFnConsumer = createFunctionalNotationConsumer(
  'repeating-radial-gradient',
  radialGradientSyntaxConsumer,
  (syntax) => new RadialGradient(syntax.shape, syntax.size, syntax.position, syntax.method, syntax.stops, true),
);

// <conic-gradient()> = conic-gradient( [ <conic-gradient-syntax> ] )
const conicGradientFnConsumer = createFunctionalNotationConsumer(
  'conic-gradient',
  conicGradientSyntaxConsumer,
  (syntax) => new ConicGradient(syntax.angle, syntax.position, syntax.method, syntax.stops, false),
);

// <repeating-conic-gradient()> = repeating-conic-gradient( [ <conic-gradient-syntax> ] )
const repeatingConicGradientFnConsumer = createFunctionalNotationConsumer(
  'repeating-conic-gradient',
  conicGradientSyntaxConsumer,
  (syntax) => new ConicGradient(syntax.angle, syntax.position, syntax.method, syntax.stops, true),
);

// <gradient> = <linear-gradient()> | <repeating-linear-gradient()> | <radial-gradient()> | <repeating-radial-gradient()> | <conic-gradient()> | <repeating-conic-gradient()>
const gradientConsumer: TryConsumer<GradientValue, GradientValueContext> = oneOf(
  [
    one(linearGradientFnConsumer),
    one(repeatingLinearGradientFnConsumer),
    one(radialGradientFnConsumer),
    one(repeatingRadialGradientFnConsumer),
    one(conicGradientFnConsumer),
    one(repeatingConicGradientFnConsumer),
  ],
  ([gradient]) => new GradientValue(gradient),
);

const gradientParser = createComponentParser(withTrivia(gradientConsumer));

function isZeroAngle(angle: AngleValue | ZeroLiteral): boolean {
  return angle instanceof ZeroLiteral || angle.repr instanceof AngleLiteral && angle.repr.value === 0;
}

function isCenterPosition(position: PositionValue): boolean {
  const { repr: value } = position;
  const components = value.offsets ?? value.components;
  return components.length <= 2 && components.every((component) => component === 'center' ||
    typeof component !== 'string' && component.repr instanceof PercentageLiteral && component.repr.value === 50);
}

function isZeroGradientStopOffset(offset: GradientStopOffset): boolean {
  return offset instanceof ZeroLiteral || !(offset.repr instanceof MathValue) && offset.repr.value === 0;
}

function isFullGradientStopOffset(offset: GradientStopOffset): boolean {
  return !(offset instanceof ZeroLiteral) && offset.repr instanceof PercentageLiteral && offset.repr.value === 100;
}

function isSideExtent(extent: RadialExtent): extent is 'closest-side' | 'farthest-side' {
  return extent === 'closest-side' || extent === 'farthest-side';
}

function radialGradientCenter(
  position: PositionValue,
  boxSize: GradientBoxSize,
  stage: ValueStage,
  context: GradientValueContext,
): RadialCenter | undefined {
  if (position.repr.offsets === undefined) {
    return undefined;
  }

  const horizontal = resolveLengthPercentageInPixels(position.repr.offsets[0], boxSize.width, stage, context);
  const vertical = resolveLengthPercentageInPixels(position.repr.offsets[1], boxSize.height, stage, context);

  return horizontal === undefined || vertical === undefined
    ? undefined
    : [horizontal, vertical];
}

function resolveRadialRadii(
  shape: RadialShape,
  radii: RadialRadiiSize['radii'],
  boxSize: GradientBoxSize,
  stage: ValueStage,
  context: GradientValueContext,
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
    return shape === 'ellipse' &&
      isSideExtent(horizontalExtent) &&
      isSideExtent(verticalExtent)
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
  context: GradientValueContext,
): number | undefined {
  const resolved = value.resolve(stage, { ...context, percentageReferenceValue: new LengthLiteral(percentageBasis, 'px') }).repr;
  return resolved instanceof LengthLiteral && resolved.unit === 'px' ? resolved.value : undefined;
}

function resolveStopOffset(
  offset: GradientStopOffset,
  stage: ValueStage,
  context: GradientValueContext,
): GradientStopOffset {
  if (offset instanceof ZeroLiteral) {
    return stage < ValueStage.Used ? offset : new AnglePercentageValue(new AngleLiteral(0, 'deg'));
  }
  return offset.resolve(stage, context);
}

function isComparableGradientStopOffset(
  offset: GradientStopOffset,
  conic: boolean,
): offset is ExplicitGradientStopOffset {
  const literal = offset instanceof ZeroLiteral ? offset : offset.repr;
  return literal instanceof PercentageLiteral || (conic
    ? literal instanceof AngleLiteral && literal.unit === 'deg'
    : literal instanceof LengthLiteral && literal.unit === 'px');
}

function isCanonicalAngle(value: LinearGradientDirection): value is AngleValue<CanonicalAngleLiteral> {
  return value instanceof AngleValue && value.repr instanceof AngleLiteral && value.repr.unit === 'deg';
}

function isExplicitLengthPercentage(value: LengthPercentageValue): value is ExplicitLengthPercentage {
  return value.repr instanceof PercentageLiteral || value.repr instanceof LengthLiteral && value.repr.unit === 'px';
}

function isExplicitGradientPosition(position: PositionValue): position is ExplicitGradientPosition {
  return position.repr.offsets !== undefined && position.repr.offsets.every(isExplicitLengthPercentage);
}

function explicitGradientPosition(center: RadialCenter): ExplicitGradientPosition {
  return new PositionValue({ offsets: mapTuple(center, (offset) => new LengthPercentageValue(new LengthLiteral(offset, 'px'))) });
}

function interpolateExplicitGradientPosition(
  a: ExplicitGradientPosition,
  b: ExplicitGradientPosition,
  progress: number,
  context: GradientValueContext,
): ExplicitGradientPosition {
  return new PositionValue({ offsets: interpolateLengthTuple(a.repr.offsets, b.repr.offsets, progress, context) });
}

function interpolateLengthTuple(
  a: [ExplicitLengthPercentage, ExplicitLengthPercentage],
  b: [ExplicitLengthPercentage, ExplicitLengthPercentage],
  progress: number,
  context: GradientValueContext,
): [ExplicitLengthPercentage, ExplicitLengthPercentage] {
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
  a: ExplicitLengthPercentage,
  b: ExplicitLengthPercentage,
  progress: number,
  percentageBasis: number | undefined,
  context: GradientValueContext,
): ExplicitLengthPercentage {
  if (a.repr.type === b.repr.type) return interpolateExplicitGradientStopOffset(a, b, progress);

  if (percentageBasis === undefined) {
    throw new InternalError('Gradient interpolation requires a percentage basis');
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
    throw new InternalError('Gradient interpolation could not resolve its geometry');
  }

  return new LengthPercentageValue(new LengthLiteral(interpolateNumber(resolvedA, resolvedB, progress), 'px'));
}

function areIdenticalAbsoluteColors(a: AbsoluteColor, b: AbsoluteColor): boolean {
  return a.space.name === b.space.name &&
    a.alpha === b.alpha &&
    a.isLegacySrgb === b.isLegacySrgb &&
    a.is8Bit === b.is8Bit &&
    a.components.length === b.components.length &&
    a.components.every((component, index) => component === b.components[index]);
}

function interpolateExplicitGradientStopOffset<Offset extends ExplicitGradientStopOffset>(
  a: Offset,
  b: Offset,
  progress: number,
): Offset {
  const first = a.repr;
  const second = b.repr;
  if (first.type !== second.type) {
    throw new InternalError('Explicit gradient stop offsets must use the same unit');
  }

  const number = interpolateNumber(first.value, second.value, progress);
  return (a instanceof AnglePercentageValue
    ? new AnglePercentageValue(first instanceof PercentageLiteral
      ? new PercentageLiteral(number) : new AngleLiteral(number, 'deg'))
    : new LengthPercentageValue(first instanceof PercentageLiteral
      ? new PercentageLiteral(number) : new LengthLiteral(number, 'px'))) as Offset;
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
