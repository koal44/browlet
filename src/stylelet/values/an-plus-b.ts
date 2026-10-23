import { asciiLower } from '../../infra/ascii';

import {
  createKeywordConsumer, consumeDimensionToken, consumeIdentToken, consumeIntegerToken,
  consumeMinusDelim, consumePlusDelim, one, oneOf, opt, adaptConsumer, sequenceOf, withTrivia,
  parseAsComponentGrammar, NumericSign, NumberTokenFlag, TokenKind,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type DimensionToken, type IdentToken,
  type NumberToken, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { serializeCssInteger } from './numeric-literal/index';

import type { Value } from './value';

/** Integer step and offset in an An+B formula. */
// https://drafts.csswg.org/css-syntax-3/#the-anb-type
export class AnPlusBValue implements Value {
  /** Finite integer coefficients, normalized when parsing. */
  repr: AnPlusB;

  constructor(value: AnPlusB) {
    this.repr = value;
  }

  /** Parse a complete An+B formula. */
  static parse(input: ParserInput, context: unknown): AnPlusBValue | null {
    return parseAsComponentGrammar(input, anPlusBGrammar, context);
  }

  /** Consume a formula, leaving any following selector clause unread. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<AnPlusBValue> {
    return anPlusBConsumer(c);
  }

  /** Coefficients have no contextual resolution. */
  resolve(_stage: ValueStage, _context: unknown): AnPlusBValue {
    return this;
  }

  /** Serialize the stored coefficients in canonical An+B form. */
  // https://drafts.csswg.org/css-syntax-3/#serializing-anb
  serialize(): string {
    const { a, b } = this.repr;
    if (a === 0) {
      return serializeCssInteger(b);
    }

    const nTerm = a === 1
      ? 'n'
      : a === -1
        ? '-n'
        : `${serializeCssInteger(a)}n`;

    if (b > 0) {
      return `${nTerm}+${serializeCssInteger(b)}`;
    }

    if (b < 0) {
      return `${nTerm}${serializeCssInteger(b)}`;
    }

    return nTerm;
  }
}

type AnPlusB = { a: number; b: number; };

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
const nExpressionConsumer: TryConsumer<AnPlusB> = sequenceOf(
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
const nDashExpressionConsumer: TryConsumer<AnPlusB> = sequenceOf(
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
const embeddedNegativeConsumer: TryConsumer<AnPlusB> = oneOf(
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
const parityConsumer: TryConsumer<AnPlusB> = oneOf(
  [
    one(oddConsumer),
    one(evenConsumer),
  ],
  ([value]) => value === 'odd'
    ? { a: 2, b: 1 }
    : { a: 2, b: 0 },
);

// <integer-expression> = <integer>
const integerExpressionConsumer = adaptConsumer(
  consumeIntegerToken,
  (integer): AnPlusB => ({ a: 0, b: integer.value }),
);

/*
 * Implementation factorization of the expanded <a-n-plus-b> production:
 *
 * <a-n-plus-b> = <parity> | <integer-expression> | <embedded-negative> |
 *   <n-expression> | <ndash-expression>
 */
const anPlusBConsumer: TryConsumer<AnPlusBValue> = oneOf(
  [
    one(parityConsumer),
    one(integerExpressionConsumer),
    one(embeddedNegativeConsumer),
    one(nExpressionConsumer),
    one(nDashExpressionConsumer),
  ],
  ([coefficients]) => new AnPlusBValue({
    a: normalizeCoefficient(coefficients.a),
    b: normalizeCoefficient(coefficients.b),
  }),
);

const anPlusBGrammar = withTrivia(anPlusBConsumer);

function createIntegerConsumer(sign: 'signed' | 'signless'): TryConsumer<NumberToken> {
  const requireSign = sign === 'signed';
  return adaptConsumer(consumeIntegerToken, (component) =>
    (component.sign !== NumericSign.None) === requireSign ? component : null,
  );
}

function createIntegerDimensionConsumer(unitPattern: RegExp): TryConsumer<DimensionToken> {
  return adaptConsumer(consumeDimensionToken, (component) =>
    component.flag === NumberTokenFlag.Integer && unitPattern.test(asciiLower(component.unit))
      ? component : null,
  );
}

function createIdentPatternConsumer(valuePattern: RegExp): TryConsumer<IdentToken> {
  return adaptConsumer(consumeIdentToken, (component) =>
    valuePattern.test(asciiLower(component.value)) ? component : null,
  );
}

/** Limits overflowing coefficients to finite bounds and canonicalizes signed zero. */
// https://drafts.csswg.org/css-values-4/#numeric-types
// The supported range is implementation-defined. Preserve finite values;
// overflowing numeric tokens or embedded decimal offsets use the nearest bound.
function normalizeCoefficient(value: number): number {
  if (value === Infinity) return Number.MAX_VALUE;
  if (value === -Infinity) return -Number.MAX_VALUE;
  return value === 0 ? 0 : value;
}
