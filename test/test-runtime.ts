import { it } from 'vitest';

import { addon, setHostHooks } from '../src/js-engine';

/** Run normally when every requirement holds; otherwise expect failure. */
export function itPassesWith(...requirements: RuntimeRequirement[]): typeof it.fails {
  return requirements.every((requirement) => supported[requirement]) ? it : it.fails;
}

type RuntimeRequirement = keyof typeof supported;

const nodeMajor = Number(process.versions.node.split('.')[0]);
const supported = {
  collectionIterators: !!addon.getMethod('createCollectionIterator'),
  errorIsError: typeof Reflect.get(Error, 'isError') === 'function',
  errorStackAccessor: !!Reflect.getOwnPropertyDescriptor(Error.prototype, 'stack')?.get,
  explicitQueues: !!addon.getMethod('createMicrotaskQueue'),
  finalizationRegistryPredicate: !!addon.getMethod('isFinalizationRegistry'),
  functionRealms: !!addon.getMethod('getFunctionRealm'),
  htmlDDA: addon.supportsHTMLDDA,
  hostHooks: !!setHostHooks,
  iteratorPredicates: !!addon.getMethod('isArrayIterator') &&
    !!addon.getMethod('isStringIterator') && !!addon.getMethod('isRegExpStringIterator'),
  lengthTracking: !!addon.getMethod('isLengthTrackingArrayBufferView'),
  nativeGlobals: !!addon.getMethod('createContextHandle') &&
    !!addon.getMethod('setGlobalObject') && !!addon.getMethod('setPropertyDelegate'),
  'v24+': nodeMajor >= 24,
  'v26+': nodeMajor >= 26,
};
