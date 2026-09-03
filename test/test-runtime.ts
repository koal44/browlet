import { it } from 'vitest';

import { nodeRuntime } from '../src/javascript/index';

/*
 * Stock Node is expected to fail tests that require compatible-Node VM
 * facilities. The supported compatible profile includes explicit V8 queues,
 * which provide one stable discriminator without probing every facility.
 * Keep those failures visible without making the stock suite red.
 */
export const itCompatPasses: typeof it.fails =
  nodeRuntime.hasExplicitMicrotaskQueues
  ? it
  : it.fails;
