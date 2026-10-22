import {
  createFreeFormConsumer, createFunctionalNotationConsumer, isBraceBlock, isTokenKind,
  commaRepeat, withTrivia, parseAsComponentGrammar, TokenKind,
  type TokenCursor, type TryConsumerResult, type ParserInput,
} from '../../syntax/index';

import { DeclarationValue } from '../declaration-value';

/** Ordered alternatives whose validity belongs to the consuming whole-value grammar. */
// https://drafts.csswg.org/css-values-5/#first-valid
export class FirstValidValue {
  /** Unevaluated alternatives, retained for lazy selection at Computed time. */
  value: [DeclarationValue, ...DeclarationValue[]];

  constructor(value: [DeclarationValue, ...DeclarationValue[]]) {
    this.value = value;
  }

  static parse(input: ParserInput, context: unknown): FirstValidValue | null {
    return parseAsComponentGrammar(input, firstValidGrammar, context);
  }

  static consume(this: void, c: TokenCursor): TryConsumerResult<FirstValidValue> {
    return firstValidConsumer(c);
  }

  serialize(): string {
    const args = this.value.map((declaration) => {
      const text = declaration.serialize();
      const requiresBraces = declaration.value.tokens.some((component) =>
        isTokenKind(component, TokenKind.Comma) || isBraceBlock(component)
      );
      return requiresBraces ? `{${text}}` : text;
    });
    return `first-valid(${args.join(', ')})`;
  }
}

/*
 * <first-valid()> = first-valid( <declaration-value># )
 */

// <declaration-value> as a strict free-form function argument
const firstValidArgumentConsumer = createFreeFormConsumer(
  DeclarationValue.consume,
);

const firstValidConsumer = createFunctionalNotationConsumer(
  'first-valid',
  commaRepeat(firstValidArgumentConsumer),
  (args) => new FirstValidValue(args),
);

const firstValidGrammar = withTrivia(firstValidConsumer);
