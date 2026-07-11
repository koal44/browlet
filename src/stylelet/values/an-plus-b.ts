import { asciiLower } from '../../utils/css';
import type { ComponentCursor } from '../parser/component-cursor';
import { one, oneOf, opt, sequenceOf, withComponentTrivia } from '../parser/component-grammar';
import {
  ok,
  type TryComponentParser, type TryComponentParserResult,
} from '../parser/component-try-parser';
import { isDelimToken, isIdentToken, isTokenKind } from '../parser/syntax';
import type { DimensionToken, IdentToken, NumberToken } from '../parser/tokens';
import { NumberTokenFlag, TokenKind } from '../parser/tokens';
import { serializeNumber } from './number';

export type AnPlusBValue = {
  a: number;
  b: number;
};

function createIntegerConsumer(
  sign: 'any' | 'signed' | 'signless',
): TryComponentParser<NumberToken> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (
      !isTokenKind(component, TokenKind.Number) ||
      component.flag !== NumberTokenFlag.Integer
    ) {
      c.restore(start);
      return null;
    }

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
): TryComponentParser<DimensionToken> {
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
): TryComponentParser<IdentToken> {
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

function createDelimConsumer<T extends string>(expected: T): TryComponentParser<T> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (!isDelimToken(component, expected)) {
      c.restore(start);
      return null;
    }

    return ok(expected);
  };
}

function createIdentValueConsumer<T extends string>(
  expected: T,
): TryComponentParser<T> {
  return (c) => {
    const start = c.pos();
    const component = c.next();

    if (
      !isIdentToken(component) ||
      asciiLower(component.value) !== expected
    ) {
      c.restore(start);
      return null;
    }

    return ok(expected);
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
export function tryParseAnPlusB(
  c: ComponentCursor,
): TryComponentParserResult<AnPlusBValue> {
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
const tryConsumeOdd = createIdentValueConsumer('odd');
const tryConsumeEven = createIdentValueConsumer('even');
const tryConsumeN = createIdentValueConsumer('n');
const tryConsumeDashN = createIdentValueConsumer('-n');
const tryConsumeNDash = createIdentValueConsumer('n-');
const tryConsumeDashNDash = createIdentValueConsumer('-n-');

const consumePositiveN: TryComponentParser<number> = sequenceOf(
  [
    opt(tryConsumePlus),
    one(tryConsumeN),
  ],
  () => ok(1),
);

const consumePositiveNDash: TryComponentParser<number> = sequenceOf(
  [
    opt(tryConsumePlus),
    one(tryConsumeNDash),
  ],
  () => ok(1),
);

const consumeNHead: TryComponentParser<number> = oneOf(
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

const consumeNDashHead: TryComponentParser<number> = oneOf(
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

const consumeDelimitedOffset: TryComponentParser<number> = sequenceOf(
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

const consumeOffset: TryComponentParser<number> = oneOf(
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

const consumeNExpression: TryComponentParser<AnPlusBValue> = sequenceOf(
  [
    one(consumeNHead),
    opt(consumeOffset),
  ],
  ([[a], offset]) => ok({
    a,
    b: offset[0] ?? 0,
  }),
);

const consumeNDashExpression: TryComponentParser<AnPlusBValue> = sequenceOf(
  [
    one(consumeNDashHead),
    one(withComponentTrivia(tryConsumeSignlessInteger)),
  ],
  ([[a], [integer]]) => ok({
    a,
    b: -integer.value,
  }),
);

const consumeEmbeddedNegative: TryComponentParser<AnPlusBValue> = oneOf(
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

const consumeParity: TryComponentParser<AnPlusBValue> = oneOf(
  [
    one(tryConsumeOdd),
    one(tryConsumeEven),
  ],
  ([value]) => ok(value === 'odd'
    ? { a: 2, b: 1 }
    : { a: 2, b: 0 }),
);

const consumeInteger: TryComponentParser<AnPlusBValue> = sequenceOf(
  [one(tryConsumeInteger)],
  ([[integer]]) => ok({ a: 0, b: integer.value }),
);

const consumeAnPlusBAtomic: TryComponentParser<AnPlusBValue> = oneOf(
  [
    one(consumeParity),
    one(consumeInteger),
    one(consumeEmbeddedNegative),
  ],
  ([value]) => ok(value),
);

const consumeAnPlusB: TryComponentParser<AnPlusBValue> = oneOf(
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
    return serializeNumber(value.b);
  }

  const a = value.a === 1
    ? 'n'
    : value.a === -1
      ? '-n'
      : `${serializeNumber(value.a)}n`;

  if (value.b > 0) {
    return `${a}+${serializeNumber(value.b)}`;
  }

  if (value.b < 0) {
    return `${a}${serializeNumber(value.b)}`;
  }

  return a;
}
