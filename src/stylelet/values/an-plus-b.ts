import { asciiLower } from '../../shared/css';
import {
  consumeDimensionToken, consumeIdentToken, consumeIntegerToken,
  consumeMinusDelim, consumePlusDelim,
} from '../syntax/component-consumers';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../syntax/component-cursor';
import { one, oneOf, opt, adaptConsumer, sequenceOf, withTrivia } from '../syntax/component-grammar';
import type { DimensionToken, IdentToken, NumberToken } from '../syntax/tokens';
import { NumberTokenFlag, TokenKind } from '../syntax/tokens';
import { createKeywordConsumer } from './keyword';
import { serializeCssNumber } from './numeric-literal/number';

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

export type AnPlusBValue = {
  a: number;
  b: number;
};

export function consumeAnPlusB(
  c: ComponentCursor,
): TryComponentConsumerResult<AnPlusBValue> {
  return anPlusBConsumer(c);
}

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

// =============================================================================
// Syntax
// =============================================================================

function createIntegerConsumer(
  sign: 'any' | 'signed' | 'signless',
): TryComponentConsumer<NumberToken> {
  return adaptConsumer(consumeIntegerToken, (component) => {
    const isSigned =
      component.repr.startsWith('+') ||
      component.repr.startsWith('-');

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
): TryComponentConsumer<DimensionToken> {
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
): TryComponentConsumer<IdentToken> {
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
const positiveNConsumer: TryComponentConsumer<number> = sequenceOf(
  [
    opt(consumePlusDelim),
    one(nConsumer),
  ],
  () => 1,
);

// <positive-ndash> = '+'?† n-
const positiveNDashConsumer: TryComponentConsumer<number> = sequenceOf(
  [
    opt(consumePlusDelim),
    one(nDashConsumer),
  ],
  () => 1,
);

// <n-head> = <n-dimension> | <positive-n> | -n
const nHeadConsumer: TryComponentConsumer<number> = oneOf(
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
const nDashHeadConsumer: TryComponentConsumer<number> = oneOf(
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
const delimitedOffsetConsumer: TryComponentConsumer<number> = sequenceOf(
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
const offsetConsumer: TryComponentConsumer<number> = oneOf(
  [
    one(withTrivia(signedIntegerConsumer)),
    one(delimitedOffsetConsumer),
  ],
  ([offset]) => typeof offset === 'number'
    ? offset
    : offset.value,
);

// <n-expression> = <n-head> <offset>?
const nExpressionConsumer: TryComponentConsumer<AnPlusBValue> = sequenceOf(
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
const nDashExpressionConsumer: TryComponentConsumer<AnPlusBValue> = sequenceOf(
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
const embeddedNegativeConsumer: TryComponentConsumer<AnPlusBValue> = oneOf(
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
    if (component.kind === TokenKind.Dimension) {
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
const parityConsumer: TryComponentConsumer<AnPlusBValue> = oneOf(
  [
    one(oddConsumer),
    one(evenConsumer),
  ],
  ([value]) => value === 'odd'
    ? { a: 2, b: 1 }
    : { a: 2, b: 0 },
);

// <integer-expression> = <integer>
const integerExpressionConsumer: TryComponentConsumer<AnPlusBValue> = sequenceOf(
  [one(integerConsumer)],
  ([[integer]]) => ({ a: 0, b: integer.value }),
);

// <a-n-plus-b-atomic> = <parity> | <integer-expression> | <embedded-negative>
const anPlusBAtomicConsumer: TryComponentConsumer<AnPlusBValue> = oneOf(
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
const anPlusBConsumer: TryComponentConsumer<AnPlusBValue> = oneOf(
  [
    one(anPlusBAtomicConsumer),
    one(nExpressionConsumer),
    one(nDashExpressionConsumer),
  ],
  ([value]) => ({
    a: value.a === 0 ? 0 : value.a,
    b: value.b === 0 ? 0 : value.b,
  }),
);
