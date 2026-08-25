import {
  arg, defineCallbackFunction, defineDictionary, dictMember, idlType,
  reference,
} from '../web-idl/declaration/index';
import type { StreamEnvironment } from './environment';

export type QueuingStrategy = {
  readonly highWaterMark?: number;
  readonly size?: unknown;
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
  environment: StreamEnvironment,
): QueuingStrategySize<Value> {
  const { size } = strategy;
  if (size === undefined) return () => 1;

  // The standard distinguishes the extracted algorithm from its callback.
  return (chunk) => environment.callbacks.invoke(
    size,
    [chunk],
    'rethrow',
  ) as number;
}

// -- Web IDL ------------------------------------------------------------

export const queuingStrategySizeIDL = defineCallbackFunction({
  arguments: [arg('chunk', idlType.any)],
  name: 'QueuingStrategySize',
  returns: idlType.unrestrictedDouble,
});

export const queuingStrategyIDL = defineDictionary({
  members: [
    dictMember('highWaterMark', idlType.unrestrictedDouble),
    dictMember('size', reference('QueuingStrategySize')),
  ],
  name: 'QueuingStrategy',
});

export const queuingStrategyInitIDL = defineDictionary({
  members: [dictMember('highWaterMark', idlType.unrestrictedDouble, {
    required: true,
  })],
  name: 'QueuingStrategyInit',
});
