import {
  consumeFunctionBlock, consumeParensBlock, one, oneOf, withTrivia, serializeComponentValues,
  createComponentParser, parseAnyValue, serializeCssIdentifier, TokenKind,
  type TokenCursor, type TryConsumerResult, type FunctionBlock, type ParensBlock, type ParserInput,
  type AnyValue,
} from '../syntax/index';

/*
 * <general-enclosed> =
 *   [ <function-token> <any-value>? ) ] |
 *   [ ( <any-value>? ) ]
 */

export type GeneralEnclosedValue = {
  type: 'general-enclosed';
  value: GeneralEnclosedBlock;
};

export type GeneralEnclosedBlock =
  | FunctionBlock<AnyValue | undefined>
  | ParensBlock<AnyValue | undefined>;

export function parseGeneralEnclosed(input: ParserInput): GeneralEnclosedValue | null {
  return generalEnclosedParser(input);
}

export function consumeGeneralEnclosed(
  c: TokenCursor,
): TryConsumerResult<GeneralEnclosedValue> {
  return generalEnclosedConsumer(c);
}

export function resolveGeneralEnclosed(
  value: GeneralEnclosedValue,
): GeneralEnclosedValue {
  return value;
}

/** Serialize an opaque condition from its tokens, without interpreting an unknown grammar. */
// https://drafts.csswg.org/mediaqueries-4/#typedef-general-enclosed
// SPEC_GAP(media-general-enclosed-serialization): CSSOM has no serializer for
// this newer production. Retain token-based formatting, as WebKit does;
// Chromium/Firefox preserve exact source text. See cssom/ROADMAP.md.
export function serializeGeneralEnclosed(value: GeneralEnclosedValue): string {
  const block = value.value;
  const contents = block.value === undefined ? '' : serializeComponentValues(block.value.components.tokens);
  return block.type === TokenKind.FunctionBlock
    ? `${serializeCssIdentifier(block.name)}(${contents})`
    : `(${contents})`;
}

// =============================================================================
// Syntax
// =============================================================================

// CSS Syntax represents the alternatives as function and parentheses blocks.
const generalEnclosedConsumer = oneOf(
  [
    one(consumeFunctionBlock),
    one(consumeParensBlock),
  ],
  ([component]): GeneralEnclosedValue | null => {
    const value = component.value.tokens.length === 0
      ? undefined
      : parseAnyValue(component.value);

    return value === null
      ? null
      : {
        type: 'general-enclosed',
        value: { ...component, value },
      };
  },
);

const generalEnclosedParser = createComponentParser(withTrivia(generalEnclosedConsumer));
