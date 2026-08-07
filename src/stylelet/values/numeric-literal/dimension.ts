import { consumeDimensionToken } from '../../syntax/component-consumers';
import { serializeCssDimensionUnit } from '../../syntax/component-value';
import {
  type TokenCursor, type TryConsumerResult,
} from '../../syntax/token-cursor';
import { adaptConsumer, withTrivia } from '../../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../../syntax/parser';
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
  return dimensionParser(input, context);
}

export function consumeDimension(
  c: TokenCursor,
): TryConsumerResult<DimensionLiteral> {
  return dimensionConsumer(c);
}

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

// <dimension> = <dimension-token>
const dimensionConsumer = adaptConsumer(
  consumeDimensionToken,
  (token): DimensionLiteral => ({
    type: 'dimension',
    value: token.value,
    unit: token.unit,
  }),
);

const dimensionParser = createComponentParser(withTrivia(dimensionConsumer));
