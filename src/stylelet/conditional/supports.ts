import {
  consumeParensBlock,
} from '../syntax/component-consumers';
import {
  adaptConsumer, withTrivia,
} from '../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumerResult,
} from '../syntax/token-cursor';
import { isTokenKind } from '../syntax/component-value';
import {
  consumeDeclaration, createComponentParser, parseAsComponentGrammar,
  type ParserInput,
} from '../syntax/parser';
import type { Declaration } from '../syntax/rule';
import { TokenKind } from '../syntax/tokens';
import {
  createBooleanExprConsumer, type BooleanExprValue,
} from '../values/boolean-expr';

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
  const declaration = consumeDeclaration(c);

  if (
    declaration === null ||
    declaration.value.some((component) =>
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
