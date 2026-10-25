import { mapTuple } from '../../infra/util';
import { InternalError } from '../../infra/internal-error';

import {
  createKeywordConsumer, adaptConsumer, allOf, one, oneOf, repeat, sequenceOf, withTrivia, createComponentParser,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import { ValueStage, type ValueContext } from '../value-processing/index';
import { LengthLiteral, PercentageLiteral } from './numeric-literal/index';

import type { Value } from './value';
import { LengthPercentageValue } from './length-percentage';
import { MathValue, type MathContext } from './math-value';

/** A position retaining keywords until its writing-mode inputs can produce offsets. */
// https://drafts.csswg.org/css-values-4/#position
export class PositionValue<R extends Position = Position> implements Value<PositionValueContext> {
  /** The specified components or resolved physical offsets. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete <position>. */
  static parse(input: ParserInput, context: PositionValueContext): PositionValue | null {
    return positionParser(input, context);
  }

  /** Consume one position in its existing one-, two-, or four-component grammar. */
  static consume(this: void, c: TokenCursor<ComponentValue, PositionValueContext>): TryConsumerResult<PositionValue> {
    return positionConsumer(c);
  }

  /** Construct a position from already interpreted components. */
  static fromComponents(
    ...components: PositionOneComponents | PositionTwoComponents | PositionFourComponents
  ): PositionValue {
    return new PositionValue({ components } as PositionSyntax);
  }

  static #resolveOffsets(
    components: PositionSyntax['components'], context: PositionValueContext,
  ): PositionOffsets | null {
    if (components.length === 1) {
      const component = components[0];
      if (typeof component !== 'string') return { offsets: [component, CENTER] };
      if (component === 'center') return { offsets: [CENTER, CENTER] };

      const edge = physicalEdge(component, undefined, context);
      if (edge === null) return null;
      const offset = isEndEdge(edge) ? FULL : ZERO;
      return { offsets: physicalAxis(edge) === 'horizontal' ? [offset, CENTER] : [CENTER, offset] };
    }

    const logicalOrder = components.some((component) => {
      if (typeof component !== 'string') return false;
      const axis = PositionKeywordAxes[component];
      return component === 'start' || component === 'end' || axis === 'block' || axis === 'inline';
    });
    const firstAxis = logicalOrder ? 'block' : 'x';
    const secondAxis = logicalOrder ? 'inline' : 'y';
    const first = components.length === 2
      ? PositionValue.#componentOffset(components[0], firstAxis, context)
      : PositionValue.#edgeOffset(components[0], components[1], firstAxis, context);
    const second = components.length === 2
      ? PositionValue.#componentOffset(components[1], secondAxis, context)
      : PositionValue.#edgeOffset(components[2], components[3], secondAxis, context);

    if (first === null || second === null || first.axis === second.axis) return null;
    return { offsets: first.axis === 'horizontal' ? [first.offset, second.offset] : [second.offset, first.offset] };
  }

  static #componentOffset(
    component: PositionComponent, axis: PositionAxis, context: PositionContext,
  ): PositionedOffset | null {
    const resolvedAxis = resolvePositionAxis(axis, context);
    if (resolvedAxis === null) return null;
    if (typeof component !== 'string') return { axis: resolvedAxis, offset: component };
    if (component === 'center') return { axis: resolvedAxis, offset: CENTER };

    const edge = physicalEdge(component, axis, context);
    return edge === null || physicalAxis(edge) !== resolvedAxis
      ? null
      : { axis: resolvedAxis, offset: isEndEdge(edge) ? FULL : ZERO };
  }

  static #edgeOffset(
    keyword: PositionEdgeKeyword, offset: LengthPercentageValue, axis: PositionAxis, context: PositionValueContext,
  ): PositionedOffset | null {
    const edge = physicalEdge(keyword, axis, context);
    if (edge === null) return null;

    return {
      axis: physicalAxis(edge),
      offset: isEndEdge(edge) ? FULL.add(negateLengthPercentage(offset, context), context) : offset,
    };
  }

  /** Resolve components, then map logical edges when the required context is present. */
  resolve(stage: ValueStage, context: PositionValueContext): PositionValue {
    const previous: Position = this.repr;
    if (previous.offsets !== undefined) {
      const [x, y] = previous.offsets;
      const horizontal = x.resolve(stage, context);
      const vertical = y.resolve(stage, context);
      return horizontal === x && vertical === y
        ? this : new PositionValue({ offsets: [horizontal, vertical] });
    }
    const components = mapTuple(previous.components, (component) =>
      typeof component === 'string' ? component : component.resolve(stage, context));
    const unchanged = components.every((component, i) => component === previous.components[i]);
    const syntax = unchanged ? previous : { components } as PositionSyntax;
    const resolved = stage < ValueStage.Computed ? syntax : PositionValue.#resolveOffsets(syntax.components, context) ?? syntax;
    return resolved === previous ? this : new PositionValue(resolved);
  }

  /** Return resolved offsets, or null while logical-axis context is unavailable. */
  tryResolveOffsets(stage: ValueStage, context: PositionValueContext): PositionValue<PositionOffsets> | null {
    const resolved = this.resolve(stage, context);
    return resolved.repr.offsets === undefined ? null : resolved as PositionValue<PositionOffsets>;
  }

  /** Serialize the current components or offsets without resolving them. */
  serialize(): string {
    const value = this.repr;
    const components: PositionComponent[] = value.offsets !== undefined
      ? value.offsets
      : value.components;

    if (components.length === 1) {
      const component = components[0]!;
      const axis = typeof component === 'string' ? PositionKeywordAxes[component] : 'x';
      const text = typeof component === 'string' ? component : component.serialize();

      return axis === 'y' || axis === 'inline' ? `center ${text}` : `${text} center`;
    }

    return components
      .map((component) => typeof component === 'string'
        ? component
        : component.serialize())
      .join(' ');
  }

  /** Add physical offsets after logical edges have been resolved. */
  add(
    other: PositionValue, context: MathContext,
  ): PositionValue<PositionOffsets> {
    const a = this.repr.offsets;
    const b = other.repr.offsets;
    if (a === undefined || b === undefined) throw new InternalError('Position combination requires resolved physical offsets');
    return new PositionValue({ offsets: [a[0].add(b[0], context), a[1].add(b[1], context)] });
  }

  /** Interpolate resolved physical offsets. */
  interpolate(
    other: PositionValue, progress: number,
    context: MathContext,
  ): PositionValue<PositionOffsets> {
    const a = this.repr.offsets;
    const b = other.repr.offsets;
    if (a === undefined || b === undefined) throw new InternalError('Position combination requires resolved physical offsets');
    return new PositionValue({
      offsets: [
        a[0].interpolate(b[0], progress, context),
        a[1].interpolate(b[1], progress, context),
      ],
    });
  }

  /** Accumulation is addition. */
  accumulate(
    other: PositionValue, context: MathContext,
  ): PositionValue<PositionOffsets> {
    return this.add(other, context);
  }
}

