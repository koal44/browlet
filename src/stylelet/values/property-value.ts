import { withTrivia } from '../parser/component-grammar';
import { serializeComponentValues } from '../parser/component-value';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { ValueStage } from '../value-processing';
import type { ColorContext } from './color';
import { tryConsumeCssWideValue, type CssWideValue } from './css-wide';
import {
  parseOptionalDeclarationValue,
  type DeclarationValue, type OptionalDeclarationValue,
} from './declaration-value';
import { guaranteedInvalidValue, type GuaranteedInvalidValue } from './guaranteed-invalid';
import type { ImageContext } from './image';
import type { MathContext } from './math-value';
import {
  containsSubstitutionFunction, createSubstitutionValue,
  type SubstitutionValue,
} from './substitution-value';
import {
  createFirstValidValue, parseFirstValid, type FirstValidValue,
} from './substitution/first-valid';
import {
  createSyntaxConsumer, resolveParsedSyntaxValue, serializeParsedSyntaxValue,
  type ParsedSyntaxValue, type SyntaxValue,
} from './syntax-value';
import type { ValueDefinition } from './value-definition';

export type PropertyContext =
  & MathContext
  & ColorContext
  & ImageContext;

export type PropertyValue<Value, Context = unknown> =
  | ValueInstance<Value, Context>
  | FirstValidValue<Value, Context>
  | SubstitutionValue<Value, Context>
  | RawPropertyValue<Value, Context>
  | GuaranteedInvalidValue
  | CssWideValue<Value, Context>;

export type ValueInstance<Value, Context = unknown> = {
  type: 'value-instance';
  value: Value;
  resolve: (stage: ValueStage, context: Context) => PropertyValue<Value, Context>;
  serialize: () => string;
  add?: (value: Value, context: Context) => Value;
  accumulate?: (value: Value, context: Context) => Value;
  interpolate?: (value: Value, progress: number, context: Context) => Value;
};

export type RawPropertyValue<Value, Context = unknown> = {
  type: 'raw-property-value';
  declaration: OptionalDeclarationValue;
  resolve: (stage: ValueStage, context: Context) => PropertyValue<Value, Context> | null;
  serialize: () => string;
};

export function defineCustomProperty(definition: { syntax: SyntaxValue; }) {
  const syntaxDef: ValueDefinition<ParsedSyntaxValue, PropertyContext> = {
    tryConsume: createSyntaxConsumer(definition.syntax),
    resolve: resolveParsedSyntaxValue,
    serialize: serializeParsedSyntaxValue,
    parseAt: ValueStage.Computed,
    onParseFailure: 'guaranteed-invalid',
  };

  return defineProperty(syntaxDef);
}

export function defineProperty<Value, Context>(
  definition: ValueDefinition<Value, Context>,
) {
  function parse(
    input: ParserInput,
  ): RawPropertyValue<Value, Context> | null {
    const declaration = parseOptionalDeclarationValue(input);

    if (declaration === null) return null;

    const value: RawPropertyValue<Value, Context> = {
      type: 'raw-property-value',
      declaration,
      resolve: (stage, context) => resolveRawPropertyValue(value, stage, context),
      serialize: () => serializeComponentValues(declaration.components),
    };

    return value;
  }

  function resolveRawPropertyValue(
    value: RawPropertyValue<Value, Context>,
    stage: ValueStage,
    context: Context,
  ): PropertyValue<Value, Context> | null {
    const { declaration } = value;
    const cssWideValue = parseAsComponentGrammar(
      declaration.components,
      withTrivia(tryConsumeCssWideValue<Value, Context>),
    );

    if (cssWideValue !== null) return cssWideValue.resolve(stage, context);

    if (isSubstitutionDeclaration(declaration)) {
      return createSubstitutionValue(declaration, parse)
        .resolve(stage, context);
    }

    const firstValid = parseFirstValid(declaration.components);

    if (firstValid !== null) {
      return createFirstValidValue(firstValid, parse)
        .resolve(stage, context);
    }

    if (definition.parseAt !== undefined && stage < definition.parseAt) {
      return value;
    }

    const result = parseAndResolveRawValueFromSyntax(
      value,
      definition,
      stage,
      context,
    );

    if (
      result === null &&
      definition.onParseFailure === 'guaranteed-invalid'
    ) {
      return guaranteedInvalidValue;
    }

    return result;
  }
  return { parse };
}

function isSubstitutionDeclaration(
  declaration: OptionalDeclarationValue,
): declaration is DeclarationValue {
  return containsSubstitutionFunction(declaration.components);
}

function parseAndResolveRawValueFromSyntax<Value, Context>(
  raw: RawPropertyValue<Value, Context>,
  definition: ValueDefinition<Value, Context>,
  stage: ValueStage,
  context: Context,
): PropertyValue<Value, Context> | null {
  const value = parseRawValueFromSyntax(raw, definition);

  return value === null ? null : value.resolve(stage, context);
}

function parseRawValueFromSyntax<Value, Context>(
  raw: RawPropertyValue<Value, Context>,
  definition: ValueDefinition<Value, Context>,
): ValueInstance<Value, Context> | null {
  const value = parseAsComponentGrammar(
    raw.declaration.components,
    withTrivia(definition.tryConsume),
  );

  return value === null ? null : createValueInstance(value, definition);
}

function createValueInstance<Value, Context>(
  value: Value,
  definition: ValueDefinition<Value, Context>,
): ValueInstance<Value, Context> {
  return {
    type: 'value-instance',
    value,
    resolve: (stage, context) => {
      const resolved = definition.resolve(value, stage, context);
      return createValueInstance(resolved, definition);
    },
    serialize: () => definition.serialize(value),
  };
}
