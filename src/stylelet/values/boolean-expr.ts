import {
  one, oneOf, plus, adaptConsumer, recursive, sequenceOf, withTrivia,
} from '../syntax/component-grammar';
import { type TryConsumer } from '../syntax/token-cursor';
import { consumeParensBlock } from '../syntax/component-consumers';
import { type ParensBlock } from '../syntax/component-value';
import { parseAsComponentGrammar, type ParserInput } from '../syntax/parser';
import { TokenKind } from '../syntax/tokens';
import { consumeGeneralEnclosed, type GeneralEnclosedValue } from './general-enclosed';
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

export function parseBooleanExpr<Test>(
  input: ParserInput,
  testConsumer: TryConsumer<Test>,
): BooleanExprValue<Test> | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(createBooleanExprConsumer(testConsumer)),
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
  consumeTest: TryConsumer<Test>,
): TryConsumer<BooleanExprValue<Test>> {
  return recursive((consumeExpr) => {
    // <test>
    const testConsumer = adaptConsumer(
      consumeTest,
      (value): BooleanExprTest<Test> => ({
        type: 'boolean-test',
        value,
      }),
    );

    // ( <boolean-expr[ <test> ]> )
    const parensConsumer = createParensConsumer(consumeExpr);

    // <boolean-expr-group> = <test> | ( <boolean-expr[ <test> ]> ) | <general-enclosed>
    const groupConsumer = oneOf(
      [
        one(testConsumer),
        one(parensConsumer),
        one(consumeGeneralEnclosed),
      ],
      ([value]) => value,
    );

    // not <boolean-expr-group>
    const notExprConsumer = sequenceOf(
      [
        one(notConsumer),
        one(withTrivia(groupConsumer)),
      ],
      ([, [value]]): BooleanExprNot<Test> => ({
        type: 'boolean-not',
        value,
      }),
    );

    // and <boolean-expr-group>
    const andGroupConsumer = sequenceOf(
      [
        one(andConsumer),
        one(withTrivia(groupConsumer)),
      ],
      ([, [value]]) => value,
    );

    // or <boolean-expr-group>
    const orGroupConsumer = sequenceOf(
      [
        one(orConsumer),
        one(withTrivia(groupConsumer)),
      ],
      ([, [value]]) => value,
    );

    // <boolean-expr-group> [ and <boolean-expr-group> ]+
    const andOperationConsumer = sequenceOf(
      [
        one(groupConsumer),
        plus(andGroupConsumer),
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
    const orOperationConsumer = sequenceOf(
      [
        one(groupConsumer),
        plus(orGroupConsumer),
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
        one(notExprConsumer),
        one(andOperationConsumer),
        one(orOperationConsumer),
        one(groupConsumer),
      ],
      ([value]) => value,
    );
  });
}

// ( <contents> )
function createParensConsumer<Test>(
  valueConsumer: TryConsumer<BooleanExprValue<Test>>,
): TryConsumer<BooleanExprParens<Test>> {
  return adaptConsumer(consumeParensBlock, (component, context) => {
    const value = parseAsComponentGrammar(
      component.value,
      withTrivia(valueConsumer),
      context,
    );

    return value === null
      ? null
      : { ...component, value };
  });
}

// Keyword terminals used by <boolean-expr>.
const notConsumer = createKeywordConsumer('not');
const andConsumer = withTrivia(createKeywordConsumer('and'));
const orConsumer = withTrivia(createKeywordConsumer('or'));

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
    case TokenKind.ParensBlock:
      return resolveBooleanExprValue(value.value, context);

    case 'boolean-test':
      return context.resolveTest(value.value);

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
