import { mapTuple } from '../../shared/util';
import { type TokenCursor, type TryConsumer, type TryConsumerResult } from '../syntax/token-cursor';
import {
  adaptConsumer, allOf, one, oneOf, repeat, sequenceOf, withTrivia,
} from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import { ValueStage } from '../value-processing/stage';
import { createKeywordConsumer } from './keyword';
import {
  addLengthPercentages, interpolateLengthPercentages, resolveLengthPercentage,
  serializeLengthPercentage, consumeLengthPercentage,
  type LengthPercentageValue,
} from './length-percentage';
import type { MathContext } from './math-value';

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

export type PositionValue =
  | PositionOffsets
  | PositionOne
  | PositionTwo
  | PositionFour;

export type PositionOffsets = {
  type: 'position';
  offsets: PositionOffsetTuple;
};

export type PositionOffsetTuple = [
  horizontal: LengthPercentageValue,
  vertical: LengthPercentageValue,
];

export type PositionOne = {
  type: 'position';
  offsets?: never;
  components: PositionOneComponents;
};

export type PositionTwo = {
  type: 'position';
  offsets?: never;
  components: PositionTwoComponents;
};

export type PositionFour = {
  type: 'position';
  offsets?: never;
  components: PositionFourComponents;
};

export type PositionContext = {
  writingMode?: PositionWritingMode;
  direction?: PositionDirection;
} & MathContext;

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

export function positionLiteral<
  const Components extends
    | PositionOneComponents
    | PositionTwoComponents
    | PositionFourComponents,
>(...components: Components): {
  type: 'position';
  offsets?: never;
  components: Components;
} {
  return { type: 'position', components };
}

type PositionKeyword =
  | PositionEdgeKeyword
  | 'center';

type PositionEdgeKeyword =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'x-start' | 'x-end' | 'y-start' | 'y-end'
  | 'block-start' | 'block-end'
  | 'inline-start' | 'inline-end'
  | 'start' | 'end';

function isPositionKeyword(
  component: PositionComponent,
): component is PositionKeyword {
  return typeof component === 'string';
}

export function parsePosition(
  input: ParserInput,
  context: PositionContext = {},
): PositionValue | null {
  return positionParser(input, context);
}

export function consumePosition(
  c: TokenCursor,
): TryConsumerResult<PositionValue> {
  return positionConsumer(c);
}

// =============================================================================
// Syntax
// =============================================================================

// <position-one> = left | center | right | top | bottom | x-start | x-end | y-start | y-end | block-start | block-end | inline-start | inline-end | <length-percentage>
const positionOneConsumer: TryConsumer<PositionOne> = oneOf(
  [
    one(createKeywordConsumer(
      'left', 'center', 'right', 'top', 'bottom',
      'x-start', 'x-end', 'y-start', 'y-end',
      'block-start', 'block-end',
      'inline-start', 'inline-end',
    )),
    one(consumeLengthPercentage),
  ],
  ([component]) => ({
    type: 'position',
    components: [component],
  }),
);

