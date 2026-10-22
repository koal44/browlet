import type { ParserInput } from '../syntax/index';
import type {
  Value, ColorContext, GradientContext, MathContext, PositionContext, ParsedSyntaxValue,
  SyntaxValue, UrlContext, WholeValue, SupportsContext,
} from '../values/index';

/** Shared built-in property record; its registry key supplies the name. */
export type PropertyRecord<Ordinary extends Value<Context>, Context> = {
  /** Shared parser for this property's ordinary grammar and whole-value notation. */
  parse: (input: ParserInput, context: Context) => WholeValue<Ordinary, Context> | null;
  /** Whether defaulting inherits the parent's computed value. */
  inherits: boolean;
  /** Shared Declared representation; resolution must leave this value unchanged. */
  initialValue: WholeValue<Ordinary, Context>;
  /** Group and mapping used to preserve order between physical and logical properties. */
  logicalGroup?: { name: string; mapping: 'physical' | 'logical'; };
};

export type PropertyContext =
  & MathContext
  & ColorContext
  & GradientContext
  & PositionContext
  & UrlContext
  & SupportsContext;

export type CustomPropertyName = `--${string}`;

export type CustomPropertyRegistration = {
  name: CustomPropertyName;
  syntax: SyntaxValue;
  parse: (input: ParserInput, context: PropertyContext) => WholeValue<ParsedSyntaxValue, PropertyContext> | null;
  inherits: boolean;
  initialValue: WholeValue<ParsedSyntaxValue, PropertyContext>;
};

export type CustomPropertyRegistry = ReadonlyMap<
  CustomPropertyName,
  CustomPropertyRegistration
>;
