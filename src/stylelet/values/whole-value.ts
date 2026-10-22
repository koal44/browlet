import { InternalError } from '../../infra/internal-error';

import {
  withTrivia, createComponentParser,
  type TokenCursor, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';

import type { Value } from './value';
import { OptionalDeclarationValue } from './declaration-value';
import { CssWideValue } from './css-wide';
import { SubstitutionValue } from './substitution-value';
import { FirstValidValue } from './substitution/first-valid';
import { GuaranteedInvalidValue, guaranteedInvalidValue } from './guaranteed-invalid';

/** A property's complete value, including notation deferred until its grammar can be applied. */
export class WholeValue<Ordinary extends Value<Context>, Context = unknown> implements Value<Context> {
  /** The parsed value or retained whole-value notation. */
  value: Ordinary | RawWholeValue | SubstitutionValue | CssWideValue | FirstValidValue | GuaranteedInvalidValue;
  /** The consuming grammar, retained for deferred reparsing without retaining context. */
  private parseValue: (input: ParserInput, context: Context) => Ordinary | null;
  /** Registered declarations defer their ordinary grammar until Computed time. */
  private registered: boolean;

  constructor(
    value: WholeValue<Ordinary, Context>['value'],
    parseValue: (input: ParserInput, context: Context) => Ordinary | null,
    registered = false,
  ) {
    this.value = value;
    this.parseValue = parseValue;
    this.registered = registered;
  }

  /** Bind a shared ordinary parser to whole-value notation once per property grammar. */
  static createParser<Ordinary extends Value<Context>, Context>(
    parseValue: (input: ParserInput, context: Context) => Ordinary | null,
    registered = false,
  ): (input: ParserInput, context: Context) => WholeValue<Ordinary, Context> | null {
    return (input, context) => WholeValue.parse(input, context, parseValue, registered);
  }

  /** Parse a complete declaration; registered ordinary syntax remains deferred. */
  static parse<Ordinary extends Value<Context>, Context>(
    input: ParserInput,
    context: Context,
    parseValue: (input: ParserInput, context: Context) => Ordinary | null,
    registered = false,
  ): WholeValue<Ordinary, Context> | null {
    const declaration = OptionalDeclarationValue.parse(input, context);
    if (declaration === null) return null;

    const value = SubstitutionValue.containsFunction(declaration.value)
      ? new SubstitutionValue(declaration)
      : wholeValueNotationParser(declaration.value, context) ??
        (registered ? new RawWholeValue(declaration) : parseValue(declaration.value, context));

    return value === null ? null : new WholeValue<Ordinary, Context>(value, parseValue, registered);
  }

  /** Resolve with fresh context, preserving ordinary values or returning their resolver's result. */
  resolve(stage: ValueStage, context: Context): WholeValue<Ordinary | ReturnType<Ordinary['resolve']>, Context>;
  resolve(stage: ValueStage, context: Context): WholeValue<Value<Context>, Context> {
    const value = this.value;
    if (value instanceof RawWholeValue) {
      if (stage < ValueStage.Computed) return this;
      const declaration = value.value;
      const parsed = this.parseValue(declaration.value, context);
      return this.withValue(parsed === null ? guaranteedInvalidValue : parsed.resolve(stage, context));
    }
    if (value instanceof FirstValidValue) {
      if (stage < ValueStage.Computed) return this;
      for (const argument of value.value) {
        const parsed = WholeValue.parse(argument.value, context, this.parseValue, this.registered);
        if (parsed === null) continue;
        const resolved = parsed.resolve(stage, context);
        if (!(resolved.value instanceof GuaranteedInvalidValue)) return resolved;
      }
      return this.withValue(guaranteedInvalidValue);
    }
    if (value instanceof SubstitutionValue) {
      if (stage < ValueStage.Computed) return this;
      const substituted = value.substitute(context);
      if (substituted instanceof GuaranteedInvalidValue) return this.withValue(substituted);
      const parsed = WholeValue.parse(substituted, context, this.parseValue, this.registered);
      if (parsed === null) throw new InternalError('Handling substituted parse failure is not implemented');
      return parsed.resolve(stage, context);
    }
    return this.withValue(value.resolve(stage, context));
  }

  /** Serialization delegates to the current representation and never reparses or resolves it. */
  serialize(): string {
    return this.value.serialize();
  }

  private withValue(value: WholeValue<Value<Context>, Context>['value']): WholeValue<Value<Context>, Context> {
    return value === this.value ? this : new WholeValue<Value<Context>, Context>(value, this.parseValue, this.registered);
  }
}

/** A registered declaration whose ordinary syntax is not checked before Computed time. */
export class RawWholeValue {
  /** The original declaration, including valid empty input and source spans. */
  value: OptionalDeclarationValue;

  constructor(value: OptionalDeclarationValue) {
    this.value = value;
  }

  /** Serialize the retained declaration without applying its registered grammar. */
  serialize(): string {
    return this.value.serialize();
  }
}

function consumeWholeValueNotation(c: TokenCursor): CssWideValue | FirstValidValue | null {
  return CssWideValue.consume(c) ?? FirstValidValue.consume(c);
}

const wholeValueNotationParser = createComponentParser(withTrivia(consumeWholeValueNotation));
