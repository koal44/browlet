import { asciiLower } from '../../infra/ascii';

import {
  consumeDimensionToken, consumeIdentToken, consumeIntegerToken, consumeMinusDelim, consumePlusDelim, one,
  oneOf, opt, adaptConsumer, sequenceOf, withTrivia, NumericSign, NumberTokenFlag, TokenKind,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type DimensionToken, type IdentToken,
  type NumberToken,
} from '../syntax/index';
import { serializeCssInteger } from './numeric-literal/index';

import { createKeywordConsumer } from './keyword';

/*
 * <a-n-plus-b> =
 *   odd | even | <integer> |
 *   <n-dimension> | '+'?† n | -n |
 *   <ndashdigit-dimension> | '+'?† <ndashdigit-ident> | <dashndashdigit-ident> |
 *   <n-dimension> <signed-integer> | '+'?† n <signed-integer> |
 *     -n <signed-integer> |
 *   <ndash-dimension> <signless-integer> | '+'?† n- <signless-integer> |
 *     -n- <signless-integer> |
 *   <n-dimension> [ '+' | '-' ] <signless-integer> |
 *     '+'?† n [ '+' | '-' ] <signless-integer> |
 *     -n [ '+' | '-' ] <signless-integer>
 *
 * † The plus sign must be adjacent to the ident beginning with "n".
 */

/** Integer step and offset, represented within the finite JavaScript-number range. */
export type AnPlusBValue = {
  a: number;
  b: number;
};

/** Consumes an An+B formula, leaving any following selector clause unread. */
// https://drafts.csswg.org/css-syntax-3/#the-anb-type
export function consumeAnPlusB(
  c: TokenCursor,
): TryConsumerResult<AnPlusBValue> {
  return anPlusBConsumer(c);
}

/** Serializes the stored integer coefficients using the canonical An+B form. */
// https://drafts.csswg.org/css-syntax-3/#serializing-anb
// SPEC_MISMATCH: (A, B) -> string
// The existing coefficient record carries both specification inputs.
export function serializeAnPlusB(value: AnPlusBValue): string {
  if (value.a === 0) {
    return serializeCssInteger(value.b);
  }

  const a = value.a === 1
    ? 'n'
    : value.a === -1
      ? '-n'
      : `${serializeCssInteger(value.a)}n`;

  if (value.b > 0) {
    return `${a}+${serializeCssInteger(value.b)}`;
  }

  if (value.b < 0) {
    return `${a}${serializeCssInteger(value.b)}`;
  }

  return a;
}

/** Limits overflow while interpreting coefficients, and canonicalizes signed zero. */
// https://drafts.csswg.org/css-values-4/#numeric-types
// The supported range is implementation-defined. Preserve finite values;
// overflowing numeric tokens or embedded decimal offsets use the nearest bound.
function interpretCoefficient(value: number): number {
  if (value === Infinity) return Number.MAX_VALUE;
  if (value === -Infinity) return -Number.MAX_VALUE;
  return value === 0 ? 0 : value;
}

function createIntegerConsumer(
  sign: 'any' | 'signed' | 'signless',
): TryConsumer<NumberToken> {
  return adaptConsumer(consumeIntegerToken, (component) => {
    const isSigned = component.sign !== NumericSign.None;

    return (
      (sign === 'signed' && !isSigned) ||
      (sign === 'signless' && isSigned)
    )
      ? null
      : component;
  });
}

function createIntegerDimensionConsumer(
  unitPattern: RegExp,
): TryConsumer<DimensionToken> {
  return adaptConsumer(consumeDimensionToken, (component) =>
    (
      component.flag !== NumberTokenFlag.Integer ||
      !unitPattern.test(asciiLower(component.unit))
    )
      ? null
      : component,
  );
}

function createIdentPatternConsumer(
  valuePattern: RegExp,
): TryConsumer<IdentToken> {
  return adaptConsumer(consumeIdentToken, (component) =>
    valuePattern.test(asciiLower(component.value))
      ? component
      : null,
  );
}

// <n-dimension>
const nDimensionConsumer = createIntegerDimensionConsumer(/^n$/);

// <ndash-dimension>
const nDashDimensionConsumer = createIntegerDimensionConsumer(/^n-$/);

// <ndashdigit-dimension>
const nDashDigitDimensionConsumer = createIntegerDimensionConsumer(/^n-[0-9]+$/);

// <ndashdigit-ident>
const nDashDigitIdentConsumer = createIdentPatternConsumer(/^n-[0-9]+$/);

// <dashndashdigit-ident>
const dashNDashDigitIdentConsumer = createIdentPatternConsumer(/^-n-[0-9]+$/);

// <integer>
const integerConsumer = createIntegerConsumer('any');

// <signed-integer>
const signedIntegerConsumer = createIntegerConsumer('signed');

// <signless-integer>
const signlessIntegerConsumer = createIntegerConsumer('signless');

// Keyword terminals used by <a-n-plus-b>.
const oddConsumer = createKeywordConsumer('odd');
const evenConsumer = createKeywordConsumer('even');
const nConsumer = createKeywordConsumer('n');
const dashNConsumer = createKeywordConsumer('-n');
const nDashConsumer = createKeywordConsumer('n-');
const dashNDashConsumer = createKeywordConsumer('-n-');

