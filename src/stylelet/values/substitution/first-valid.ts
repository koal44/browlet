import { createFreeFormConsumer, createFunctionalNotationConsumer } from '../../syntax/component-consumers';
import {
  isBraceBlock, isTokenKind, serializeComponentValues,
  type ComponentValue,
} from '../../syntax/component-value';
import { commaRepeat, withTrivia } from '../../syntax/component-grammar';
import {
  type TokenCursor, type TryConsumerResult,
} from '../../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
import { TokenKind } from '../../syntax/tokens';
import {
  consumeDeclarationValue, type DeclarationValue,
} from '../../syntax/declaration-value';

export type FirstValidValue = {
  type: 'first-valid';
  arguments: [DeclarationValue, ...DeclarationValue[]];
};

export function parseFirstValid(input: ParserInput): FirstValidValue | null {
  return firstValidParser(input);
}

export function consumeFirstValid(
  c: TokenCursor,
): TryConsumerResult<FirstValidValue> {
  return firstValidConsumer(c);
}

export function serializeFirstValid(value: FirstValidValue): string {
  const args = value.arguments.map(({ components }) =>
    requiresFreeFormWrapper(components)
      ? `{${serializeComponentValues(components)}}`
      : serializeComponentValues(components)
  );

  return `first-valid(${args.join(', ')})`;
}

function requiresFreeFormWrapper(components: readonly ComponentValue[]): boolean {
  return components.some((component) =>
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
