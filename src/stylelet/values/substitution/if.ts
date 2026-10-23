import {
  createKeywordConsumer, createFreeFormConsumer, createFunctionalNotationConsumer, consumeColon, consumeSemicolon,
  any, one, opt, oneOf, sequenceOf, withTrivia, isTokenKind, parseAsComponentGrammar, TokenKind,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';

import { DeclarationValue, OptionalDeclarationValue } from '../declaration-value';
import {
  SupportsConditionValue, consumeSupportsDeclaration, type SupportsDeclaration,
} from '../supports-condition';
import { BooleanExprValue } from '../boolean-expr';

/** Parsed conditional branches; substitution evaluates them with the current consuming context. */
// https://drafts.csswg.org/css-values-5/#if-notation
export class IfValue {
  /** Ordered conditions and unevaluated branch contents. */
  repr: [IfBranch<IfCondition>, ...IfBranch<IfCondition>[]];

  constructor(value: [IfBranch<IfCondition>, ...IfBranch<IfCondition>[]]) {
    this.repr = value;
  }

  static parse(input: ParserInput, context: unknown): IfValue | null {
    return parseAsComponentGrammar(input, ifGrammar, context);
  }

  static consume(this: void, c: TokenCursor): TryConsumerResult<IfValue> {
    return ifConsumer(c);
  }
}

/** The argument grammar retains condition tokens until arbitrary substitution can run. */
export class IfArguments {
  /** Ordered branch boundaries without premature condition interpretation. */
  value: [IfBranch<DeclarationValue>, ...IfBranch<DeclarationValue>[]];

  constructor(value: [IfBranch<DeclarationValue>, ...IfBranch<DeclarationValue>[]]) {
    this.value = value;
  }

  static parse(input: ParserInput, context: unknown): IfArguments | null {
    return parseAsComponentGrammar(input, ifArgumentsGrammar, context);
  }

  static consume(this: void, c: TokenCursor): TryConsumerResult<IfArguments> {
    return ifArgumentsConsumer(c);
  }
}

type IfBranch<Condition> = {
  condition: Condition;
  value: OptionalDeclarationValue;
};

type IfCondition = BooleanExprValue<IfTest> | IfElseCondition;

// TODO: Add media() and style() as their condition grammars land.
type IfTest = SupportsTest;

type SupportsTest = {
  type: 'supports';
  condition: SupportsDeclaration | SupportsConditionValue;
};

type IfElseCondition = {
  type: 'else';
};

/*
 * <if()> = if( [ <if-branch> ; ]* <if-branch> ;? )
 * <if-branch> = <if-condition> : <declaration-value>?
 * <if-condition> = <boolean-expr[ <if-test> ]> | else
 * <if-test> =
 *   supports( [ <ident> : <declaration-value> ] | <supports-condition> ) |
 *   media( <media-feature> | <media-condition> ) |
 *   style( <style-query> )
 */

// [ <ident> : <declaration-value> ] | <supports-condition>
const supportsTestArgumentConsumer = oneOf(
  [
    one(consumeSupportsDeclaration),
    one(SupportsConditionValue.consume),
  ],
  ([condition]) => condition,
);

// supports( [ <ident> : <declaration-value> ] | <supports-condition> )
const supportsTestConsumer = createFunctionalNotationConsumer(
  'supports',
  supportsTestArgumentConsumer,
  (condition): SupportsTest => ({ type: 'supports', condition }),
);

const elseConditionConsumer = createKeywordConsumer('else');

// <if-condition> = <boolean-expr[ <if-test> ]> | else
const ifConditionConsumer: TryConsumer<IfCondition> = oneOf(
  [
    one(BooleanExprValue.createConsumer(supportsTestConsumer)),
    one(elseConditionConsumer),
  ],
  ([condition]) => typeof condition === 'string'
    ? { type: condition }
    : condition,
);

const ifBranchValueConsumer = createFreeFormConsumer(
  OptionalDeclarationValue.consume,
  { stopBefore: (component) => isTokenKind(component, TokenKind.Semicolon) },
);
const colonConsumer = withTrivia(consumeColon);

// <if-branch> = <if-condition> : <declaration-value>?
const ifBranchConsumer = createIfBranchConsumer(ifConditionConsumer);

// <if()> = if( [ <if-branch> ; ]* <if-branch> ;? )
const ifConsumer = createFunctionalNotationConsumer(
  'if',
  createIfBranchListConsumer(ifBranchConsumer),
  (branches) => new IfValue(branches),
);

const ifGrammar = withTrivia(ifConsumer);

/*
 * <if-args> = if( [ <if-args-branch> ; ]* <if-args-branch> ;? )
 * <if-args-branch> = <declaration-value> : <declaration-value>?
 */

// The first <declaration-value> in <if-args-branch>, excluding top-level colons.
const ifArgumentsConditionConsumer = createFreeFormConsumer(
  DeclarationValue.consume,
  { stopBefore: (component) => isTokenKind(component, TokenKind.Colon) },
);

// <if-args-branch> = <declaration-value> : <declaration-value>?
const ifArgumentsBranchConsumer = createIfBranchConsumer(ifArgumentsConditionConsumer);

// <if-args> = if( [ <if-args-branch> ; ]* <if-args-branch> ;? )
const ifArgumentsConsumer = createFunctionalNotationConsumer(
  'if',
  createIfBranchListConsumer(ifArgumentsBranchConsumer),
  (branches) => new IfArguments(branches),
);

const ifArgumentsGrammar = withTrivia(ifArgumentsConsumer);

function createIfBranchConsumer<Condition>(
  conditionConsumer: TryConsumer<Condition>,
): TryConsumer<IfBranch<Condition>> {
  // Empty branch contents are valid; sequenceOf requires each value to consume input.
  return (c) => {
    const start = c.pos();
    const condition = conditionConsumer(c);

    if (condition === null || colonConsumer(c) === null) {
      c.restore(start);
      return null;
    }

    const value = ifBranchValueConsumer(c);

    if (value === null) {
      c.restore(start);
      return null;
    }

    return { condition, value };
  };
}

function createIfBranchListConsumer<Branch>(
  branchConsumer: TryConsumer<Branch>,
): TryConsumer<[Branch, ...Branch[]]> {
  const subsequentBranchConsumer = sequenceOf(
    [
      one(withTrivia(consumeSemicolon)),
      one(withTrivia(branchConsumer)),
    ],
    ([, [branch]]) => branch,
  );

  return sequenceOf(
    [
      one(branchConsumer),
      any(subsequentBranchConsumer),
      opt(withTrivia(consumeSemicolon)),
    ],
    ([[first], rest]) => [first, ...rest],
  );
}