type Position =
  | PositionOffsets
  | PositionOne
  | PositionTwo
  | PositionFour;

export type PositionOffsets = {
  offsets: PositionOffsetTuple;
};

export type PositionOffsetTuple = [
  horizontal: LengthPercentageValue,
  vertical: LengthPercentageValue,
];

export type PositionOne = {
  offsets?: never;
  components: PositionOneComponents;
};

export type PositionTwo = {
  offsets?: never;
  components: PositionTwoComponents;
};

export type PositionFour = {
  offsets?: never;
  components: PositionFourComponents;
};

export interface PositionContext extends ValueContext {
  writingMode?: PositionWritingMode;
  direction?: PositionDirection;
}

export type PositionValueContext = PositionContext & MathContext;

export type PositionWritingMode =
  | 'horizontal-tb'
  | 'vertical-rl'
  | 'vertical-lr'
  | 'sideways-rl'
  | 'sideways-lr';

export type PositionDirection = 'ltr' | 'rtl';

type PositionSyntax = PositionOne | PositionTwo | PositionFour;

type PositionOneComponents = [PositionComponent];

type PositionTwoComponents = [first: PositionComponent, second: PositionComponent];

type PositionFourComponents = [
  firstEdge: PositionEdgeKeyword,
  firstOffset: LengthPercentageValue,
  secondEdge: PositionEdgeKeyword,
  secondOffset: LengthPercentageValue,
];

type PositionComponent = PositionKeyword | LengthPercentageValue;

