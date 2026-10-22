import { InternalError } from '../../infra/internal-error';

import {
  withTrivia, createComponentParser,
  type TokenCursor, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import type { PropertyContext } from '../props/index';

import type { Value } from './value';
import { OptionalDeclarationValue } from './declaration-value';
import { CssWideValue } from './css-wide';
import { SubstitutionValue } from './substitution-value';
import { FirstValidValue } from './substitution/first-valid';
import { GuaranteedInvalidValue, guaranteedInvalidValue } from './guaranteed-invalid';

/** A property's complete value, including notation deferred until its grammar can be applied. */
export class WholeValue<Ordinary extends Value<Context>, Context extends PropertyContext = PropertyContext> implements Value<Context> {
  /** The parsed value or retained whole-value notation. */
  value: Ordinary | RawWholeValue | SubstitutionValue | CssWideValue | FirstValidValue | GuaranteedInvalidValue;
  /** The consuming grammar, retained for deferred reparsing without retaining context. */
  #parseValue: (input: ParserInput, context: Context) => Ordinary | null;
  /** Registered declarations defer their ordinary grammar until Computed time. */
  #registered: boolean;

  constructor(
    value: WholeValue<Ordinary, Context>['value'],
    parseValue: (input: ParserInput, context: NoInfer<Context>) => Ordinary | null,
    registered = false,
  ) {
    this.value = value;
    this.#parseValue = parseValue;
    this.#registered = registered;
  }

  /** Parse a complete declaration; registered ordinary syntax remains deferred. */
  static parse<Ordinary extends Value<Context>, Context extends PropertyContext = PropertyContext>(
    input: ParserInput,
    context: NoInfer<Context>,
    parseValue: (input: ParserInput, context: NoInfer<Context>) => Ordinary | null,
    registered = false,
  ): WholeValue<Ordinary, Context> | null {
    const declaration = OptionalDeclarationValue.parse(input, context);
    if (declaration === null) return null;
    const notation = wholeValueNotationParser(declaration.value, context);
    if (notation === null && !SubstitutionValue.hasValidVarArguments(declaration.value)) return null;

    const value = notation ?? (SubstitutionValue.containsFunction(declaration.value)
      ? new SubstitutionValue(declaration)
      : registered ? new RawWholeValue(declaration) : parseValue(declaration.value, context));

    return value === null ? null : new WholeValue<Ordinary, Context>(value, parseValue, registered);
  }

  /** Resolve with fresh context, preserving ordinary values or returning their resolver's result. */
  resolve(
    stage: ValueStage,
    context: Context,
  ): WholeValue<Ordinary | ReturnType<Ordinary['resolve']>, Context>;
  resolve(stage: ValueStage, context: Context): WholeValue<Value<Context>, Context> {
    const value = this.value;
    if (value instanceof RawWholeValue) {
      if (stage < ValueStage.Computed) return this;
      const declaration = value.value;
      const parsed = this.#parseValue(declaration.value, context);
      return this.withValue(parsed === null ? guaranteedInvalidValue : parsed.resolve(stage, context));
    }
    if (value instanceof FirstValidValue) {
      if (stage < ValueStage.Computed) return this;
      // https://drafts.csswg.org/css-values-5/#first-valid
      // Check support against the consuming grammar, including registered syntax.
      // A supported var() argument can still fail at computed time; do not retry.
      for (const argument of value.value) {
        const parsed = WholeValue.parse<Ordinary, Context>(argument.value, context, this.#parseValue);
        if (parsed !== null) return parsed.resolve(stage, context);
      }
      return this.withValue(guaranteedInvalidValue);
    }
    if (value instanceof SubstitutionValue) {
      if (stage < ValueStage.Computed) return this;
      const { getCustomProperty } = context;
      if (getCustomProperty === undefined) throw new InternalError('Property substitution requires computed custom properties');
      // https://drafts.csswg.org/css-values-5/#resolve-property
      // Reparse components directly: adjacent number/ident tokens must not become a dimension.
      const substituted = value.substitute(getCustomProperty);
      if (substituted instanceof GuaranteedInvalidValue) return this.withValue(substituted);
      const parsed = WholeValue.parse<Ordinary, Context>(substituted, context, this.#parseValue, this.#registered);
      return parsed === null ? this.withValue(guaranteedInvalidValue) : parsed.resolve(stage, context);
    }
    return this.withValue(value.resolve(stage, context));
  }

  /** Serialization delegates to the current representation and never reparses or resolves it. */
  serialize(): string {
    return this.value.serialize();
  }

  protected withValue<Result extends Value<Context>>(
    value: WholeValue<Result, Context>['value'],
  ): WholeValue<Ordinary | Result, Context> {
    return value === this.value ? this : new WholeValue<Ordinary | Result, Context>(value, this.#parseValue, this.#registered);
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
