import {
  one, oneOf, plus, adaptConsumer, recursive, sequenceOf, withTrivia,
} from '../parser/component-grammar';
import { type TryComponentConsumer } from '../parser/component-cursor';
import { tryConsumeParensBlock } from '../parser/component-consumers';
import { type ParensBlock } from '../parser/component-value';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { tryConsumeGeneralEnclosed, type GeneralEnclosedValue } from './general-enclosed';
import { createKeywordConsumer } from './keyword';

export type BooleanExprValue<Test> =
  | BooleanExprGroup<Test>
  | BooleanExprNot<Test>
  | BooleanExprAnd<Test>
  | BooleanExprOr<Test>;

type BooleanExprGroup<Test> =
  | BooleanExprTest<Test>
  | BooleanExprParens<Test>
  | GeneralEnclosedValue;

type BooleanExprTest<Test> = {
  type: 'boolean-test';
  value: Test;
};

// TypeScript requires an interface to terminate this recursive record edge.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface BooleanExprParens<Test> extends ParensBlock<BooleanExprValue<Test>> {
  value: BooleanExprValue<Test>;
}

type BooleanExprNot<Test> = {
  type: 'boolean-not';
  value: BooleanExprGroup<Test>;
};

type BooleanExprAnd<Test> = {
  type: 'boolean-and';
  values: BooleanExprOperands<Test>;
};

type BooleanExprOr<Test> = {
  type: 'boolean-or';
  values: BooleanExprOperands<Test>;
};

type BooleanExprOperands<Test> = [
  BooleanExprGroup<Test>,
  BooleanExprGroup<Test>,
  ...BooleanExprGroup<Test>[],
];

export type BooleanExprResult = boolean | 'unknown';

export type BooleanExprContext<Test> = {
  resolveTest: (value: Test) => BooleanExprResult;
  resolveGeneralEnclosed?: (value: GeneralEnclosedValue) => BooleanExprResult;
  preserveUnknown?: boolean;
};

const tryConsumeNot = createKeywordConsumer('not');
const tryConsumeAnd = withTrivia(createKeywordConsumer('and'));
const tryConsumeOr = withTrivia(createKeywordConsumer('or'));

export function parseBooleanExpr<Test>(
  input: ParserInput,
  tryConsumeTest: TryComponentConsumer<Test>,
): BooleanExprValue<Test> | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(createBooleanExprConsumer(tryConsumeTest)),
  );
}

/*
 * <boolean-expr[ <test> ]> =
 *   not <boolean-expr-group> |
 *   <boolean-expr-group> [ [ and <boolean-expr-group> ]* |
 *                          [ or <boolean-expr-group> ]* ]
 *
 * <boolean-expr-group> =
 *   <test> | ( <boolean-expr[ <test> ]> ) | <general-enclosed>
 */
