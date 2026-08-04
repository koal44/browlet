import { withTrivia } from '../parser/component-grammar';
import { serializeComponentValues } from '../parser/component-value';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { ValueStage } from '../value-processing';
import type { ColorContext } from './color';
import { tryConsumeCssWideValue, type CssWideValue } from './css-wide';
import {
  parseDeclarationValue, parseOptionalDeclarationValue,
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
  createSyntaxConsumer, resolveParsedSyntaxValue, serializeParsedSyntaxValue,
  type ParsedSyntaxValue, type SyntaxValue,
} from './syntax-value';
import {
  createWholeValueParser, type WholeValue, type WholeValueParser,
} from './whole-value';
import type { ValueDefinition } from './value-definition';

export type PropertyContext =
  & MathContext
  & ColorContext
  & ImageContext;

export type PropertyValue<Value, Context = unknown> =
  | WholeValue<Value, Context>
  | SubstitutionValue<Value, Context>
  | CustomPropertyValue<Value, Context>
  | GuaranteedInvalidValue
  | CssWideValue<Value, Context>;

export type CustomPropertyValue<Value, Context = unknown> = {
  type: 'custom-property-value';
  declaration: OptionalDeclarationValue;
  resolve: (stage: ValueStage, context: Context) => PropertyValue<Value, Context>;
  serialize: () => string;
};

export type Property<Value, Context = unknown> = {
  parse: (input: ParserInput) => PropertyValue<Value, Context> | null;
};

export function defineProperty<Value, Context = unknown>(
  definition: ValueDefinition<Value, Context>,
): Property<Value, Context> {
  const parseWholeValue = createWholeValueParser(
    definition.tryConsume,
    definition.resolve,
    definition.serialize,
  );

  return {
    parse: (input) => parsePropertyValue(input, {
      parseDeclarationValue,
      parseWholeValue,
      parseOrdinaryValue: (declaration) =>
        parseWholeValue(declaration.components),
    }),
  };
}

type PropertyValueParseOptions<Value, Context, Declaration> = {
  parseDeclarationValue: (input: ParserInput) => Declaration | null;
  parseWholeValue: WholeValueParser<Value, Context>;
  parseOrdinaryValue: (
    declaration: Declaration,
  ) => PropertyValue<Value, Context> | null;
};

function parsePropertyValue<
  Value,
  Context,
  Declaration extends OptionalDeclarationValue,
>(
  input: ParserInput,
  {
    parseDeclarationValue,
    parseWholeValue,
    parseOrdinaryValue,
  }: PropertyValueParseOptions<Value, Context, Declaration>,
): PropertyValue<Value, Context> | null {
  const declaration = parseDeclarationValue(input);

  if (declaration === null) return null;

  const cssWideValue = parseAsComponentGrammar(
    declaration.components,
    withTrivia(tryConsumeCssWideValue<Value, Context>),
  );

  if (cssWideValue !== null) return cssWideValue;

  if (isSubstitutionDeclaration(declaration)) {
    return createSubstitutionValue(declaration, parseWholeValue);
  }

  return parseOrdinaryValue(declaration);
}

export function defineCustomProperty(definition: {
  syntax: SyntaxValue;
}): Property<ParsedSyntaxValue, PropertyContext> {
  const parseWholeValue = createWholeValueParser<ParsedSyntaxValue, PropertyContext>(
    createSyntaxConsumer(definition.syntax),
    resolveParsedSyntaxValue,
    serializeParsedSyntaxValue,
  );

  const parseOrdinaryValue = (declaration: OptionalDeclarationValue) => {
    const value: CustomPropertyValue<ParsedSyntaxValue, PropertyContext> = {
      type: 'custom-property-value',
      declaration,
      resolve: (stage, context) => resolveCustomPropertyValue(
        value,
        parseWholeValue,
        stage,
        context,
      ),
      serialize: () => serializeComponentValues(declaration.components),
    };

    return value;
  };

  return {
    parse: (input) => parsePropertyValue(input, {
      parseDeclarationValue: parseOptionalDeclarationValue,
      parseWholeValue,
      parseOrdinaryValue,
    }),
  };
}

function isSubstitutionDeclaration(
  declaration: OptionalDeclarationValue,
): declaration is DeclarationValue {
  return containsSubstitutionFunction(declaration.components);
}

function resolveCustomPropertyValue<Value, Context>(
  value: CustomPropertyValue<Value, Context>,
  parseWholeValue: WholeValueParser<Value, Context>,
  stage: ValueStage,
  context: Context,
): PropertyValue<Value, Context> {
  if (stage < ValueStage.Computed) return value;

  const parsedResult = parseWholeValue(value.declaration.components);

  if (parsedResult === null) {
    return guaranteedInvalidValue;
  }

  return parsedResult.resolve(stage, context);
}
