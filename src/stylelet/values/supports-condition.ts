import {
  consumeParensBlock, adaptConsumer, withTrivia, isTokenKind, parseDeclaration, createComponentParser,
  parseAsComponentGrammar, TokenKind,
  type TokenCursor, type TryConsumerResult, type ParserInput, type Declaration,
} from '../syntax/index';

import { createBooleanExprConsumer, type BooleanExprValue } from './boolean-expr';

/*
 * <supports-condition> =
 *   not <supports-in-parens> |
 *   <supports-in-parens> [ and <supports-in-parens> ]* |
 *   <supports-in-parens> [ or <supports-in-parens> ]*
 *
 * <supports-in-parens> =
 *   ( <supports-condition> ) | <supports-feature> | <general-enclosed>
 *
 * <supports-feature> = <supports-decl>
 * <supports-decl> = ( <declaration> )
 */

export type SupportsCondition = BooleanExprValue<SupportsFeature>;

export type SupportsContext = {
  supports?: (declaration: Declaration) => boolean;
};

type SupportsFeature = SupportsDeclaration;

export type SupportsDeclaration = {
  type: 'supports-declaration';
  declaration: Declaration;
};

export function parseSupportsCondition(
  input: ParserInput,
): SupportsCondition | null {
  return supportsConditionParser(input);
}

export function consumeSupportsCondition(
  c: TokenCursor,
): TryConsumerResult<SupportsCondition> {
  return supportsConditionConsumer(c);
}

export function consumeSupportsDeclaration(
  c: TokenCursor,
): TryConsumerResult<SupportsDeclaration> {
  const start = c.pos();
  const declaration = parseDeclaration(c, c.context);

  if (
    declaration === null ||
    declaration.value.tokens.some((component) =>
      isTokenKind(component, TokenKind.Semicolon)
    )
  ) {
    c.restore(start);
    return null;
  }

  return {
    type: 'supports-declaration',
    declaration,
  };
}

// =============================================================================
// Syntax
// =============================================================================

// <supports-decl> = ( <declaration> )
const supportsDeclarationConsumer = adaptConsumer(
  consumeParensBlock,
  (block, context) => parseAsComponentGrammar(
    block.value,
    withTrivia(consumeSupportsDeclaration),
    context,
  ),
);

// <supports-condition>
const supportsConditionConsumer = createBooleanExprConsumer(
  supportsDeclarationConsumer,
);

const supportsConditionParser = createComponentParser(
  withTrivia(supportsConditionConsumer),
);
