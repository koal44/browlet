import { it } from 'vitest';

import { addon, setHostHooks } from '../src/js-engine';

/** Run normally when every requirement holds; otherwise expect failure. */
export function itPassesWith(...requirements: RuntimeRequirement[]): typeof it.fails {
  return requirements.every((requirement) => supported[requirement]) ? it : it.fails;
}

type RuntimeRequirement = keyof typeof supported;

const nodeMajor = Number(process.versions.node.split('.')[0]);
const supported = {
  codeGeneration: !!addon.setModifyCodeGenerationFromStringsCallback,
  collectionIterators: !!addon.createCollectionIterator,
  dynamicImport: !addon.createContextHandle || addon.supportsDynamicImport,
  errorIsError: typeof Reflect.get(Error, 'isError') === 'function',
  errorStackAccessor: !!Reflect.getOwnPropertyDescriptor(Error.prototype, 'stack')?.get,
  exceptionReporting: !!addon.setExceptionReporter,
  explicitQueues: !!addon.createMicrotaskQueue,
  finalizationRegistryPredicate: !!addon.isFinalizationRegistry,
  functionRealms: !!addon.getFunctionRealm,
  // Node 24's own import loader rejects across a guarded native global boundary.
  guardedNodeImport: !addon.createContextHandle || nodeMajor >= 26,
  htmlDDA: addon.supportsHTMLDDA,
  hostHooks: !!setHostHooks,
  importMeta: !addon.createContextHandle || addon.supportsImportMeta,
  iteratorPredicates: !!addon.isArrayIterator &&
    !!addon.isStringIterator && !!addon.isRegExpStringIterator,
  lengthTracking: !!addon.isLengthTrackingArrayBufferView,
  nativeGlobals: !!addon.createContextHandle &&
    !!addon.setGlobalObject && !!addon.setPropertyDelegate,
  platformEntries: !!addon.createFunctionWithIncumbent,
  promiseRejections: !!addon.setPromiseRejectionTracker &&
    !!addon.isPromiseHandled && !!addon.getPromiseResult,
  temporalClock: !!addon.setTemporalHostSystemUTCEpochNanosecondsCallback,
  'v24+': nodeMajor >= 24,
  'v26+': nodeMajor >= 26,
};
