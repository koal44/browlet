import {
  createKeywordConsumer, one, oneOf, opt, plus, adaptConsumer, recursive, sequenceOf, withTrivia, consumeParensBlock,
  parseAsComponentGrammar,
  type TryConsumer, type ParserInput,
} from '../syntax/index';

import { GeneralEnclosedValue } from './general-enclosed';

/** A boolean expression whose test grammar and evaluation policy belong to its caller. */
// https://drafts.csswg.org/css-values-5/#boolean-expr
export class BooleanExprValue<Test> {
  /** The retained tests, grouping, and boolean operators. */
  repr: BooleanExpr<Test>;

  constructor(value: BooleanExpr<Test>) {
    this.repr = value;
  }

  /** Parse a complete expression using the caller's test grammar. */
  static parse<Test, Context>(
    input: ParserInput, consumeTest: TryConsumer<Test, Context>, context: Context,
  ): BooleanExprValue<Test> | null {
    return parseAsComponentGrammar(input, withTrivia(BooleanExprValue.createConsumer(consumeTest)), context);
  }

  /** Configure the recursive grammar once for a containing condition grammar. */
  static createConsumer<Test, Context>(
    consumeTest: TryConsumer<Test, Context>,
  ): TryConsumer<BooleanExprValue<Test>, Context> {
    /*
     * <boolean-expr[ <test> ]> = not <boolean-expr-group> | <boolean-expr-group>
     *   [ [ and <boolean-expr-group> ]* | [ or <boolean-expr-group> ]* ]
     * <boolean-expr-group> = <test> | ( <boolean-expr[ <test> ]> ) | <general-enclosed>
     */
    const consume = recursive<BooleanExpr<Test>, Context>((consumeExpr) => {
      // <test>
      const testConsumer = adaptConsumer(
        consumeTest,
        (value) => new BooleanExprTest(value),
      );

      // ( <boolean-expr[ <test> ]> )
      const innerGrammar = withTrivia(consumeExpr);
      const parensConsumer = adaptConsumer(
        consumeParensBlock,
        (block, context: Context) => parseAsComponentGrammar(block.value, innerGrammar, context),
      );

      const generalEnclosedConsumer = adaptConsumer(
        GeneralEnclosedValue.consume,
        (value) => new BooleanExprGeneralEnclosed<Test>(value),
      );

      // <boolean-expr-group> = <test> | ( <boolean-expr[ <test> ]> ) | <general-enclosed>
      const groupConsumer = oneOf(
        [
          one(testConsumer),
          one(parensConsumer),
          one(generalEnclosedConsumer),
        ],
        ([value]) => value,
      );
      const followingGroupConsumer = withTrivia(groupConsumer);

      // not <boolean-expr-group>
      const notExprConsumer = sequenceOf(
        [
          one(notConsumer),
          one(followingGroupConsumer),
        ],
        ([, [value]]) => new BooleanExprNot(value),
      );

      // and <boolean-expr-group>
      const andGroupConsumer = sequenceOf(
        [
          one(andConsumer),
          one(followingGroupConsumer),
        ],
        ([, [value]]) => value,
      );

      // or <boolean-expr-group>
      const orGroupConsumer = sequenceOf(
        [
          one(orConsumer),
          one(followingGroupConsumer),
        ],
        ([, [value]]) => value,
      );

      // [ and <boolean-expr-group> ]+ | [ or <boolean-expr-group> ]+
      const andTailConsumer = sequenceOf([plus(andGroupConsumer)], ([values]) => new BooleanExprAnd(values));
      const orTailConsumer = sequenceOf([plus(orGroupConsumer)], ([values]) => new BooleanExprOr(values));
      const tailConsumer = oneOf(
        [one(andTailConsumer), one(orTailConsumer)],
        ([value]) => value,
      );

      // Consume the leading group once, whether or not an operator follows.
      const chainConsumer = sequenceOf(
        [one(groupConsumer), opt(tailConsumer)],
        ([[first], [tail]]) => {
          if (tail === undefined) return first;
          tail.values.unshift(first);
          return tail;
        },
      );

      return oneOf(
        [
          one(notExprConsumer),
          one(chainConsumer),
        ],
        ([value]) => value,
      );
    });
    return adaptConsumer(consume, (value) => new BooleanExprValue(value));
  }

