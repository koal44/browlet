import {
  arg, ctor, defineInterface, idlType, readonlyAttr, reference,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl';
import {
  getStreamEnvironment, type StreamEnvironment,
} from './environment';

export class CountQueuingStrategyImpl {
  #highWaterMark = 0;
  #size: CallableFunction = () => 1;

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): CallableFunction {
    return this.#size;
  }

  // -- Friends ----------------------------------------------------------

  static initializeForBinding(
    strategy: CountQueuingStrategyImpl,
    highWaterMark: number,
  ): void {
    strategy.#highWaterMark = highWaterMark;
  }

  static getSizeForBinding(
    strategy: CountQueuingStrategyImpl,
  ): CallableFunction {
    return strategy.#size;
  }

  static setSizeFunction(
    strategy: CountQueuingStrategyImpl,
    size: CallableFunction,
  ): void {
    strategy.#size = size;
  }
}

// -- Web IDL ------------------------------------------------------------

export const countQueuingStrategyIDL = defineInterface({
  binding: bind(CountQueuingStrategyImpl, {
    initialize(context, value) {
      CountQueuingStrategyImpl.setSizeFunction(
        value as CountQueuingStrategyImpl,
        getCountSizeFunction(getStreamEnvironment(context)),
      );
    },
  }),
  exposed: ['Window', 'Worker', 'Worklet'],
  members: [
    ctor([arg('init', reference('QueuingStrategyInit'))], bind({
      invoke(_context, init) {
        CountQueuingStrategyImpl.initializeForBinding(
          this as CountQueuingStrategyImpl,
          (init as QueuingStrategyInit).highWaterMark,
        );
      },
    })),
    readonlyAttr('highWaterMark', idlType.unrestrictedDouble),
    readonlyAttr('size', reference('Function'), bind({
      get(context) {
        return getStreamEnvironment(context).callbacks.createFunctionValue(
          'Function',
          CountQueuingStrategyImpl.getSizeForBinding(
            this as CountQueuingStrategyImpl,
          ),
        );
      },
    })),
  ],
  name: 'CountQueuingStrategy',
});

type QueuingStrategyInit = {
  readonly highWaterMark: number;
};

const sizeFunctions = new WeakMap<StreamEnvironment, CallableFunction>();

function getCountSizeFunction(
  environment: StreamEnvironment,
): CallableFunction {
  let size = sizeFunctions.get(environment);
  if (!size) {
    size = environment.callbacks.createFunction(
      () => 1,
      { length: 0, name: 'size' },
    );
    sizeFunctions.set(environment, size);
  }
  return size;
}
