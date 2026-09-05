import { it } from 'vitest';

import { nodeRuntime } from '../src/js-engine';

/*
 * Plain stock Node is expected to fail tests that require explicit queues
 * and context handles. A backend that supplies explicit queues runs the
 * compatibility expectations normally, exposing any remaining gaps.
 */
export const itCompatPasses: typeof it.fails =
  nodeRuntime.hasExplicitMicrotaskQueues
  ? it
  : it.fails;
