import { asciiLower } from '../../shared/css';
import { createDelimConsumer, tryConsumeIntegerToken } from '../parser/component-consumers';
import type { ComponentCursor } from '../parser/component-cursor';
import { one, oneOf, opt, sequenceOf, withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { isIdentToken, isTokenKind } from '../parser/syntax';
import type { DimensionToken, IdentToken, NumberToken } from '../parser/tokens';
import { NumberTokenFlag, TokenKind } from '../parser/tokens';
import { createKeywordConsumer } from './keyword';
import { serializeCssNumber } from './numeric-literal/number';

export type AnPlusBValue = {
  a: number;
  b: number;
};

function createIntegerConsumer(
  sign: 'any' | 'signed' | 'signless',
): TryComponentConsumer<NumberToken> {
  return (c) => {
    const start = c.pos();
    const result = tryConsumeIntegerToken(c);

    if (result === null || isBad(result)) return result;

    const component = result.value;

    const isSigned =
      component.repr.startsWith('+') ||
      component.repr.startsWith('-');

    if (
      (sign === 'signed' && !isSigned) ||
      (sign === 'signless' && isSigned)
    ) {
      c.restore(start);
      return null;
    }

    return ok(component);
  };
}

function createIntegerDimensionConsumer(
  unitPattern: RegExp,
): TryComponentConsumer<DimensionToken> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (
      !isTokenKind(component, TokenKind.Dimension) ||
      component.flag !== NumberTokenFlag.Integer ||
      !unitPattern.test(asciiLower(component.unit))
    ) {
      c.restore(start);
      return null;
    }

    return ok(component);
  };
}

function createIdentPatternConsumer(
  valuePattern: RegExp,
): TryComponentConsumer<IdentToken> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (
      !isIdentToken(component) ||
      !valuePattern.test(asciiLower(component.value))
    ) {
      c.restore(start);
      return null;
    }

    return ok(component);
  };
}

/**
 * The spec's expanded alternatives factor into three token-disjoint forms:
 *
 * <an+b> = <an+b-atomic> | <n-expression> | <ndash-expression>
 * <an+b-atomic> = odd | even | <integer> |
 *                 <ndashdigit-dimension> |
 *                 '+'?† <ndashdigit-ident> |
 *                 <dashndashdigit-ident>
 * <n-expression> = [ <n-dimension> | '+'?† n | -n ] <offset>?
 * <ndash-expression> = [ <ndash-dimension> | '+'?† n- | -n- ]
 *                      <signless-integer>
 * <offset> = <signed-integer> | [ '+' | '-' ] <signless-integer>
 *
 * The marked optional '+' is intentionally not trivia-wrapped: CSS Syntax
 * requires it to be adjacent to the ident beginning with "n".
 */
export function tryConsumeAnPlusB(
  c: ComponentCursor,
): TryComponentConsumerResult<AnPlusBValue> {
  return consumeAnPlusB(c);
}

// <n-dimension>
const tryConsumeNDimension = createIntegerDimensionConsumer(/^n$/);

// <ndash-dimension>
const tryConsumeNDashDimension = createIntegerDimensionConsumer(/^n-$/);

// <ndashdigit-dimension>
const tryConsumeNDashDigitDimension = createIntegerDimensionConsumer(/^n-[0-9]+$/);

// <ndashdigit-ident>
const tryConsumeNDashDigitIdent = createIdentPatternConsumer(/^n-[0-9]+$/);

// <dashndashdigit-ident>
const tryConsumeDashNDashDigitIdent = createIdentPatternConsumer(/^-n-[0-9]+$/);

// <integer>
const tryConsumeInteger = createIntegerConsumer('any');

// <signed-integer>
const tryConsumeSignedInteger = createIntegerConsumer('signed');

// <signless-integer>
const tryConsumeSignlessInteger = createIntegerConsumer('signless');

const tryConsumePlus = createDelimConsumer('+');
const tryConsumeMinus = createDelimConsumer('-');
const tryConsumeOdd = createKeywordConsumer('odd');
const tryConsumeEven = createKeywordConsumer('even');
const tryConsumeN = createKeywordConsumer('n');
const tryConsumeDashN = createKeywordConsumer('-n');
const tryConsumeNDash = createKeywordConsumer('n-');
const tryConsumeDashNDash = createKeywordConsumer('-n-');

const consumePositiveN: TryComponentConsumer<number> = sequenceOf(
  [
    opt(tryConsumePlus),
    one(tryConsumeN),
  ],
  () => ok(1),
);

const consumePositiveNDash: TryComponentConsumer<number> = sequenceOf(
  [
    opt(tryConsumePlus),
    one(tryConsumeNDash),
  ],
  () => ok(1),
);