// <positive-n> = '+'?† n
const positiveNConsumer: TryConsumer<number> = sequenceOf(
  [
    opt(consumePlusDelim),
    one(nConsumer),
  ],
  () => 1,
);

// <positive-ndash> = '+'?† n-
const positiveNDashConsumer: TryConsumer<number> = sequenceOf(
  [
    opt(consumePlusDelim),
    one(nDashConsumer),
  ],
  () => 1,
);

// <n-head> = <n-dimension> | <positive-n> | -n
const nHeadConsumer: TryConsumer<number> = oneOf(
  [
    one(nDimensionConsumer),
    one(positiveNConsumer),
    one(dashNConsumer),
  ],
  ([head]) => typeof head === 'number'
    ? head
    : typeof head === 'string'
      ? -1
      : head.value,
);

// <ndash-head> = <ndash-dimension> | <positive-ndash> | -n-
const nDashHeadConsumer: TryConsumer<number> = oneOf(
  [
    one(nDashDimensionConsumer),
    one(positiveNDashConsumer),
    one(dashNDashConsumer),
  ],
  ([head]) => typeof head === 'number'
    ? head
    : typeof head === 'string'
      ? -1
      : head.value,
);

// <delimited-offset> = [ '+' | '-' ] <signless-integer>
const delimitedOffsetConsumer: TryConsumer<number> = sequenceOf(
  [
    one(
      withTrivia(
        oneOf(
          [
            one(consumePlusDelim),
            one(consumeMinusDelim),
          ],
          ([sign]) => sign,
        ),
      ),
    ),
    one(withTrivia(signlessIntegerConsumer)),
  ],
  ([[sign], [integer]]) => sign === '-'
    ? -integer.value
    : integer.value,
);

// <offset> = <signed-integer> | <delimited-offset>
const offsetConsumer: TryConsumer<number> = oneOf(
  [
    one(withTrivia(signedIntegerConsumer)),
    one(delimitedOffsetConsumer),
  ],
  ([offset]) => typeof offset === 'number'
    ? offset
    : offset.value,
);

// <n-expression> = <n-head> <offset>?
const nExpressionConsumer: TryConsumer<AnPlusBValue> = sequenceOf(
  [
    one(nHeadConsumer),
    opt(offsetConsumer),
  ],
  ([[a], offset]) => ({
    a,
    b: offset[0] ?? 0,
  }),
);

// <ndash-expression> = <ndash-head> <signless-integer>
const nDashExpressionConsumer: TryConsumer<AnPlusBValue> = sequenceOf(
  [
    one(nDashHeadConsumer),
    one(withTrivia(signlessIntegerConsumer)),
  ],
  ([[a], [integer]]) => ({
    a,
    b: -integer.value,
  }),
);

// <embedded-negative> = <ndashdigit-dimension> | '+'?† <ndashdigit-ident> | <dashndashdigit-ident>
const embeddedNegativeConsumer: TryConsumer<AnPlusBValue> = oneOf(
  [
    one(nDashDigitDimensionConsumer),
    one(
      sequenceOf(
        [
          opt(consumePlusDelim),
          one(nDashDigitIdentConsumer),
        ],
        ([, [ident]]) => ident,
      ),
    ),
    one(dashNDashDigitIdentConsumer),
  ],
  ([component]) => {
    if (component.type === TokenKind.Dimension) {
      return {
        a: component.value,
        b: -Number.parseInt(component.unit.slice(2), 10),
      };
    }

    const value = asciiLower(component.value);
    const isNegativeN = value.startsWith('-n-');

    return {
      a: isNegativeN ? -1 : 1,
      b: -Number.parseInt(value.slice(isNegativeN ? 3 : 2), 10),
    };
  },
);

// <parity> = odd | even
const parityConsumer: TryConsumer<AnPlusBValue> = oneOf(
  [
    one(oddConsumer),
    one(evenConsumer),
  ],
  ([value]) => value === 'odd'
    ? { a: 2, b: 1 }
    : { a: 2, b: 0 },
);

// <integer-expression> = <integer>
const integerExpressionConsumer: TryConsumer<AnPlusBValue> = sequenceOf(
  [one(integerConsumer)],
  ([[integer]]) => ({ a: 0, b: integer.value }),
);

// <a-n-plus-b-atomic> = <parity> | <integer-expression> | <embedded-negative>
const anPlusBAtomicConsumer: TryConsumer<AnPlusBValue> = oneOf(
  [
    one(parityConsumer),
    one(integerExpressionConsumer),
    one(embeddedNegativeConsumer),
  ],
  ([value]) => value,
);

/*
 * Implementation factorization of the expanded <a-n-plus-b> production:
 *
 * <a-n-plus-b> = <a-n-plus-b-atomic> | <n-expression> | <ndash-expression>
 */
const anPlusBConsumer: TryConsumer<AnPlusBValue> = oneOf(
  [
    one(anPlusBAtomicConsumer),
    one(nExpressionConsumer),
    one(nDashExpressionConsumer),
  ],
  ([value]) => ({
    a: interpretCoefficient(value.a),
    b: interpretCoefficient(value.b),
  }),
);
