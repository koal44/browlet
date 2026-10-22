import type { CustomPropertyName, ParserInput } from '../syntax/index';
import {
  WholeValue, PendingSubstitutionValue,
  type Value, type ColorContext, type GradientContext, type MathContext, type PositionContext,
  type ParsedSyntaxValue, type SyntaxValue, type UrlContext, type SupportsContext, type SubstitutionContext,
  type PendingShorthand,
} from '../values/index';

/** Shared built-in property record; its registry key supplies the name. */
export class PropertyRecord<Ordinary extends Value<Context>, Context extends PropertyContext = PropertyContext> {
  /** Whether defaulting inherits the parent's computed value. */
  inherits: boolean;
  /** Shared Declared representation; resolution must leave this value unchanged. */
  initialValue: WholeValue<Ordinary, Context>;
  /** Group and mapping used to preserve order between physical and logical properties. */
  logicalGroup?: { name: string; mapping: 'physical' | 'logical'; };
  /** Ordinary grammar retained by every complete value constructed for this property. */
  #parseValue: (input: ParserInput, context: Context) => Ordinary | null;

  constructor(
    parseValue: (input: ParserInput, context: NoInfer<Context>) => Ordinary | null,
    options: {
      inherits: boolean;
      initialValue: Ordinary;
      logicalGroup?: PropertyRecord<Ordinary, Context>['logicalGroup'];
    },
  ) {
    this.#parseValue = parseValue;
    this.inherits = options.inherits;
    this.initialValue = this.createValue(options.initialValue);
    this.logicalGroup = options.logicalGroup;
  }

  /** Parse this property's ordinary grammar and whole-value notation. */
  parse(input: ParserInput, context: Context): WholeValue<Ordinary, Context> | null {
    return WholeValue.parse<Ordinary, Context>(input, context, this.#parseValue);
  }

  /** Retain an already-parsed value with this property's grammar, without reparsing it. */
  createValue(value: WholeValue<Ordinary, Context>['value']): WholeValue<Ordinary, Context> {
    return new WholeValue<Ordinary, Context>(value, this.#parseValue);
  }

  /** Retain one longhand's position in a shorthand that must be expanded after substitution. */
  createPendingValue(shorthand: PendingShorthand<Ordinary, Context>, index: number): PendingSubstitutionValue<Ordinary, Context> {
    return new PendingSubstitutionValue(shorthand, index, this.#parseValue);
  }
}

export type PropertyContext =
  & MathContext
  & ColorContext
  & GradientContext
  & PositionContext
  & UrlContext
  & SupportsContext
  & SubstitutionContext;

export type CustomPropertyRegistration = {
  name: CustomPropertyName;
  syntax: SyntaxValue;
  parse: (input: ParserInput, context: PropertyContext) => WholeValue<ParsedSyntaxValue> | null;
  inherits: boolean;
  initialValue: WholeValue<ParsedSyntaxValue>;
};

export type CustomPropertyRegistry = ReadonlyMap<
  CustomPropertyName,
  CustomPropertyRegistration
>;