type PositionKeyword =
  | PositionEdgeKeyword
  | 'center';

type PositionEdgeKeyword =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'x-start' | 'x-end' | 'y-start' | 'y-end'
  | 'block-start' | 'block-end'
  | 'inline-start' | 'inline-end'
  | 'start' | 'end';

function negateLengthPercentage(
  value: LengthPercentageValue,
  context: PositionValueContext,
): LengthPercentageValue {
  const literal = value.repr;
  if (!(literal instanceof MathValue)) {
    return new LengthPercentageValue(literal instanceof PercentageLiteral
      ? new PercentageLiteral(0 - literal.value)
      : literal.unit === '' ? literal : new LengthLiteral(0 - literal.value, literal.unit));
  }
  return ZERO.interpolate(value, -1, context);
}

function physicalEdge(
  keyword: Exclude<PositionKeyword, 'center'>,
  axis: PositionAxis | undefined,
  context: PositionContext,
): PhysicalEdge | null {
  switch (keyword) {
    case 'left':
    case 'right':
    case 'top':
    case 'bottom':
      return keyword;
    case 'x-start':
      return physicalAxisStartEdge('horizontal', context);
    case 'x-end':
      return oppositeEdge(physicalAxisStartEdge('horizontal', context));
    case 'y-start':
      return physicalAxisStartEdge('vertical', context);
    case 'y-end':
      return oppositeEdge(physicalAxisStartEdge('vertical', context));
    case 'block-start':
      return logicalAxisStartEdge('block', context);
    case 'block-end':
      return oppositeEdge(logicalAxisStartEdge('block', context));
    case 'inline-start':
      return logicalAxisStartEdge('inline', context);
    case 'inline-end':
      return oppositeEdge(logicalAxisStartEdge('inline', context));
    case 'start':
    case 'end': {
      if (axis !== 'block' && axis !== 'inline') return null;
      const edge = logicalAxisStartEdge(axis, context);
      return keyword === 'start' ? edge : oppositeEdge(edge);
    }
  }
}

type PositionAxis = 'x' | 'y' | 'block' | 'inline';
type LogicalAxis = 'block' | 'inline';
type PhysicalAxis = 'horizontal' | 'vertical';
type PhysicalEdge = 'left' | 'right' | 'top' | 'bottom';

type PositionedOffset = {
  axis: PhysicalAxis;
  offset: LengthPercentageValue;
};

const PositionKeywordAxes = {
  left: 'x', right: 'x', 'x-start': 'x', 'x-end': 'x',
  top: 'y', bottom: 'y', 'y-start': 'y', 'y-end': 'y',
  'block-start': 'block', 'block-end': 'block',
  'inline-start': 'inline', 'inline-end': 'inline',
  center: null, start: null, end: null,
} as const satisfies Record<PositionKeyword, PositionAxis | null>;

const PositionStartEdges = {
  'horizontal-tb': { block: 'top',   inline: { ltr: 'left',   rtl: 'right' } },
  'vertical-rl':   { block: 'right', inline: { ltr: 'top',    rtl: 'bottom' } },
  'vertical-lr':   { block: 'left',  inline: { ltr: 'top',    rtl: 'bottom' } },
  'sideways-rl':   { block: 'right', inline: { ltr: 'top',    rtl: 'bottom' } },
  'sideways-lr':   { block: 'left',  inline: { ltr: 'bottom', rtl: 'top' } },
} as const satisfies Record<PositionWritingMode, {
  block: PhysicalEdge;
  inline: Record<PositionDirection, PhysicalEdge>;
}>;

const OppositePhysicalEdges = {
  left: 'right', right: 'left', top: 'bottom', bottom: 'top',
} as const satisfies Record<PhysicalEdge, PhysicalEdge>;

function resolvePositionAxis(
  axis: PositionAxis,
  context: PositionContext,
): PhysicalAxis | null {
  if (axis === 'x') {
    return 'horizontal';
  }

  if (axis === 'y') {
    return 'vertical';
  }

  const { writingMode } = context;

  if (writingMode === undefined) {
    return null;
  }

  return writingMode === 'horizontal-tb'
    ? axis === 'block' ? 'vertical' : 'horizontal'
    : axis === 'block' ? 'horizontal' : 'vertical';
}

