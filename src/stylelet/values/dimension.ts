import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import { type TokenCursor, type TryConsumerResult } from '../syntax/token-cursor';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import type { ValueDefinition } from '../value-processing/definition';
import type { ValueStage } from '../value-processing/stage';
import { consumeAngle, resolveAngle, serializeAngle, type AngleValue } from './angle';
import {
  consumeFrequency, resolveFrequency, serializeFrequency, type FrequencyValue,
} from './frequency';
import { consumeLength, resolveLength, serializeLength, type LengthValue } from './length';
import { type MathContext } from './math-value';
import {
  consumeDimension as consumeDimensionLiteral,
  serializeDimension as serializeDimensionLiteral,
  type DimensionLiteral,
} from './numeric-literal/dimension';
import {
  consumeResolution, resolveResolution, serializeResolution, type ResolutionValue,
} from './resolution';
import { consumeTime, resolveTime, serializeTime, type TimeValue } from './time';

/*
 * <dimension> = <dimension-token>
 */

export type DimensionValue =
  | AngleValue
  | FrequencyValue
  | LengthValue
  | ResolutionValue
  | TimeValue
  | DimensionLiteral;

export const dimensionDef: ValueDefinition<DimensionValue, MathContext> = {
  consume: consumeDimension,
  resolve: resolveDimension,
  serialize: serializeDimension,
};

export function parseDimension(
  input: ParserInput,
  context: MathContext = {},
): DimensionValue | null {
  return dimensionParser(input, context);
}

export function consumeDimension(
  c: TokenCursor,
): TryConsumerResult<DimensionValue> {
  return dimensionConsumer(c);
}

export function resolveDimension(
  value: DimensionValue,
  stage: ValueStage,
  context: MathContext = {},
): DimensionValue {
  switch (value.type) {
    case 'angle':
      return resolveAngle(value, stage, context);

    case 'frequency':
      return resolveFrequency(value, stage, context);

    case 'length':
      return resolveLength(value, stage, context);

    case 'resolution':
      return resolveResolution(value, stage, context);

    case 'time':
      return resolveTime(value, stage, context);

    case 'math':
      switch (value.valueType) {
        case 'angle':
          return resolveAngle(value, stage, context);
        case 'frequency':
          return resolveFrequency(value, stage, context);
        case 'length':
          return resolveLength(value, stage, context);
        case 'resolution':
          return resolveResolution(value, stage, context);
        case 'time':
          return resolveTime(value, stage, context);
      }
      return value;

    case 'dimension':
      return value;
  }
}

export function serializeDimension(value: DimensionValue): string {
  switch (value.type) {
    case 'angle':
      return serializeAngle(value);

    case 'frequency':
      return serializeFrequency(value);

    case 'length':
      return serializeLength(value);

    case 'resolution':
      return serializeResolution(value);

    case 'time':
      return serializeTime(value);

    case 'math':
      switch (value.valueType) {
        case 'angle':
          return serializeAngle(value);
        case 'frequency':
          return serializeFrequency(value);
        case 'length':
          return serializeLength(value);
        case 'resolution':
          return serializeResolution(value);
        case 'time':
          return serializeTime(value);
      }
      throw new TypeError('Unsupported dimension math type');

    case 'dimension':
      return serializeDimensionLiteral(value);
  }
}

const dimensionConsumer = oneOf(
  [
    one(consumeAngle),
    one(consumeFrequency),
    one(consumeLength),
    one(consumeResolution),
    one(consumeTime),
    one(consumeDimensionLiteral),
  ],
  ([value]) => value,
);

const dimensionParser = createComponentParser(withTrivia(dimensionConsumer));
