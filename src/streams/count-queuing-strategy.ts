import {
  arg, ctor, defineInterface, idlType, impl, roAttr,
  reference,
} from '../web-idl/declaration/index';
import {
  streamEnvironment, type StreamEnvironment,
} from './environment';

export class CountQueuingStrategyImpl {
  readonly #highWaterMark: number;
  readonly #size: CallableFunction;

  constructor(environment: StreamEnvironment, init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
    this.#size = getCountSizeFunction(environment);
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): CallableFunction {
    return this.#size;
  }

}

// -- Web IDL ------------------------------------------------------------

export const countQueuingStrategyIDL = defineInterface({
  name: 'CountQueuingStrategy',
  exposed: ['Window', 'Worker', 'Worklet'],
  implementation: impl(CountQueuingStrategyImpl, {
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