function physicalAxisStartEdge(
  axis: PhysicalAxis,
  context: PositionContext,
): PhysicalEdge | null {
  const { writingMode } = context;

  if (writingMode === undefined) {
    return null;
  }

  const logicalAxis: LogicalAxis =
    writingMode === 'horizontal-tb'
      ? axis === 'horizontal' ? 'inline' : 'block'
      : axis === 'horizontal' ? 'block' : 'inline';
  return logicalAxisStartEdge(logicalAxis, context);
}

function logicalAxisStartEdge(
  axis: LogicalAxis,
  context: PositionContext,
): PhysicalEdge | null {
  const { writingMode, direction } = context;

  if (writingMode === undefined) {
    return null;
  }

  if (axis === 'block') {
    return PositionStartEdges[writingMode].block;
  }

  return direction === undefined
    ? null
    : PositionStartEdges[writingMode].inline[direction];
}

function oppositeEdge(edge: PhysicalEdge | null): PhysicalEdge | null {
  return edge === null ? null : OppositePhysicalEdges[edge];
}

function physicalAxis(edge: PhysicalEdge): PhysicalAxis {
  return edge === 'left' || edge === 'right'
    ? 'horizontal'
    : 'vertical';
}

function isEndEdge(edge: PhysicalEdge): boolean {
  return edge === 'right' || edge === 'bottom';
}

const ZERO = new LengthPercentageValue(new PercentageLiteral(0));
const CENTER = new LengthPercentageValue(new PercentageLiteral(50));
const FULL = new LengthPercentageValue(new PercentageLiteral(100));

/*
 * <position> = <position-one> | <position-two> | <position-four>
 *
 * <position-one> = [
 *   left | center | right | top | bottom |
 *   x-start | x-end | y-start | y-end |
 *   block-start | block-end | inline-start | inline-end |
 *   <length-percentage>
 * ]
 *
 * <position-two> = [
 *   [ left | center | right | x-start | x-end ] &&
 *   [ top | center | bottom | y-start | y-end ]
 * |
 *   [ left | center | right | x-start | x-end | <length-percentage> ]
 *   [ top | center | bottom | y-start | y-end | <length-percentage> ]
 * |
 *   [ block-start | center | block-end ] &&
 *   [ inline-start | center | inline-end ]
 * |
 *   [ start | center | end ]{2}
 * ]
 *
 * <position-four> = [
 *   [ [ left | right | x-start | x-end ] <length-percentage> ] &&
 *   [ [ top | bottom | y-start | y-end ] <length-percentage> ]
 * |
 *   [ [ block-start | block-end ] <length-percentage> ] &&
 *   [ [ inline-start | inline-end ] <length-percentage> ]
 * |
 *   [ [ start | end ] <length-percentage> ]{2}
 * ]
 */

// <position-one> = left | center | right | top | bottom | x-start | x-end | y-start | y-end | block-start | block-end | inline-start | inline-end | <length-percentage>
const positionOneConsumer: TryConsumer<PositionOne, PositionValueContext> = oneOf(
  [
    one(createKeywordConsumer(
      'left', 'center', 'right', 'top', 'bottom',
      'x-start', 'x-end', 'y-start', 'y-end',
      'block-start', 'block-end',
      'inline-start', 'inline-end',
    )),
    one(LengthPercentageValue.consume),
  ],
  ([component]) => ({
    components: [component],
  }),
);

