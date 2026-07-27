import type { ComponentCursor } from '../../parser/component-cursor';
import { withComponentTrivia } from '../../parser/component-grammar';
import {
  ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumerResult,
} from '../../parser/component-try-consumer';
import { isTokenKind, parseAsComponentGrammar, type ParserInput } from '../../parser/syntax';
import { TokenKind } from '../../parser/tokens';
import { serializeIdentifier } from '../ident';
import { serializeCssNumber } from './number';

/*
 * <dimension> = <dimension-token>
 */

export type DimensionLiteral<
  Type extends string = 'dimension',
  Unit extends string = string,
> = {
  type: Type;
  value: number;
  unit: Unit;
};

export function parseDimension(
  input: ParserInput,
  context: unknown = undefined,
): DimensionLiteral | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeDimension),
      context,
    ),
    'dimension',
  );
}

export function tryConsumeDimension(
  c: ComponentCursor,
): TryComponentConsumerResult<DimensionLiteral> {
  const start = c.pos();
  const component = c.next();

  if (!isTokenKind(component, TokenKind.Dimension)) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'dimension',
    value: component.value,
    unit: component.unit,
  });
}

export function serializeDimension(
  value: DimensionLiteral<string, string>,
): string {
  return `${serializeCssNumber(value.value)}${serializeDimensionUnit(value.unit)}`;
}

function serializeDimensionUnit(unit: string): string {
  const serialized = serializeIdentifier(unit);

  // Escape a leading e/E when adjoining the unit to a number would otherwise
  // turn the pair into scientific notation rather than a dimension token.
  if (/^[eE](?:[+-]?[0-9])/.test(unit)) {
    return `\\${unit.codePointAt(0)!.toString(16)} ${serialized.slice(1)}`;
  }

  return serialized;
}

// CSS Values, "Combination of Dimensions".
export function addDimensions<Type extends string, Unit extends string>(
  a: DimensionLiteral<Type, Unit>,
  b: DimensionLiteral<Type, Unit>,
): DimensionLiteral<Type, Unit> {
  assertSameDimensionUnit(a, b);

  return {
    type: a.type,
    value: a.value + b.value,
    unit: a.unit,
  };
}

export function interpolateDimensions<Type extends string, Unit extends string>(
  a: DimensionLiteral<Type, Unit>,
  b: DimensionLiteral<Type, Unit>,
  p: number,
): DimensionLiteral<Type, Unit> {
  assertSameDimensionUnit(a, b);

  return {
    type: a.type,
    value: (1 - p) * a.value + p * b.value,
    unit: a.unit,
  };
}

export function accumulateDimensions<Type extends string, Unit extends string>(
  a: DimensionLiteral<Type, Unit>,
  b: DimensionLiteral<Type, Unit>,
): DimensionLiteral<Type, Unit> {
  return addDimensions(a, b);
}

function assertSameDimensionUnit(
  a: DimensionLiteral<string, string>,
  b: DimensionLiteral<string, string>,
): void {
  if (a.unit !== b.unit) {
    throw new TypeError(`Dimension units must match: ${a.unit} and ${b.unit}`);
  }
}
