import { tryConsumeDimensionToken } from '../../parser/component-consumers';
import { serializeCssDimensionUnit } from '../../parser/component-value';
import { type ComponentCursor, type TryComponentConsumerResult } from '../../parser/component-cursor';
import { adaptConsumer, withTrivia } from '../../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { serializeCssNumber } from './number';

/*
 * <dimension> = <dimension-token>
 */

export type DimensionLiteral<
  Type extends DimensionType = 'dimension',
  Unit extends string = string,
> = {
  type: Type;
  value: number;
  unit: Unit;
};

export type DimensionType =
  | 'dimension'
  | 'length'
  | 'angle'
  | 'time'
  | 'frequency'
  | 'resolution'
  | 'flex';

export type AnyDimensionLiteral =
  DimensionLiteral<DimensionType, string>;

export function dimensionLiteral<
  Type extends DimensionType,
  Unit extends string,
>(
  type: Type,
  value: number,
  unit: Unit,
): DimensionLiteral<Type, Unit> {
  return { type, value, unit };
}

export function parseDimension(
  input: ParserInput,
  context: unknown = undefined,
): DimensionLiteral | null {
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeDimension),
    context,
  );
}

export function tryConsumeDimension(
  c: ComponentCursor,
): TryComponentConsumerResult<DimensionLiteral> {
  return consumeDimension(c);
}

const consumeDimension = adaptConsumer(
  tryConsumeDimensionToken,
  (token): DimensionLiteral => ({
    type: 'dimension',
    value: token.value,
    unit: token.unit,
  }),
);

export function serializeDimension(
  value: AnyDimensionLiteral,
): string {
  return `${serializeCssNumber(value.value)}${serializeCssDimensionUnit(value.unit)}`;
}

// CSS Values, "Combination of Dimensions".
export function addDimensions<Dimension extends AnyDimensionLiteral>(
  a: Dimension,
  b: Dimension,
): Dimension {
  assertSameDimensionUnit(a, b);

  return {
    ...a,
    value: a.value + b.value,
  };
}

export function interpolateDimensions<Dimension extends AnyDimensionLiteral>(
  a: Dimension,
  b: Dimension,
  p: number,
): Dimension {
  assertSameDimensionUnit(a, b);

  return {
    ...a,
    value: (1 - p) * a.value + p * b.value,
  };
}

export function accumulateDimensions<Dimension extends AnyDimensionLiteral>(
  a: Dimension,
  b: Dimension,
): Dimension {
  return addDimensions(a, b);
}

function assertSameDimensionUnit(
  a: AnyDimensionLiteral,
  b: AnyDimensionLiteral,
): void {
  if (a.unit !== b.unit) {
    throw new TypeError(`Dimension units must match: ${a.unit} and ${b.unit}`);
  }
}
