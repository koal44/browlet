import {
  arg, defineCallbackFunction, defineDictionary, dictMember, idlType,
  reference,
} from '../web-idl/declaration/index';
import { callback } from '../web-idl/index';
import { RangeError } from '../js-engine/simple-exception';

export type QueuingStrategy = {
  readonly highWaterMark?: number;
  readonly size?: QueuingStrategySize;
};

export type QueuingStrategySize<Value = unknown> = (chunk: Value) => number;

export function extractHighWaterMark(
  strategy: QueuingStrategy,
  defaultHighWaterMark: number,
): number {
  if (strategy.highWaterMark === undefined) return defaultHighWaterMark;

  const { highWaterMark } = strategy;
  if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
    throw new RangeError('Invalid highWaterMark');
  }
  return highWaterMark;
}

export function extractSizeAlgorithm<Value>(
  strategy: QueuingStrategy,
): QueuingStrategySize<Value> {
  const { size } = strategy;
  if (size === undefined) return () => 1;

  // The standard distinguishes the extracted algorithm from its callback.
  return (chunk) => size(chunk);
}

// -- Web IDL ------------------------------------------------------------

export const queuingStrategySizeIDL = defineCallbackFunction({
  name: 'QueuingStrategySize',
  returns: idlType.unrestrictedDouble,
  arguments: [arg('chunk', idlType.any)],
});

export const queuingStrategyIDL = defineDictionary({
  name: 'QueuingStrategy',
  members: [
    dictMember('highWaterMark', idlType.unrestrictedDouble),
    dictMember(
      'size',
      reference('QueuingStrategySize'),
      callback('rethrow'),
    ),
  ],
});

export const queuingStrategyInitIDL = defineDictionary({
  name: 'QueuingStrategyInit',
  members: [dictMember('highWaterMark', idlType.unrestrictedDouble, {
    required: true,
  })],
});
