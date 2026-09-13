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
  explicitQueues: !!addon.getMethod('createMicrotaskQueue'),
  functionRealms: !!addon.getMethod('getFunctionRealm'),
  hostHooks: !!setHostHooks,
  lengthTracking: !!addon.getMethod('isLengthTrackingArrayBufferView'),
  'v24+': nodeMajor >= 24,
  'v26+': nodeMajor >= 26,
};
