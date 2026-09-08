import {
  arg, ctor, defineInterface, idlType, impl, roAttr,
  reference,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';

export class ByteLengthQueuingStrategyImpl {
  readonly #highWaterMark: number;
  readonly #size: CallableFunction;

  // SPEC_MISMATCH: ByteLengthQueuingStrategy(init) -> ByteLengthQueuingStrategy
  constructor(context: BindingContext, init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
    this.#size = getByteLengthSizeFunction(context);
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
  exposed: '*',
  implementation: impl(ByteLengthQueuingStrategyImpl, {
    constructWith: [bindingContext],
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

const sizeFunctions = new WeakMap<
  BindingContext,
  CallableFunction
>();

function getByteLengthSizeFunction(
  context: BindingContext,
): CallableFunction {
  let size = sizeFunctions.get(context);
  if (!size) {
    size = context.realm.createFunction(
      (_thisArgument, [chunk]) => {
        if (chunk === undefined || chunk === null) {
          throw new context.realm.intrinsics.typeError(
            'Cannot read byteLength from null or undefined',
          );
        }
        return (chunk as ArrayBufferView).byteLength;
      },
      { length: 1, name: 'size' },
    );
    sizeFunctions.set(context, size);
  }
  return size;
}
