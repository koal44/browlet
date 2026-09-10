import { it } from 'vitest';

import { jsRuntime } from '../src/js-engine';

/** Run normally when every requirement holds; otherwise expect failure. */
export function itPassesWith(...requirements: RuntimeRequirement[]): typeof it.fails {
  return requirements.every((requirement) => supported[requirement]) ? it : it.fails;
}

type RuntimeRequirement = keyof typeof supported;

const nodeMajor = Number(process.versions.node.split('.')[0]);
const supported = {
  explicitQueues: jsRuntime.hasExplicitMicrotaskQueues,
  hostHooks: jsRuntime.supportsHostHooks,
  lengthTracking: jsRuntime.isLengthTrackingArrayBufferView(new Uint8Array()) !== undefined,
  'v24+': nodeMajor >= 24,
  'v26+': nodeMajor >= 26,
};
