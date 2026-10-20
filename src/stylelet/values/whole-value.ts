import { InternalError } from '../../infra/internal-error';

import {
  serializeComponentValues, adaptConsumer, withTrivia, createComponentParser,
  parseOptionalDeclarationValue,
  type TryConsumer, type TokenCursor, type ParserInput, type OptionalDeclarationValue,
} from '../syntax/index';
import { ValueStage, type ValueDefinition } from '../value-processing/index';
import type { PropertyContext } from '../css/index';

import {
  consumeCssWideValue, type CssWideValue,
} from './css-wide';
import {
  isSubstitutionDeclaration, resolveSubstitutionFunction,
  type SubstitutionValue,
} from './substitution-value';
import {
  serializeFirstValid, consumeFirstValid,
  type FirstValidValue,
} from './substitution/first-valid';
import {
  createSyntaxConsumer, resolveParsedSyntaxValue, serializeParsedSyntaxValue,
  type ParsedSyntaxValue, type SyntaxValue,
} from './syntax-value';

/** Retained value data; its whole-value definition supplies lifecycle operations. */
export type WholeValue<Value> =
  | RawWholeValue
  | SubstitutionValue
  | CssWideValue
  | OrdinaryWholeValue<Value>
  | FirstValidValue
  | GuaranteedInvalidValue;

/** Registered-property syntax retained until Computed-time grammar validation. */
export type RawWholeValue = {
  type: 'raw';
  declaration: OptionalDeclarationValue;
};

type OrdinaryWholeValue<Value> = {
  type: 'ordinary';
  value: Value;
};

type ParsedWholeValue<Value> =
  | CssWideValue
  | OrdinaryWholeValue<Value>
  | FirstValidValue;

/** Shared grammar and lifecycle behavior for whole-property values. */
export type WholeValueDefinition<Value, Context> = {
  /** Interpret a Declared value, preserving syntax whose validation must wait until Computed. */
  parse: (input: ParserInput, context: Context) => WholeValue<Value> | null;
  /** Process a retained value at the requested stage; invalid computed values remain explicit. */
  resolve: (value: WholeValue<Value>, stage: ValueStage, context: Context) => WholeValue<Value>;
  /** Serialize the retained representation without advancing its stage. */
  serialize: (value: WholeValue<Value>) => string;
};

export type GuaranteedInvalidValue = {
  type: 'guaranteed-invalid';
};

export const guaranteedInvalidValue: GuaranteedInvalidValue = {
  type: 'guaranteed-invalid',
};

/** Bind a registered property's syntax to the shared whole-value lifecycle. */
export function defineCustomWholeValue(definition: { syntax: SyntaxValue; }) {
  const syntaxDef: ValueDefinition<ParsedSyntaxValue, PropertyContext> = {
    consume: createSyntaxConsumer(definition.syntax),
    resolve: resolveParsedSyntaxValue,
    serialize: serializeParsedSyntaxValue,
    custom: true,
  };

  return defineWholeValue(syntaxDef);
}

/** Add whole-value forms to a grammar whose consumer prepares its Declared representation. */
export function defineWholeValue<Value, Context>(
  definition: ValueDefinition<Value, Context>,
): WholeValueDefinition<Value, Context> {
  const ordinaryConsumer = adaptConsumer(
    definition.consume,
    (value): OrdinaryWholeValue<Value> => ({ type: 'ordinary', value }),
  );
  const consume: TryConsumer<ParsedWholeValue<Value>, Context> = (c) =>
    consumeWholeValueNotation(c) ?? ordinaryConsumer(c);
  const parseValue = createComponentParser(withTrivia(consume));
  const parseInitialValue = definition.custom
    ? wholeValueNotationParser
    : parseValue;

  const wholeValueDef: WholeValueDefinition<Value, Context> = {
    parse(input, context) {
      const declaration = parseOptionalDeclarationValue(input, context);
      if (declaration === null) return null;

      if (isSubstitutionDeclaration(declaration)) {
        return { type: 'substitution-value', declaration };
      }

      const parsed = parseInitialValue(declaration.components, context);
      return parsed ?? (definition.custom ? { type: 'raw', declaration } : null);
    },
    resolve(value, stage, context) {
      switch (value.type) {
        case 'raw': {
          if (stage < ValueStage.Computed) return value;

          const parsed = parseValue(value.declaration.components, context);
          return parsed === null ? guaranteedInvalidValue : wholeValueDef.resolve(parsed, stage, context);
        }
        case 'ordinary':
          return { type: 'ordinary', value: definition.resolve(value.value, stage, context) };
        case 'first-valid':
          if (stage < ValueStage.Computed) return value;

          for (const argument of value.arguments) {
            const parsed = wholeValueDef.parse(argument.components, context);
            if (parsed === null) continue;

            const resolved = wholeValueDef.resolve(parsed, stage, context);
            if (resolved.type !== 'guaranteed-invalid') return resolved;
          }
          return guaranteedInvalidValue;
        case 'substitution-value': {
          if (stage < ValueStage.Computed) return value;

          const substituted = resolveSubstitutionFunction(value.declaration.components, context);
          if ('type' in substituted) return substituted;

          const parsed = wholeValueDef.parse(substituted, context);
          if (parsed === null) {
            throw new InternalError('Handling substituted parse failure is not implemented');
          }
          return wholeValueDef.resolve(parsed, stage, context);
        }
        case 'css-wide':
          // TODO: Apply CSS-wide keywords through engine defaulting.
          return value;
        case 'guaranteed-invalid':
          return value;
      }
    },
    serialize(value) {
      switch (value.type) {
        case 'raw':
        case 'substitution-value':
          return serializeComponentValues(value.declaration.components.tokens);
        case 'ordinary':
          return definition.serialize(value.value);
        case 'first-valid':
          return serializeFirstValid(value);
        case 'css-wide':
          return value.keyword;
        case 'guaranteed-invalid':
          return '';
      }
    },
  };

  return wholeValueDef;
}

/** Recognize whole-value notation independently of the property's ordinary grammar. */
function consumeWholeValueNotation(c: TokenCursor): CssWideValue | FirstValidValue | null {
  return consumeCssWideValue(c) ?? consumeFirstValid(c);
}

const wholeValueNotationParser = createComponentParser(withTrivia(consumeWholeValueNotation));