// <position-two> = [ [ left | center | right | x-start | x-end ] && [ top | center | bottom | y-start | y-end ] | [ left | center | right | x-start | x-end | <length-percentage> ] [ top | center | bottom | y-start | y-end | <length-percentage> ] | [ block-start | center | block-end ] && [ inline-start | center | inline-end ] | [ start | center | end ]{2} ]
const positionTwoConsumer: TryConsumer<PositionTwo> = oneOf(
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
            one(consumeLengthPercentage),
          ],
          ([horizontal]) => horizontal,
        )),
        one(withTrivia(oneOf(
          [
            one(createKeywordConsumer('top', 'center', 'bottom', 'y-start', 'y-end')),
            one(consumeLengthPercentage),
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
    type: 'position',
    components: components as PositionTwoComponents,
  }),
);

// <position-four> = [ [ [ left | right | x-start | x-end ] <length-percentage> ] && [ [ top | bottom | y-start | y-end ] <length-percentage> ] | [ [ block-start | block-end ] <length-percentage> ] && [ [ inline-start | inline-end ] <length-percentage> ] | [ [ start | end ] <length-percentage> ]{2} ]
const positionFourConsumer: TryConsumer<PositionFour> = oneOf(
  [
    one(allOf(
      [
        one(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer(
              'left', 'right', 'x-start', 'x-end',
            ))),
            one(withTrivia(consumeLengthPercentage)),
          ],
          ([[edge], [offset]]) => [edge, offset] as const,
        )),
        one(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer(
              'top', 'bottom', 'y-start', 'y-end',
            ))),
            one(withTrivia(consumeLengthPercentage)),
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
            one(withTrivia(consumeLengthPercentage)),
          ],
          ([[edge], [offset]]) => [edge, offset] as const,
        )),
        one(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer('inline-start', 'inline-end'))),
            one(withTrivia(consumeLengthPercentage)),
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
            one(withTrivia(consumeLengthPercentage)),
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
    type: 'position',
    components: components as PositionFourComponents,
  }),
);

// <position> = <position-one> | <position-two> | <position-four>
const positionConsumer: TryConsumer<PositionValue> = oneOf(
  [
    one(positionFourConsumer),
    one(positionTwoConsumer),
    one(positionOneConsumer),
  ],
  ([value]) => value,
);

const positionParser = createComponentParser(withTrivia(positionConsumer));

// ████████  ████████  ██████   ███████  ██       ██     ██ ████████
// ██     ██ ██       ██    ██ ██     ██ ██       ██     ██ ██
// ██     ██ ██       ██       ██     ██ ██       ██     ██ ██
// ████████  ██████    ██████  ██     ██ ██       ██     ██ ██████
// ██   ██   ██             ██ ██     ██ ██        ██   ██  ██
// ██    ██  ██       ██    ██ ██     ██ ██         ██ ██   ██
// ██     ██ ████████  ██████   ███████  ████████    ███    ████████

export function resolvePosition(
  value: PositionValue,
  stage: ValueStage,
  context: PositionContext = {},
): PositionValue {
  if (value.offsets !== undefined) {
    return {
      type: 'position',
      offsets: mapTuple(value.offsets, (offset) =>
        resolveLengthPercentage(offset, stage, context)),
    };
  }

  const resolved = {
    type: 'position',
    components: mapTuple(value.components, (component) =>
      isPositionKeyword(component)
        ? component
        : resolveLengthPercentage(component, stage, context)),
  } as PositionSyntax;

  return stage < ValueStage.Computed
    ? resolved
    : positionOffsets(resolved, context) ?? resolved;
}

export function tryResolvePositionOffsets(
  value: PositionValue,
  stage: ValueStage,
  context: PositionContext = {},
): PositionOffsets | null {
  const resolved = resolvePosition(value, stage, context);

  return resolved.offsets !== undefined ? resolved : null;
}

function positionOffsets(
  value: PositionSyntax,
  context: PositionContext,
): PositionOffsets | null {
  const { components } = value;

  switch (components.length) {
    case 1:
      return positionOneOffsets(components[0], context);
    case 2:
      return positionTwoOffsets(components, context);
    case 4:
      return positionFourOffsets(components, context);
  }
}

function positionOneOffsets(
  component: PositionComponent,
  context: PositionContext,
): PositionOffsets | null {
  if (!isPositionKeyword(component)) {
    return createPositionOffsets(component, CENTER);
  }

  if (component === 'center') {
    return createPositionOffsets(CENTER, CENTER);
  }

  const edge = physicalEdge(component, undefined, context);

  if (edge === null) {
    return null;
  }

  const offset = isEndEdge(edge) ? FULL : ZERO;

  return physicalAxis(edge) === 'horizontal'
    ? createPositionOffsets(offset, CENTER)
    : createPositionOffsets(CENTER, offset);
}