  /** Evaluate lazily with three-valued logic; this does not advance a CSS value's lifecycle. */
  evaluate(context: BooleanExprContext<Test>): BooleanExprResult {
    const result = this.repr.evaluate(context);
    return result === 'unknown' && context.preserveUnknown !== true ? false : result;
  }
}

export type BooleanExprResult = boolean | 'unknown';

export type BooleanExprContext<Test> = {
  evaluateTest: (value: Test) => BooleanExprResult;
  evaluateGeneralEnclosed?: (value: GeneralEnclosedValue) => BooleanExprResult;
  /** Whether the complete expression may return unknown; child nodes always preserve it. */
  preserveUnknown?: boolean;
};

/** A boolean grammar node evaluated with the current caller's test policy. */
interface BooleanExpr<Test> {
  /** Preserve unknown until the enclosing expression has been evaluated. */
  evaluate(context: BooleanExprContext<Test>): BooleanExprResult;
}

/** A test whose meaning belongs to the containing condition grammar. */
class BooleanExprTest<Test> implements BooleanExpr<Test> {
  /** The parsed test supplied to the current evaluation policy. */
  value: Test;

  constructor(value: Test) {
    this.value = value;
  }

  evaluate(context: BooleanExprContext<Test>): BooleanExprResult {
    return context.evaluateTest(this.value);
  }
}

/** Supplies boolean evaluation for an otherwise opaque condition value. */
class BooleanExprGeneralEnclosed<Test> implements BooleanExpr<Test> {
  /** The unknown condition syntax supplied to the caller's evaluation policy. */
  value: GeneralEnclosedValue;

  constructor(value: GeneralEnclosedValue) {
    this.value = value;
  }

  evaluate(context: BooleanExprContext<Test>): BooleanExprResult {
    return context.evaluateGeneralEnclosed?.(this.value) ?? 'unknown';
  }
}

/** Negation preserves an unknown operand. */
class BooleanExprNot<Test> implements BooleanExpr<Test> {
  /** The operand to negate. */
  value: BooleanExpr<Test>;

  constructor(value: BooleanExpr<Test>) {
    this.value = value;
  }

  evaluate(context: BooleanExprContext<Test>): BooleanExprResult {
    const result = this.value.evaluate(context);
    return result === 'unknown' ? result : !result;
  }
}

/** A conjunction evaluated in source order until an operand is false. */
class BooleanExprAnd<Test> implements BooleanExpr<Test> {
  /** The operands in source order. */
  values: BooleanExpr<Test>[];

  constructor(values: BooleanExpr<Test>[]) {
    this.values = values;
  }

  evaluate(context: BooleanExprContext<Test>): BooleanExprResult {
    let unknown = false;

    for (const value of this.values) {
      const result = value.evaluate(context);

      if (result === false) return false;
      if (result === 'unknown') unknown = true;
    }

    return unknown ? 'unknown' : true;
  }
}

/** A disjunction evaluated in source order until an operand is true. */
class BooleanExprOr<Test> implements BooleanExpr<Test> {
  /** The operands in source order. */
  values: BooleanExpr<Test>[];

  constructor(values: BooleanExpr<Test>[]) {
    this.values = values;
  }

  evaluate(context: BooleanExprContext<Test>): BooleanExprResult {
    let unknown = false;

    for (const value of this.values) {
      const result = value.evaluate(context);

      if (result === true) return true;
      if (result === 'unknown') unknown = true;
    }

    return unknown ? 'unknown' : false;
  }
}

// Keyword terminals used by <boolean-expr>.
const notConsumer = createKeywordConsumer('not');
const andConsumer = withTrivia(createKeywordConsumer('and'));
const orConsumer = withTrivia(createKeywordConsumer('or'));
