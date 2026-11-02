import { RangeError } from '../infra/exceptions';
import { getV, type JSEnvironment, type JSFunction, type JSRealm } from '../js-engine/index';
import {
  arg, onError, ctor, defineCallbackFunction, defineDictionary, defineInterface,
  dictMember, idlType, impl, roAttr, reference,
} from '../web-idl/core/index';

/*
 * dictionary QueuingStrategy {
 *   unrestricted double highWaterMark;
 *   QueuingStrategySize size;
 * };
 */
export type QueuingStrategy = {
  highWaterMark?: number;
  size?: QueuingStrategySize;
};

/** Streams §7.4, ExtractHighWaterMark. */
export function extractHighWaterMark(
  strategy: QueuingStrategy,
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
  strategy: QueuingStrategy,
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
  highWaterMark: number;
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
    dictMember('size', reference('QueuingStrategySize'),
      onError('rethrow'),
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
  static #sizeFunctions = new WeakMap<JSRealm, JSFunction>();

  #highWaterMark: number;

  constructor(init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
  }

  /** Return the size function shared by all byte-length strategies in this realm. */
  static getSizeFunction(realm: JSRealm): JSFunction {
    let size = this.#sizeFunctions.get(realm);
    if (!size) {
      size = realm.createFunction((_receiver, [chunk]) => getV(chunk, 'byteLength', realm), {
        length: 1, name: 'size',
      });
      this.#sizeFunctions.set(realm, size);
    }
    return size;
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }
}

// -- Web IDL ------------------------------------------------------------

export const byteLengthQueuingStrategyIDL = defineInterface<JSEnvironment>({
  name: 'ByteLengthQueuingStrategy',
  exposed: '*',
  implementation: impl(ByteLengthQueuingStrategyImpl),
  members: [
    ctor([arg('init', reference('QueuingStrategyInit'))]),
    roAttr('highWaterMark', idlType.unrestrictedDouble),
    // BINDING_INTEGRATION: primitive chunks use the size function's owning realm.
    roAttr('size', reference('Function'), {
      overrideGet({ relevant: env }) { return ByteLengthQueuingStrategyImpl.getSizeFunction(env.realm); },
    }),
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
  static #sizeFunctions = new WeakMap<JSRealm, JSFunction<number>>();

  #highWaterMark: number;

  constructor(init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
  }

  /** Return the size function shared by all count strategies in this realm. */
  static getSizeFunction(realm: JSRealm): JSFunction<number> {
    let size = this.#sizeFunctions.get(realm);
    if (!size) {
      size = realm.createFunction(() => 1, { length: 0, name: 'size' });
      this.#sizeFunctions.set(realm, size);
    }
    return size;
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }
}

// -- Web IDL ------------------------------------------------------------

export const countQueuingStrategyIDL = defineInterface<JSEnvironment>({
  name: 'CountQueuingStrategy',
  exposed: '*',
  implementation: impl(CountQueuingStrategyImpl),
  members: [
    ctor([arg('init', reference('QueuingStrategyInit'))]),
    roAttr('highWaterMark', idlType.unrestrictedDouble),
    roAttr('size', reference('Function'), {
      overrideGet({ relevant: env }) { return CountQueuingStrategyImpl.getSizeFunction(env.realm); },
    }),
  ],
});