function positionTwoOffsets(
  components: PositionTwoComponents,
  context: PositionContext,
): PositionOffsets | null {
  const axes: [PositionAxis, PositionAxis] = usesLogicalAxisOrder(components)
    ? ['block', 'inline']
    : ['x', 'y'];
  const first = positionComponentOffset(components[0], axes[0], context);
  const second = positionComponentOffset(components[1], axes[1], context);

  return orderPositionOffsets(first, second);
}

function positionFourOffsets(
  [firstEdge, firstOffset, secondEdge, secondOffset]: PositionFourComponents,
  context: PositionContext,
): PositionOffsets | null {
  const axes: [PositionAxis, PositionAxis] = usesLogicalAxisOrder([
    firstEdge,
    secondEdge,
  ])
    ? ['block', 'inline']
    : ['x', 'y'];
  const first = positionEdgeOffset(firstEdge, firstOffset, axes[0], context);
  const second = positionEdgeOffset(secondEdge, secondOffset, axes[1], context);

  return orderPositionOffsets(first, second);
}

function orderPositionOffsets(
  first: PositionedOffset | null,
  second: PositionedOffset | null,
): PositionOffsets | null {
  if (first === null || second === null || first.axis === second.axis) {
    return null;
  }

  return first.axis === 'horizontal'
    ? createPositionOffsets(first.offset, second.offset)
    : createPositionOffsets(second.offset, first.offset);
}

type PositionedOffset = {
  axis: PhysicalAxis;
  offset: LengthPercentageValue;
};

function positionComponentOffset(
  component: PositionComponent,
  axis: PositionAxis,
  context: PositionContext,
): PositionedOffset | null {
  const resolvedAxis = resolvePositionAxis(axis, context);

  if (resolvedAxis === null) {
    return null;
  }

  if (!isPositionKeyword(component)) {
    return { axis: resolvedAxis, offset: component };
  }

  if (component === 'center') {
    return { axis: resolvedAxis, offset: CENTER };
  }

  const edge = physicalEdge(component, axis, context);

  return edge === null || physicalAxis(edge) !== resolvedAxis
    ? null
    : { axis: resolvedAxis, offset: isEndEdge(edge) ? FULL : ZERO };
}

function positionEdgeOffset(
  keyword: PositionEdgeKeyword,
  offset: LengthPercentageValue,
  axis: PositionAxis,
  context: PositionContext,
): PositionedOffset | null {
  const edge = physicalEdge(keyword, axis, context);

  if (edge === null) {
    return null;
  }

  return {
    axis: physicalAxis(edge),
    offset: isEndEdge(edge)
      ? addLengthPercentages(
        FULL,
        negateLengthPercentage(offset, context),
        context,
      )
      : offset,
  };
}

function negateLengthPercentage(
  value: LengthPercentageValue,
  context: PositionContext,
): LengthPercentageValue {
  if (value.type !== 'math') {
    if (value.type === 'percentage') {
      return { type: 'percentage', value: 0 - value.value };
    }

    return value.unit === ''
      ? value
      : { type: 'length', value: 0 - value.value, unit: value.unit };
  }

  return interpolateLengthPercentages(ZERO, value, -1, context);
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
      return isLogicalAxis(axis)
        ? logicalAxisStartEdge(axis, context)
        : null;
    case 'end':
      return isLogicalAxis(axis)
        ? oppositeEdge(logicalAxisStartEdge(axis, context))
        : null;
  }
}

const PositionAxisSet = new Set(['x', 'y', 'block', 'inline'] as const);
const LogicalAxisSet = new Set(['block', 'inline'] as const);

type SetElement<Set> = Set extends ReadonlySet<infer Element> ? Element : never;
type PositionAxis = SetElement<typeof PositionAxisSet>;
type LogicalAxis = SetElement<typeof LogicalAxisSet>;
type PhysicalAxis = 'horizontal' | 'vertical';
type PhysicalEdge = 'left' | 'right' | 'top' | 'bottom';