const consumeNHead: TryComponentConsumer<number> = oneOf(
  [
    one(tryConsumeNDimension),
    one(consumePositiveN),
    one(tryConsumeDashN),
  ],
  ([head]) => ok(
    typeof head === 'number'
      ? head
      : typeof head === 'string'
        ? -1
        : head.value,
  ),
);

const consumeNDashHead: TryComponentConsumer<number> = oneOf(
  [
    one(tryConsumeNDashDimension),
    one(consumePositiveNDash),
    one(tryConsumeDashNDash),
  ],
  ([head]) => ok(
    typeof head === 'number'
      ? head
      : typeof head === 'string'
        ? -1
        : head.value,
  ),
);

const consumeDelimitedOffset: TryComponentConsumer<number> = sequenceOf(
  [
    one(
      withComponentTrivia(
        oneOf(
          [
            one(tryConsumePlus),
            one(tryConsumeMinus),
          ],
          ([sign]) => ok(sign),
        ),
      ),
    ),
    one(withComponentTrivia(tryConsumeSignlessInteger)),
  ],
  ([[sign], [integer]]) => ok(
    sign === '-'
      ? -integer.value
      : integer.value,
  ),
);

const consumeOffset: TryComponentConsumer<number> = oneOf(
  [
    one(withComponentTrivia(tryConsumeSignedInteger)),
    one(consumeDelimitedOffset),
  ],
  ([offset]) => ok(
    typeof offset === 'number'
      ? offset
      : offset.value,
  ),
);

const consumeNExpression: TryComponentConsumer<AnPlusBValue> = sequenceOf(
  [
    one(consumeNHead),
    opt(consumeOffset),
  ],
  ([[a], offset]) => ok({
    a,
    b: offset[0] ?? 0,
  }),
);

const consumeNDashExpression: TryComponentConsumer<AnPlusBValue> = sequenceOf(
  [
    one(consumeNDashHead),
    one(withComponentTrivia(tryConsumeSignlessInteger)),
  ],
  ([[a], [integer]]) => ok({
    a,
    b: -integer.value,
  }),
);

const consumeEmbeddedNegative: TryComponentConsumer<AnPlusBValue> = oneOf(
  [
    one(tryConsumeNDashDigitDimension),
    one(
      sequenceOf(
        [
          opt(tryConsumePlus),
          one(tryConsumeNDashDigitIdent),
        ],
        ([, [ident]]) => ok(ident),
      ),
    ),
    one(tryConsumeDashNDashDigitIdent),
  ],
  ([component]) => {
    if (component.kind === TokenKind.Dimension) {
      return ok({
        a: component.value,
        b: -Number.parseInt(component.unit.slice(2), 10),
      });
    }

    const value = asciiLower(component.value);
    const isNegativeN = value.startsWith('-n-');

    return ok({
      a: isNegativeN ? -1 : 1,
      b: -Number.parseInt(value.slice(isNegativeN ? 3 : 2), 10),
    });
  },
);

const consumeParity: TryComponentConsumer<AnPlusBValue> = oneOf(
  [
    one(tryConsumeOdd),
    one(tryConsumeEven),
  ],
  ([value]) => ok(value === 'odd'
    ? { a: 2, b: 1 }
    : { a: 2, b: 0 }),
);

const consumeInteger: TryComponentConsumer<AnPlusBValue> = sequenceOf(
  [one(tryConsumeInteger)],
  ([[integer]]) => ok({ a: 0, b: integer.value }),
);

const consumeAnPlusBAtomic: TryComponentConsumer<AnPlusBValue> = oneOf(
  [
    one(consumeParity),
    one(consumeInteger),
    one(consumeEmbeddedNegative),
  ],
  ([value]) => ok(value),
);

const consumeAnPlusB: TryComponentConsumer<AnPlusBValue> = oneOf(
  [
    one(consumeAnPlusBAtomic),
    one(consumeNExpression),
    one(consumeNDashExpression),
  ],
  ([value]) => ok({
    a: value.a === 0 ? 0 : value.a,
    b: value.b === 0 ? 0 : value.b,
  }),
);

export function serializeAnPlusB(value: AnPlusBValue): string {
  if (value.a === 0) {
    return serializeCssNumber(value.b);
  }

  const a = value.a === 1
    ? 'n'
    : value.a === -1
      ? '-n'
      : `${serializeCssNumber(value.a)}n`;

  if (value.b > 0) {
    return `${a}+${serializeCssNumber(value.b)}`;
  }

  if (value.b < 0) {
    return `${a}${serializeCssNumber(value.b)}`;
  }

  return a;
}
