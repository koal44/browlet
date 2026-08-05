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
import { ValueStage } from '../../value-processing';
import {
  tryConsumeDeclarationValue, type DeclarationValue,
} from '../declaration-value';
import { guaranteedInvalidValue } from '../guaranteed-invalid';
import type { PropertyValue, RawPropertyValue } from '../property-value';

export type FirstValidNotation = {
  type: 'first-valid';
  arguments: [DeclarationValue, ...DeclarationValue[]];
};

export type FirstValidValue<Value, Context = unknown> = FirstValidNotation & {
  resolve: (stage: ValueStage, context: Context) => PropertyValue<Value, Context>;
  serialize: () => string;
};

export function parseFirstValid(input: ParserInput): FirstValidNotation | null {
  return parseAsComponentGrammar(input, withTrivia(tryConsumeFirstValid));
}

export function tryConsumeFirstValid(
  c: ComponentCursor,
): TryComponentConsumerResult<FirstValidNotation> {
  return consumeFirstValid(c);
}

export function createFirstValidValue<Value, Context>(
  notation: FirstValidNotation,
  parseInput: (
    input: ParserInput,
  ) => RawPropertyValue<Value, Context> | null,
): FirstValidValue<Value, Context> {
  const value: FirstValidValue<Value, Context> = {
    ...notation,
    resolve: (stage, context) => resolveFirstValidValue(
      value,
      parseInput,
      stage,
      context,
    ),
    serialize: () => serializeFirstValid(notation),
  };

  return value;
}

export function serializeFirstValid(value: FirstValidNotation): string {
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
  (args): FirstValidNotation => ({
    type: 'first-valid',
    arguments: args,
  }),
);

function resolveFirstValidValue<Value, Context>(
  value: FirstValidValue<Value, Context>,
  parseInput: (
    input: ParserInput,
  ) => RawPropertyValue<Value, Context> | null,
  stage: ValueStage,
  context: Context,
): PropertyValue<Value, Context> {
  if (stage < ValueStage.Computed) return value;

  for (const argument of value.arguments) {
    const resolved = parseInput(argument.components)
      ?.resolve(stage, context) ?? null;

    if (resolved !== null && resolved.type !== 'guaranteed-invalid') {
      return resolved;
    }
  }

  return guaranteedInvalidValue;
}

function requiresFreeFormWrapper(components: readonly ComponentValue[]): boolean {
  return components.some((component) =>
    isTokenKind(component, TokenKind.Comma) || isBraceBlock(component)
  );
}
