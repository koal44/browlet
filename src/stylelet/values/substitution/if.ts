import {
  createFreeFormConsumer, createFunctionalNotationConsumer,
  consumeColon, consumeSemicolon,
} from '../../syntax/component-consumers';
import {
  any, one, opt, oneOf, sequenceOf, withTrivia,
} from '../../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumer,
  type TryConsumerResult,
} from '../../syntax/token-cursor';
import { isTokenKind } from '../../syntax/component-value';
import {
  consumeDeclarationValue, consumeOptionalDeclarationValue,
  type DeclarationValue, type OptionalDeclarationValue,
} from '../../syntax/declaration-value';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import { TokenKind } from '../../syntax/tokens';
import {
  consumeSupportsCondition, consumeSupportsDeclaration,
  type SupportsCondition, type SupportsDeclaration,
} from '../../conditional/supports';
import {
  createBooleanExprConsumer, type BooleanExprValue,
} from '../boolean-expr';
import { createKeywordConsumer } from '../keyword';

/*
 * <if()> = if( [ <if-branch> ; ]* <if-branch> ;? )
 * <if-branch> = <if-condition> : <declaration-value>?
 * <if-condition> = <boolean-expr[ <if-test> ]> | else
 * <if-test> =
 *   supports( [ <ident> : <declaration-value> ] | <supports-condition> ) |
 *   media( <media-feature> | <media-condition> ) |
 *   style( <style-query> )
 *
 * Argument grammar:
 *
 * <if-args> = if( [ <if-args-branch> ; ]* <if-args-branch> ;? )
 * <if-args-branch> = <declaration-value> : <declaration-value>?
 */

export type IfValue = {
  type: 'if';
  branches: [IfBranch, ...IfBranch[]];
};

type IfBranch = {
  condition: IfCondition;
  value: OptionalDeclarationValue;
};

type IfCondition = BooleanExprValue<IfTest> | IfElseCondition;

// TODO: Add media() and style() as their condition grammars land.
type IfTest = SupportsTest;

type SupportsTest = {
  type: 'supports';
  condition: SupportsDeclaration | SupportsCondition;
};

type IfElseCondition = {
  type: 'else';
};

type IfArguments = {
  type: 'if-arguments';
  branches: [IfArgumentsBranch, ...IfArgumentsBranch[]];
};

type IfArgumentsBranch = {
  condition: DeclarationValue;
  value: OptionalDeclarationValue;
};

export function parseIf(input: ParserInput): IfValue | null {
  return ifParser(input);
}

export function consumeIf(
  c: TokenCursor,
): TryConsumerResult<IfValue> {
  return ifConsumer(c);
}

export function parseIfArguments(input: ParserInput): IfArguments | null {
  return ifArgumentsParser(input);
}

export function consumeIfArguments(
  c: TokenCursor,
): TryConsumerResult<IfArguments> {
  return ifArgumentsConsumer(c);
}

// =============================================================================
// Syntax
// =============================================================================

// [ <ident> : <declaration-value> ] | <supports-condition>
const supportsTestArgumentConsumer = oneOf(
  [
    one(consumeSupportsDeclaration),
    one(consumeSupportsCondition),
  ],
  ([condition]) => condition,
);

// supports( [ <ident> : <declaration-value> ] | <supports-condition> )
const supportsTestConsumer = createFunctionalNotationConsumer(
  'supports',
  supportsTestArgumentConsumer,
  (condition): SupportsTest => ({ type: 'supports', condition }),
);

// Currently supported branches of <if-test>.
const ifTestConsumer: TryConsumer<IfTest> = oneOf(
  [one(supportsTestConsumer)],
  ([test]) => test,
);

const elseConditionConsumer = createKeywordConsumer('else');

// <if-condition> = <boolean-expr[ <if-test> ]> | else
const ifConditionConsumer: TryConsumer<IfCondition> = oneOf(
  [
    one(createBooleanExprConsumer(ifTestConsumer)),
    one(elseConditionConsumer),
  ],
  ([condition]) => typeof condition === 'string'
    ? { type: condition }
    : condition,
);

const ifBranchValueConsumer = createFreeFormConsumer(
  consumeOptionalDeclarationValue,
  { stopBefore: (component) => isTokenKind(component, TokenKind.Semicolon) },
);

// <if-branch> = <if-condition> : <declaration-value>?
const ifBranchConsumer = createIfBranchConsumer(
  ifConditionConsumer,
  (condition, value): IfBranch => ({ condition, value }),
);

// <if()> = if( [ <if-branch> ; ]* <if-branch> ;? )
const ifConsumer = createFunctionalNotationConsumer(
  'if',
  createIfBranchListConsumer(ifBranchConsumer),
  (branches): IfValue => ({ type: 'if', branches }),
);

const ifParser = createComponentParser(withTrivia(ifConsumer));

// The first <declaration-value> in <if-args-branch>, excluding top-level colons.
const ifArgumentsConditionConsumer = createFreeFormConsumer(
  consumeDeclarationValue,
  { stopBefore: (component) => isTokenKind(component, TokenKind.Colon) },
);

// <if-args-branch> = <declaration-value> : <declaration-value>?
const ifArgumentsBranchConsumer = createIfBranchConsumer(
  ifArgumentsConditionConsumer,
  (condition, value): IfArgumentsBranch => ({ condition, value }),
);

// <if-args> = if( [ <if-args-branch> ; ]* <if-args-branch> ;? )
const ifArgumentsConsumer = createFunctionalNotationConsumer(
  'if',
  createIfBranchListConsumer(ifArgumentsBranchConsumer),
  (branches): IfArguments => ({ type: 'if-arguments', branches }),
);

const ifArgumentsParser = createComponentParser(withTrivia(ifArgumentsConsumer));

function createIfBranchConsumer<Condition, Branch>(
  conditionConsumer: TryConsumer<Condition>,
  project: (condition: Condition, value: OptionalDeclarationValue) => Branch,
): TryConsumer<Branch> {
  return (c) => {
    const start = c.pos();
    const condition = conditionConsumer(c);

    if (condition === null || withTrivia(consumeColon)(c) === null) {
      c.restore(start);
      return null;
    }

    const value = withTrivia(ifBranchValueConsumer)(c);

    if (value === null) {
      c.restore(start);
      return null;
    }

    return project(condition, value);
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