export function createBooleanExprConsumer<Test>(
  tryConsumeTest: TryComponentConsumer<Test>,
): TryComponentConsumer<BooleanExprValue<Test>> {
  return recursive((consumeExpr) => {
    // <test>
    const consumeTest = adaptConsumer(
      tryConsumeTest,
      (value): BooleanExprTest<Test> => ({
        type: 'boolean-test',
        value,
      }),
    );

    // ( <boolean-expr[ <test> ]> )
    const consumeParens = createParensConsumer(consumeExpr);

    // <boolean-expr-group> = <test> | ( <boolean-expr[ <test> ]> ) | <general-enclosed>
    const consumeGroup = oneOf(
      [
        one(consumeTest),
        one(consumeParens),
        one(tryConsumeGeneralEnclosed),
      ],
      ([value]) => value,
    );

    // not <boolean-expr-group>
    const consumeNot = sequenceOf(
      [
        one(tryConsumeNot),
        one(withTrivia(consumeGroup)),
      ],
      ([, [value]]): BooleanExprNot<Test> => ({
        type: 'boolean-not',
        value,
      }),
    );

    // and <boolean-expr-group>
    const consumeAndGroup = sequenceOf(
      [
        one(tryConsumeAnd),
        one(withTrivia(consumeGroup)),
      ],
      ([, [value]]) => value,
    );

    // or <boolean-expr-group>
    const consumeOrGroup = sequenceOf(
      [
        one(tryConsumeOr),
        one(withTrivia(consumeGroup)),
      ],
      ([, [value]]) => value,
    );

    // <boolean-expr-group> [ and <boolean-expr-group> ]+
    const consumeAndOperation = sequenceOf(
      [
        one(consumeGroup),
        plus(consumeAndGroup),
      ],
      ([[first], rest]): BooleanExprAnd<Test> => {
        const [second, ...remaining] = rest;

        return {
          type: 'boolean-and',
          values: [first, second, ...remaining],
        };
      },
    );

    // <boolean-expr-group> [ or <boolean-expr-group> ]+
    const consumeOrOperation = sequenceOf(
      [
        one(consumeGroup),
        plus(consumeOrGroup),
      ],
      ([[first], rest]): BooleanExprOr<Test> => {
        const [second, ...remaining] = rest;

        return {
          type: 'boolean-or',
          values: [first, second, ...remaining],
        };
      },
    );

    // <boolean-expr[]> = not <boolean-expr-group> | <and-operation> | <or-operation> | <boolean-expr-group>
    return oneOf(
      [
        one(consumeNot),
        one(consumeAndOperation),
        one(consumeOrOperation),
        one(consumeGroup),
      ],
      ([value]) => value,
    );
  });
}

// ( <contents> )
function createParensConsumer<Test>(
  tryConsumeValue: TryComponentConsumer<BooleanExprValue<Test>>,
): TryComponentConsumer<BooleanExprParens<Test>> {
  return adaptConsumer(tryConsumeParensBlock, (component, context) => {
    const value = parseAsComponentGrammar(
      component.value,
      withTrivia(tryConsumeValue),
      context,
    );

    return value === null
      ? null
      : { ...component, value };
  });
}

// =============================================================================
// Resolve
// =============================================================================

export function resolveBooleanExpr<Test>(
  value: BooleanExprValue<Test>,
  context: BooleanExprContext<Test>,
): BooleanExprResult {
  const result = resolveBooleanExprValue(value, context);

  return result === 'unknown' && context.preserveUnknown !== true
    ? false
    : result;
}

function resolveBooleanExprValue<Test>(
  value: BooleanExprValue<Test>,
  context: BooleanExprContext<Test>,
): BooleanExprResult {
  switch (value.type) {
    case 'boolean-test':
      return context.resolveTest(value.value);

    case 'block':
      return resolveBooleanExprValue(value.value, context);

    case 'general-enclosed':
      return context.resolveGeneralEnclosed?.(value) ?? 'unknown';

    case 'boolean-not':
      return negateBooleanExprResult(resolveBooleanExprValue(value.value, context));

    case 'boolean-and':
      return resolveBooleanAnd(value.values, context);

    case 'boolean-or':
      return resolveBooleanOr(value.values, context);
  }
}

function negateBooleanExprResult(value: BooleanExprResult): BooleanExprResult {
  return value === 'unknown' ? value : !value;
}

function resolveBooleanAnd<Test>(
  values: BooleanExprOperands<Test>,
  context: BooleanExprContext<Test>,
): BooleanExprResult {
  let unknown = false;

  for (const value of values) {
    const result = resolveBooleanExprValue(value, context);

    if (result === false) return false;
    if (result === 'unknown') unknown = true;
  }

  return unknown ? 'unknown' : true;
}

function resolveBooleanOr<Test>(
  values: BooleanExprOperands<Test>,
  context: BooleanExprContext<Test>,
): BooleanExprResult {
  let unknown = false;

  for (const value of values) {
    const result = resolveBooleanExprValue(value, context);

    if (result === true) return true;
    if (result === 'unknown') unknown = true;
  }

  return unknown ? 'unknown' : false;
}
