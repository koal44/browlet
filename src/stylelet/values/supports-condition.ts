import { InternalError } from '../../infra/internal-error';

import {
  consumeParensBlock, adaptConsumer, withTrivia, isTokenKind, parseDeclaration, createComponentParser,
  parseAsComponentGrammar, TokenKind,
  type TokenCursor, type TryConsumerResult, type ParserInput, type Declaration,
} from '../syntax/index';

import { BooleanExprValue } from './boolean-expr';

/** A supports condition with declaration-support evaluation supplied by its caller. */
// https://drafts.csswg.org/css-conditional-3/#supports_condition
export class SupportsConditionValue {
  /** The parsed expression; no declaration-support callback is retained. */
  value: BooleanExprValue<SupportsDeclaration>;

  constructor(value: BooleanExprValue<SupportsDeclaration>) {
    this.value = value;
  }

  /** Parse one complete supports condition. */
  static parse(input: ParserInput, context: unknown): SupportsConditionValue | null {
    return supportsConditionParser(input, context);
  }

  /** Consume a condition using the declaration-feature grammar. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<SupportsConditionValue> {
    return supportsConditionConsumer(c);
  }

  /** Evaluate declaration support, treating general-enclosed as false. */
  evaluate(context: SupportsContext): boolean {
    const supports = context.supports;
    if (supports === undefined) throw new InternalError('Supports evaluation requires a declaration-support query');
    return this.value.evaluate({
      evaluateTest: (feature) => supports(feature.declaration),
      evaluateGeneralEnclosed: () => false,
    }) === true;
  }
}

export type SupportsContext = {
  supports?: (declaration: Declaration) => boolean;
};

export type SupportsDeclaration = {
  type: 'supports-declaration';
  declaration: Declaration;
};

/** Consume the declaration tested by a supports feature. */
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

const supportsDeclarationGrammar = withTrivia(consumeSupportsDeclaration);

// <supports-decl> = ( <declaration> )
const supportsDeclarationConsumer = adaptConsumer(
  consumeParensBlock,
  (block, context) => parseAsComponentGrammar(
    block.value,
    supportsDeclarationGrammar,
    context,
  ),
);

// <supports-condition>
const supportsConditionConsumer = adaptConsumer(
  BooleanExprValue.createConsumer(supportsDeclarationConsumer),
  (expression) => new SupportsConditionValue(expression),
);

const supportsConditionParser = createComponentParser(
  withTrivia(supportsConditionConsumer),
);