function isPositionAxis(value: unknown): value is PositionAxis {
  return typeof value === 'string' && PositionAxisSet.has(value as PositionAxis);
}

function isLogicalAxis(value: unknown): value is LogicalAxis {
  return typeof value === 'string' && LogicalAxisSet.has(value as LogicalAxis);
}

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

function createPositionOffsets(
  horizontal: LengthPercentageValue,
  vertical: LengthPercentageValue,
): PositionOffsets {
  return {
    type: 'position',
    offsets: [horizontal, vertical],
  };
}

function usesLogicalAxisOrder(
  components: readonly PositionComponent[],
): boolean {
  return components.some((component) => {
    if (!isPositionKeyword(component)) {
      return false;
    }

    return component === 'start' ||
      component === 'end' ||
      isLogicalAxis(positionKeywordAxis(component));
  });
}

function positionKeywordAxis(keyword: PositionKeyword): PositionAxis | null {
  if (keyword === 'left' || keyword === 'right') {
    return 'x';
  }

  if (keyword === 'top' || keyword === 'bottom') {
    return 'y';
  }

  const axis = keyword.split('-', 1)[0];

  return isPositionAxis(axis) ? axis : null;
}

const ZERO = { type: 'percentage', value: 0 } as const;
const CENTER = { type: 'percentage', value: 50 } as const;
const FULL = { type: 'percentage', value: 100 } as const;

//  ██████  ████████ ████████  ████    ███    ██
// ██    ██ ██       ██     ██  ██    ██ ██   ██
// ██       ██       ██     ██  ██   ██   ██  ██
//  ██████  ██████   ████████   ██  ██     ██ ██
//       ██ ██       ██   ██    ██  █████████ ██
// ██    ██ ██       ██    ██   ██  ██     ██ ██
//  ██████  ████████ ██     ██ ████ ██     ██ ████████

export function serializePosition(value: PositionValue): string {
  let components: readonly PositionComponent[] = value.offsets !== undefined
    ? value.offsets
    : value.components;

  if (components.length === 1) {
    const component = components[0]!;
    const axis = isPositionKeyword(component)
      ? positionKeywordAxis(component)
      : 'x';

    components = axis === 'y' || axis === 'inline'
      ? ['center', component]
      : [component, 'center'];
  }

  return components
    .map((component) => isPositionKeyword(component)
      ? component
      : serializeLengthPercentage(component))
    .join(' ');
}

//  ██████   ███████  ███    ███ ████████  ████ ██    ██ ████████
// ██       ██     ██ ████  ████ ██     ██  ██  ███   ██ ██
// ██       ██     ██ ██ ████ ██ ██     ██  ██  ████  ██ ██
// ██       ██     ██ ██  ██  ██ ████████   ██  ██ ██ ██ ██████
// ██       ██     ██ ██      ██ ██     ██  ██  ██  ████ ██
// ██       ██     ██ ██      ██ ██     ██  ██  ██   ███ ██
//  ██████   ███████  ██      ██ ████████  ████ ██    ██ ████████

export function addPositions(
  a: PositionOffsets,
  b: PositionOffsets,
  context: MathContext = {},
): PositionOffsets {
  return createPositionOffsets(
    addLengthPercentages(a.offsets[0], b.offsets[0], context),
    addLengthPercentages(a.offsets[1], b.offsets[1], context),
  );
}

export function interpolatePositions(
  a: PositionOffsets,
  b: PositionOffsets,
  progress: number,
  context: MathContext = {},
): PositionOffsets {
  return createPositionOffsets(
    interpolateLengthPercentages(a.offsets[0], b.offsets[0], progress, context),
    interpolateLengthPercentages(a.offsets[1], b.offsets[1], progress, context),
  );
}

export function accumulatePositions(
  a: PositionOffsets,
  b: PositionOffsets,
  context: MathContext = {},
): PositionOffsets {
  return addPositions(a, b, context);
}
