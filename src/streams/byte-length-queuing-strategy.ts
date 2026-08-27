import {
  arg, ctor, defineInterface, idlType, impl, roAttr,
  reference,
} from '../web-idl/declaration/index';
import {
  streamEnvironment, type StreamEnvironment,
} from './environment';

export class ByteLengthQueuingStrategyImpl {
  readonly #highWaterMark: number;
  readonly #size: CallableFunction;

  constructor(environment: StreamEnvironment, init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
    this.#size = getByteLengthSizeFunction(environment);
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): CallableFunction {
    return this.#size;
  }

}

// -- Web IDL ------------------------------------------------------------

export const byteLengthQueuingStrategyIDL = defineInterface({
  name: 'ByteLengthQueuingStrategy',
  exposed: ['Window', 'Worker', 'Worklet'],
  implementation: impl(ByteLengthQueuingStrategyImpl, {
    withArgs: [streamEnvironment],
  }),
  members: [
    ctor([arg('init', reference('QueuingStrategyInit'))]),
    roAttr('highWaterMark', idlType.unrestrictedDouble),
    roAttr('size', reference('Function')),
  ],
});

type QueuingStrategyInit = {
  readonly highWaterMark: number;
};

const sizeFunctions = new WeakMap<StreamEnvironment, CallableFunction>();

function getByteLengthSizeFunction(
  environment: StreamEnvironment,
): CallableFunction {
  let size = sizeFunctions.get(environment);
  if (!size) {
    size = environment.callbacks.createFunction(
      (_thisArgument, [chunk]) => {
        if (chunk === undefined || chunk === null) {
          throw environment.exceptions.createTypeError(
            'Cannot read byteLength from null or undefined',
          );
        }
        return (chunk as ArrayBufferView).byteLength;
      },
      { length: 1, name: 'size' },
    );
    sizeFunctions.set(environment, size);
  }
  return size;
}
