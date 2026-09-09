import {
  arg, ctor, defineInterface, idlType, impl, roAttr,
  reference,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';

export class CountQueuingStrategyImpl {
  readonly #highWaterMark: number;
  readonly #size: CallableFunction;

  // SPEC_MISMATCH: CountQueuingStrategy(init) -> CountQueuingStrategy
  // TODO(BINDING_INTEGRATION): move the realm-owned size function to the getter binding.
  constructor(context: BindingContext, init: QueuingStrategyInit) {
    this.#highWaterMark = init.highWaterMark;
    this.#size = getCountSizeFunction(context);
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
  exposed: '*',
  implementation: impl(CountQueuingStrategyImpl, {
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

// BINDING_INTEGRATION: one author-visible size function per realm.
function getCountSizeFunction(
  context: BindingContext,
): CallableFunction {
  let size = sizeFunctions.get(context);
  if (!size) {
    size = context.realm.createFunction(
      () => 1,
      { length: 0, name: 'size' },
    );
    sizeFunctions.set(context, size);
  }
  return size;
}
