import type { ParserInput } from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import { WholeValue, type Value, type WholeValueContents, type PendingShorthand } from '../values/index';
import {
  BaseProperty, type AnimationType, type PropertyContext, type PropertyPercentages,
  type ResolvedValueStage, type LogicalPropertyGroup,
} from './base-property';

// Type parameters: O = ordinary parser result, N = property name, W = whole property value.

/** Shared grammar, metadata, and value processing for one named built-in property. */
export class BuiltInProperty<
  O extends Value = Value, N extends string = string,
> extends BaseProperty<BuiltInPropertyValue<O>, N> {
  custom = false as const;
  inherits: boolean;
  initialValue: BuiltInPropertyValue<O>;
  appliesTo: (context: PropertyContext) => boolean;
  animationType: AnimationType<BuiltInPropertyValue<O>>;
  percentages: PropertyPercentages;
  resolvedValueStage: ResolvedValueStage;
  /** Parsed grammar retained by every complete value constructed for this property. */
  #parseValue: (input: ParserInput, context: PropertyContext) => O | null;

  constructor(definition: BuiltInPropertyDefinition<O, N>) {
    super(definition.name);
    this.#parseValue = definition.parse;
    this.inherits = definition.inherits;
    this.initialValue = this.createValue(definition.initialValue);
    this.appliesTo = definition.appliesTo;
    this.animationType = definition.animationType;
    this.percentages = definition.percentages;
    this.resolvedValueStage = definition.resolvedValueStage;
    this.logicalGroup = definition.logicalGroup;
  }

  /** Parse this property's ordinary grammar and whole-value notation. */
  parse(input: ParserInput, context: PropertyContext): WholeValue<O> | null {
    return WholeValue.parse<O>(input, context, this.#parseValue);
  }

  /** Retain an already-parsed value with this property's grammar, without reparsing it. */
  createValue(inner: WholeValueContents<O>): WholeValue<O> {
    return new WholeValue<O>(inner, this.#parseValue);
  }

  /** Retain one longhand's position in a shorthand that must be expanded after substitution. */
  createPendingValue(shorthand: PendingShorthand<O>, shorthandIndex: number): WholeValue<O> {
    return WholeValue.fromShorthand(shorthand, shorthandIndex, this.#parseValue);
  }

  /** Resolve a value with this property's percentage rule and the supplied stage facts. */
  resolve<W extends BuiltInPropertyValue<O>>(propValue: W, stage: ValueStage, context: PropertyContext): ReturnType<W['resolve']>;
  resolve(propValue: BuiltInPropertyValue<O>, stage: ValueStage, context: PropertyContext): WholeValue {
    return propValue.resolve(stage, this.withPercentageReference(stage, context));
  }

  interpolate(
    from: BuiltInPropertyValue<O>, to: BuiltInPropertyValue<O>, progress: number, context: PropertyContext,
  ): ReturnType<BuiltInPropertyValue<O>['interpolate']> {
    if (!this.canAnimate()) return null;
    context = this.withPercentageReference(ValueStage.Computed, context);
    let result: ReturnType<BuiltInPropertyValue<O>['interpolate']> = null;
    if (typeof this.animationType === 'object') {
      result = this.animationType.interpolate(from, to, progress, context);
    } else if (this.animationType === 'by-computed-value') {
      // Property dispatch accepts whole values; the concrete operation checks computation prerequisites.
      result = from.interpolate.call(from as ThisParameterType<typeof from.interpolate>, to, progress, context);
    } else {
      from.ordinaryValue();
      to.ordinaryValue();
    }
    return result ?? (progress < 0.5 ? from : to);
  }

  add(
    underlying: BuiltInPropertyValue<O>, effect: BuiltInPropertyValue<O>, context: PropertyContext,
  ): ReturnType<BuiltInPropertyValue<O>['add']> {
    if (!this.canAnimate()) return null;
    context = this.withPercentageReference(ValueStage.Computed, context);
    let result: ReturnType<BuiltInPropertyValue<O>['add']> = null;
    if (typeof this.animationType === 'object') {
      result = this.animationType.add(underlying, effect, context);
    } else if (this.animationType === 'by-computed-value') {
      result = underlying.add.call(underlying as ThisParameterType<typeof underlying.add>, effect, context);
    } else {
      underlying.ordinaryValue();
      effect.ordinaryValue();
    }
    return result ?? effect;
  }

  accumulate(
    underlying: BuiltInPropertyValue<O>, effect: BuiltInPropertyValue<O>, context: PropertyContext,
  ): ReturnType<BuiltInPropertyValue<O>['accumulate']> {
    if (!this.canAnimate()) return null;
    context = this.withPercentageReference(ValueStage.Computed, context);
    let result: ReturnType<BuiltInPropertyValue<O>['accumulate']> = null;
    if (typeof this.animationType === 'object') {
      result = this.animationType.accumulate(underlying, effect, context);
    } else if (this.animationType === 'by-computed-value') {
      result = underlying.accumulate.call(underlying as ThisParameterType<typeof underlying.accumulate>, effect, context);
    } else {
      underlying.ordinaryValue();
      effect.ordinaryValue();
    }
    return result ?? effect;
  }
}

/** Parsed or resolved representation; this type does not certify a lifecycle stage. */
type BuiltInPropertyValue<O extends Value> = WholeValue<O | ReturnType<O['resolve']>>;

/** Required property facts, supplied together; initial values are already parsed ordinary values. */
export type BuiltInPropertyDefinition<
  O extends Value, N extends string = string,
> = {
  name: N;
  parse: (input: ParserInput, context: PropertyContext) => O | null;
  inherits: boolean;
  initialValue: O;
  appliesTo: (context: PropertyContext) => boolean;
  animationType: AnimationType<BuiltInPropertyValue<O>>;
  percentages: PropertyPercentages;
  resolvedValueStage: ResolvedValueStage;
  logicalGroup?: LogicalPropertyGroup;
};
