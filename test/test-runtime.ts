import { it } from 'vitest';

import { addon, setHostHooks } from '../src/js-engine';

/** Run normally when every requirement holds; otherwise expect failure. */
export function itPassesWith(...requirements: RuntimeRequirement[]): typeof it.fails {
  return requirements.every((requirement) => supported[requirement]) ? it : it.fails;
}

type RuntimeRequirement = keyof typeof supported;

const nodeMajor = Number(process.versions.node.split('.')[0]);
const supported = {
  collectionIterators: !!addon.createCollectionIterator,
  errorIsError: typeof Reflect.get(Error, 'isError') === 'function',
  errorStackAccessor: !!Reflect.getOwnPropertyDescriptor(Error.prototype, 'stack')?.get,
  explicitQueues: !!addon.createMicrotaskQueue,
  finalizationRegistryPredicate: !!addon.isFinalizationRegistry,
  functionRealms: !!addon.getFunctionRealm,
  htmlDDA: addon.supportsHTMLDDA,
  hostHooks: !!setHostHooks,
  iteratorPredicates: !!addon.isArrayIterator &&
    !!addon.isStringIterator && !!addon.isRegExpStringIterator,
  lengthTracking: !!addon.isLengthTrackingArrayBufferView,
  nativeGlobals: !!addon.createContextHandle &&
    !!addon.setGlobalObject && !!addon.setPropertyDelegate,
  'v24+': nodeMajor >= 24,
  'v26+': nodeMajor >= 26,
};
