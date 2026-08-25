import {
  arg, ctor, defineInterface, idlType, readonlyAttr, reference,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl';
import {
  getStreamEnvironment, type StreamEnvironment,
} from './environment';

export class ByteLengthQueuingStrategyImpl {
  #highWaterMark = 0;
  #size: CallableFunction = () => 0;

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): CallableFunction {
    return this.#size;
  }

  // -- Friends ----------------------------------------------------------

  static initializeForBinding(
    strategy: ByteLengthQueuingStrategyImpl,
    highWaterMark: number,
  ): void {
    strategy.#highWaterMark = highWaterMark;
  }

  static getSizeForBinding(
    strategy: ByteLengthQueuingStrategyImpl,
  ): CallableFunction {
    return strategy.#size;
  }

  static setSizeFunction(
    strategy: ByteLengthQueuingStrategyImpl,
    size: CallableFunction,
  ): void {
    strategy.#size = size;
  }
}

// -- Web IDL ------------------------------------------------------------

export const byteLengthQueuingStrategyIDL = defineInterface({
  binding: bind(ByteLengthQueuingStrategyImpl, {
    initialize(context, value) {
      ByteLengthQueuingStrategyImpl.setSizeFunction(
        value as ByteLengthQueuingStrategyImpl,
        getByteLengthSizeFunction(getStreamEnvironment(context)),
      );
    },
  }),
  exposed: ['Window', 'Worker', 'Worklet'],
  members: [
    ctor([arg('init', reference('QueuingStrategyInit'))], bind({
      invoke(_context, init) {
        ByteLengthQueuingStrategyImpl.initializeForBinding(
          this as ByteLengthQueuingStrategyImpl,
          (init as QueuingStrategyInit).highWaterMark,
        );
      },
    })),
    readonlyAttr('highWaterMark', idlType.unrestrictedDouble),
    readonlyAttr('size', reference('Function'), bind({
      get(context) {
        return getStreamEnvironment(context).callbacks.createFunctionValue(
          'Function',
          ByteLengthQueuingStrategyImpl.getSizeForBinding(
            this as ByteLengthQueuingStrategyImpl,
          ),
        );
      },
    })),
  ],
  name: 'ByteLengthQueuingStrategy',
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
      (_thisArgument, [chunk]) => (chunk as ArrayBufferView).byteLength,
      { length: 1, name: 'size' },
    );
    sizeFunctions.set(environment, size);
  }
  return size;
}
