import { createFreeFormConsumer, createFunctionalNotationConsumer } from '../../parser/component-consumers';
import {
  type ComponentCursor, type TryComponentConsumerResult,
} from '../../parser/component-cursor';
import {
  isBraceBlock, isTokenKind, serializeComponentValues,
  type ComponentValue,
} from '../../parser/component-value';
import { commaRepeat, withTrivia } from '../../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { TokenKind } from '../../parser/tokens';
import {
  tryConsumeDeclarationValue, type DeclarationValue,
} from '../declaration-value';

export type FirstValidValue = {
  type: 'first-valid';
  arguments: [DeclarationValue, ...DeclarationValue[]];
};

export function parseFirstValid(input: ParserInput): FirstValidValue | null {
  return parseAsComponentGrammar(input, withTrivia(tryConsumeFirstValid));
}

export function tryConsumeFirstValid(
  c: ComponentCursor,
): TryComponentConsumerResult<FirstValidValue> {
  return consumeFirstValid(c);
}

export function serializeFirstValid(value: FirstValidValue): string {
  const args = value.arguments.map(({ components }) =>
    requiresFreeFormWrapper(components)
      ? `{${serializeComponentValues(components)}}`
      : serializeComponentValues(components)
  );

  return `first-valid(${args.join(', ')})`;
}

// =============================================================================
// Syntax
// =============================================================================

// <declaration-value> as a strict free-form function argument
const consumeFirstValidArgument = createFreeFormConsumer(
  tryConsumeDeclarationValue,
);

// <first-valid()> = first-valid( <declaration-value># )
const consumeFirstValid = createFunctionalNotationConsumer(
  'first-valid',
  commaRepeat(consumeFirstValidArgument),
  (args): FirstValidValue => ({
    type: 'first-valid',
    arguments: args,
  }),
);

function requiresFreeFormWrapper(components: readonly ComponentValue[]): boolean {
  return components.some((component) =>
    isTokenKind(component, TokenKind.Comma) || isBraceBlock(component)
  );
}
