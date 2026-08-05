import type { TryComponentConsumer } from '../parser/component-cursor';
import { serializeComponentValues } from '../parser/component-value';
import {
  adaptConsumer, withTrivia,
} from '../parser/component-grammar';
import { parseAsComponentGrammar,
  type ParserInput } from '../parser/syntax';
import { ValueStage, type PropertyContext } from '../value-processing';
import {
  tryConsumeCssWideValue, type CssWideValue,
} from './css-wide';
import {
  parseOptionalDeclarationValue,
  type OptionalDeclarationValue,
} from './declaration-value';
import {
  guaranteedInvalidValue,
  type GuaranteedInvalidValue,
} from './guaranteed-invalid';
import {
  createSubstitutionValue, isSubstitutionDeclaration,
  type SubstitutionValue,
} from './substitution-value';
import {
  serializeFirstValid, tryConsumeFirstValid,
  type FirstValidValue,
} from './substitution/first-valid';
import type { ValueDefinition } from './value-definition';
import {
  createSyntaxConsumer, resolveParsedSyntaxValue, serializeParsedSyntaxValue,
  type ParsedSyntaxValue, type SyntaxValue,
} from './syntax-value';

export type WholeValue<Value, Context = unknown> =
  | RawWholeValue<Value, Context>
  | SubstitutionValue<Value, Context>
  | CssWideValue<Value, Context>
  | OrdinaryWholeValue<Value, Context>
  | FirstValidWholeValue<Value, Context>
  | GuaranteedInvalidValue;

export type RawWholeValue<Value, Context = unknown> = {
  type: 'raw';
  declaration: OptionalDeclarationValue;
  resolve: (
    stage: ValueStage,
    context: Context,
  ) => WholeValue<Value, Context> | null;
  serialize: () => string;
};

type WholeValueMethods<Value, Context> = {
  resolve: (stage: ValueStage, context: Context) => WholeValue<Value, Context>;
  serialize: () => string;
};

type OrdinaryWholeValue<Value, Context> = WholeValueMethods<Value, Context> & {
  type: 'ordinary';
  value: Value;
  definition: ValueDefinition<Value, Context>;
  add?: (value: Value, context: Context) => Value;
  accumulate?: (value: Value, context: Context) => Value;
  interpolate?: (value: Value, progress: number, context: Context) => Value;
};

type FirstValidWholeValue<Value, Context> =
  & WholeValueMethods<Value, Context>
  & FirstValidValue;

type ParsedWholeValue<Value, Context> =
  | CssWideValue<Value, Context>
  | OrdinaryWholeValue<Value, Context>
  | FirstValidWholeValue<Value, Context>;

type WholeValueDefinition<Value, Context> = {
  parse: (input: ParserInput) => RawWholeValue<Value, Context> | null;
  consume: TryComponentConsumer<ParsedWholeValue<Value, Context>>;
};

export function defineCustomProperty(definition: { syntax: SyntaxValue; }) {
  const syntaxDef: ValueDefinition<ParsedSyntaxValue, PropertyContext> = {
    tryConsume: createSyntaxConsumer(definition.syntax),
    resolve: resolveParsedSyntaxValue,
    serialize: serializeParsedSyntaxValue,
    custom: true,
  };

  return defineProperty(syntaxDef);
}

export function defineProperty<Value, Context>(
  definition: ValueDefinition<Value, Context>,
): WholeValueDefinition<Value, Context> {
  function parse(input: ParserInput): RawWholeValue<Value, Context> | null {
    const declaration = parseOptionalDeclarationValue(input);

    if (declaration === null) return null;

    const value: RawWholeValue<Value, Context> = {
      type: 'raw',
      declaration,
      resolve: (stage, ctx) => resolveRaw(value, stage, ctx),
      serialize: () => serializeComponentValues(declaration.components),
    };

    return value;
  }

  const consumeFirstValid = adaptConsumer(
    tryConsumeFirstValid,
    (value) => createFirstValidWholeValue(value, parse),
  );
  const consumeOrdinary = adaptConsumer(
    definition.tryConsume,
    (value) => createOrdinaryWholeValue(value, definition),
  );
  const consume: TryComponentConsumer<ParsedWholeValue<Value, Context>> =
    (c) => tryConsumeCssWideValue(c) ?? consumeFirstValid(c) ?? consumeOrdinary(c);

  function resolveRaw(
    value: RawWholeValue<Value, Context>,
    stage: ValueStage,
    context: Context,
  ): WholeValue<Value, Context> | null {
    const { declaration } = value;

    if (isSubstitutionDeclaration(declaration)) {
      return createSubstitutionValue(declaration, parse)
        .resolve(stage, context);
    }

    const parsed = parseAsComponentGrammar(
      declaration.components,
      withTrivia(consume),
      context,
    );

    if (definition.custom && (parsed === null || parsed.type === 'ordinary')) {
      if (stage < ValueStage.Computed) return value;
      if (parsed === null) return guaranteedInvalidValue;
    }

    return parsed?.resolve(stage, context) ?? null;
  }

  return { parse, consume };
}

function createFirstValidWholeValue<Value, Context>(
  node: FirstValidValue,
  parseInput: (
    input: ParserInput,
  ) => RawWholeValue<Value, Context> | null,
): FirstValidWholeValue<Value, Context> {
  const value: FirstValidWholeValue<Value, Context> = {
    ...node,
    resolve: (stage, context) => resolveFirstValidWholeValue(
      value,
      parseInput,
      stage,
      context,
    ),
    serialize: () => serializeFirstValid(node),
  };

  return value;
}

function resolveFirstValidWholeValue<Value, Context>(
  value: FirstValidWholeValue<Value, Context>,
  parseInput: (
    input: ParserInput,
  ) => RawWholeValue<Value, Context> | null,
  stage: ValueStage,
  context: Context,
): WholeValue<Value, Context> {
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

function createOrdinaryWholeValue<Value, Context>(
  value: Value,
  definition: ValueDefinition<Value, Context>,
): OrdinaryWholeValue<Value, Context> {
  const wholeValue: OrdinaryWholeValue<Value, Context> = {
    type: 'ordinary',
    value,
    definition,
    resolve: (stage, context) => createOrdinaryWholeValue(
      wholeValue.definition.resolve(value, stage, context),
      wholeValue.definition,
    ),
    serialize: () => wholeValue.definition.serialize(value),
  };

  return wholeValue;
}