// <position-two> = [ [ left | center | right | x-start | x-end ] && [ top | center | bottom | y-start | y-end ] | [ left | center | right | x-start | x-end | <length-percentage> ] [ top | center | bottom | y-start | y-end | <length-percentage> ] | [ block-start | center | block-end ] && [ inline-start | center | inline-end ] | [ start | center | end ]{2} ]
const positionTwoConsumer: TryConsumer<PositionTwo, PositionValueContext> = oneOf(
  // Expand the unordered conjunctions because both operands can consume
  // `center`: H && V = H V | V H, and B && I = B I | I B.
  [
    one(sequenceOf(
      [
        one(createKeywordConsumer('left', 'center', 'right', 'x-start', 'x-end')),
        one(withTrivia(createKeywordConsumer(
          'top', 'center', 'bottom', 'y-start', 'y-end',
        ))),
      ],
      ([[horizontal], [vertical]]) => [horizontal, vertical],
    )),
    one(sequenceOf(
      [
        one(createKeywordConsumer('top', 'center', 'bottom', 'y-start', 'y-end')),
        one(withTrivia(createKeywordConsumer(
          'left', 'center', 'right', 'x-start', 'x-end',
        ))),
      ],
      ([[vertical], [horizontal]]) => [horizontal, vertical],
    )),
    one(sequenceOf(
      [
        one(oneOf(
          [
            one(createKeywordConsumer('left', 'center', 'right', 'x-start', 'x-end')),
            one(LengthPercentageValue.consume),
          ],
          ([horizontal]) => horizontal,
        )),
        one(withTrivia(oneOf(
          [
            one(createKeywordConsumer('top', 'center', 'bottom', 'y-start', 'y-end')),
            one(LengthPercentageValue.consume),
          ],
          ([vertical]) => vertical,
        ))),
      ],
      ([[horizontal], [vertical]]) => [horizontal, vertical],
    )),
    one(sequenceOf(
      [
        one(createKeywordConsumer('block-start', 'center', 'block-end')),
        one(withTrivia(createKeywordConsumer(
          'inline-start', 'center', 'inline-end',
        ))),
      ],
      ([[block], [inline]]) => [block, inline],
    )),
    one(sequenceOf(
      [
        one(createKeywordConsumer('inline-start', 'center', 'inline-end')),
        one(withTrivia(createKeywordConsumer(
          'block-start', 'center', 'block-end',
        ))),
      ],
      ([[inline], [block]]) => [block, inline],
    )),
    one(repeat(
      withTrivia(createKeywordConsumer('start', 'center', 'end')),
      2,
      2,
    )),
  ],
  ([components]): PositionTwo => ({
    components: components as PositionTwoComponents,
  }),
);

// <position-four> = [ [ [ left | right | x-start | x-end ] <length-percentage> ] && [ [ top | bottom | y-start | y-end ] <length-percentage> ] | [ [ block-start | block-end ] <length-percentage> ] && [ [ inline-start | inline-end ] <length-percentage> ] | [ [ start | end ] <length-percentage> ]{2} ]
const positionFourConsumer: TryConsumer<PositionFour, PositionValueContext> = oneOf(
  [
    one(allOf(
      [
        one(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer(
              'left', 'right', 'x-start', 'x-end',
            ))),
            one(withTrivia(LengthPercentageValue.consume)),
          ],
          ([[edge], [offset]]) => [edge, offset] as const,
        )),
        one(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer(
              'top', 'bottom', 'y-start', 'y-end',
            ))),
            one(withTrivia(LengthPercentageValue.consume)),
          ],
          ([[edge], [offset]]) => [edge, offset] as const,
        )),
      ],
      ([[horizontal], [vertical]]) => [
        ...horizontal,
        ...vertical,
      ] as PositionFourComponents,
    )),
    one(allOf(
      [
        one(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer('block-start', 'block-end'))),
            one(withTrivia(LengthPercentageValue.consume)),
          ],
          ([[edge], [offset]]) => [edge, offset] as const,
        )),
        one(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer('inline-start', 'inline-end'))),
            one(withTrivia(LengthPercentageValue.consume)),
          ],
          ([[edge], [offset]]) => [edge, offset] as const,
        )),
      ],
      ([[block], [inline]]) => [
        ...block,
        ...inline,
      ] as PositionFourComponents,
    )),
    one(adaptConsumer(
      repeat(
        sequenceOf(
          [
            one(withTrivia(createKeywordConsumer('start', 'end'))),
            one(withTrivia(LengthPercentageValue.consume)),
          ],
          ([[edge], [offset]]) => [edge, offset] as const,
        ),
        2,
        2,
      ),
      ([first, second]) => [
        ...first,
        ...second,
      ],
    )),
  ],
  ([components]): PositionFour => ({
    components: components as PositionFourComponents,
  }),
);

// <position> = <position-one> | <position-two> | <position-four>
const positionConsumer: TryConsumer<PositionValue, PositionValueContext> = oneOf(
  [
    one(positionFourConsumer),
    one(positionTwoConsumer),
    one(positionOneConsumer),
  ],
  ([value]) => new PositionValue(value),
);

const positionParser = createComponentParser(withTrivia(positionConsumer));
