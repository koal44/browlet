import {
  arg, callback, contextValue, ctor, defineCallbackFunction, defineDictionary, defineInterface,
  dictMember, functionResult, idlType, impl, roAttr, reference,
} from '../web-idl/declaration/index';
import type { BindingContext } from '../web-idl/projection';
import { getV } from '../js-engine/index';
import { RangeError } from '../js-engine/simple-exception';

/*
 * dictionary QueuingStrategy {
 *   unrestricted double highWaterMark;
 *   QueuingStrategySize size;
 * };
 */
export type QueuingStrategyRecord = {
  readonly highWaterMark?: number;
  readonly size?: QueuingStrategySize;
};

/** Streams §7.4, ExtractHighWaterMark. */
export function extractHighWaterMark(
  strategy: QueuingStrategyRecord,
  defaultHighWaterMark: number,
): number {
  const { highWaterMark } = strategy;
  if (highWaterMark === undefined) return defaultHighWaterMark;
  if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
    throw new RangeError('Invalid highWaterMark');
  }
  return highWaterMark;
}

/** Streams §7.4, ExtractSizeAlgorithm. */
export function extractSizeAlgorithm<Value>(
  strategy: QueuingStrategyRecord,
): QueuingStrategySize<Value> {
  const { size } = strategy;
  if (size === undefined) return () => 1;

  // The standard distinguishes the extracted algorithm from its callback.
  return (chunk) => size(chunk);
}

/*
 * callback QueuingStrategySize = unrestricted double (any chunk);
 */
export type QueuingStrategySize<Value = unknown> = (chunk: Value) => number;

/*
 * dictionary QueuingStrategyInit {
 *   required unrestricted double highWaterMark;
 * };
 */
type QueuingStrategyInit = {
  readonly highWaterMark: number;
};

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

// =============================================================================
// ByteLengthQueuingStrategy
// =============================================================================

/*
 * [Exposed=*]
 * interface ByteLengthQueuingStrategy {
 *   constructor(QueuingStrategyInit init);
 *
 *   readonly attribute unrestricted double highWaterMark;
 *   readonly attribute Function size;
 * };
 */
export class ByteLengthQueuingStrategyImpl {
  readonly #highWaterMark: number;

  constructor(init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }
}

// -- Web IDL ------------------------------------------------------------

export const byteLengthQueuingStrategyIDL = defineInterface({
  name: 'ByteLengthQueuingStrategy',
  exposed: '*',
  implementation: impl(ByteLengthQueuingStrategyImpl),
  members: [
    ctor([arg('init', reference('QueuingStrategyInit'))]),
    roAttr('highWaterMark', idlType.unrestrictedDouble),
    // BINDING_INTEGRATION: primitive chunks use the size function's owning realm.
    roAttr('size', reference('Function'), functionResult(1, contextValue(
      ({ realm }: BindingContext) => (chunk: unknown) => getV(chunk, 'byteLength', realm),
    ))),
  ],
});

// =============================================================================
// CountQueuingStrategy
// =============================================================================

/*
 * [Exposed=*]
 * interface CountQueuingStrategy {
 *   constructor(QueuingStrategyInit init);
 *
 *   readonly attribute unrestricted double highWaterMark;
 *   readonly attribute Function size;
 * };
 */
export class CountQueuingStrategyImpl {
  readonly #highWaterMark: number;

  constructor(init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }
}

// -- Web IDL ------------------------------------------------------------

export const countQueuingStrategyIDL = defineInterface({
  name: 'CountQueuingStrategy',
  exposed: '*',
  implementation: impl(CountQueuingStrategyImpl),
  members: [
    ctor([arg('init', reference('QueuingStrategyInit'))]),
    roAttr('highWaterMark', idlType.unrestrictedDouble),
    roAttr('size', reference('Function'), functionResult(0, () => 1)),
  ],
});
