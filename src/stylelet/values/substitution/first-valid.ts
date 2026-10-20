import {
  createFreeFormConsumer, createFunctionalNotationConsumer, isBraceBlock, isTokenKind,
  serializeComponentValues, commaRepeat, withTrivia, createComponentParser, TokenKind,
  consumeDeclarationValue,
  type ComponentValue, type TokenList, type TokenCursor, type TryConsumerResult, type ParserInput, type DeclarationValue,
} from '../../syntax/index';

export type FirstValidValue = {
  type: 'first-valid';
  arguments: [DeclarationValue, ...DeclarationValue[]];
};

export function parseFirstValid(input: ParserInput, context: unknown): FirstValidValue | null {
  return firstValidParser(input, context);
}

export function consumeFirstValid(
  c: TokenCursor,
): TryConsumerResult<FirstValidValue> {
  return firstValidConsumer(c);
}

export function serializeFirstValid(value: FirstValidValue): string {
  const args = value.arguments.map(({ components: list }) =>
    requiresFreeFormWrapper(list)
      ? `{${serializeComponentValues(list.tokens)}}`
      : serializeComponentValues(list.tokens)
  );

  return `first-valid(${args.join(', ')})`;
}

function requiresFreeFormWrapper(list: TokenList<ComponentValue>): boolean {
  return list.tokens.some((component) =>
    isTokenKind(component, TokenKind.Comma) || isBraceBlock(component)
  );
}

// =============================================================================
// Syntax
// =============================================================================

// <declaration-value> as a strict free-form function argument
const firstValidArgumentConsumer = createFreeFormConsumer(
  consumeDeclarationValue,
);

// <first-valid()> = first-valid( <declaration-value># )
const firstValidConsumer = createFunctionalNotationConsumer(
  'first-valid',
  commaRepeat(firstValidArgumentConsumer),
  (args): FirstValidValue => ({
    type: 'first-valid',
    arguments: args,
  }),
);

const firstValidParser = createComponentParser(withTrivia(firstValidConsumer));
