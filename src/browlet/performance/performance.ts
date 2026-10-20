import {
  defineInterface, idlType, impl, op, reference, roAttr, xattr,
} from '../../web-idl/core/index';

import type { EnvironmentTiming, DOMHighResTimeStamp } from '../timing/index';
import { EventTargetImpl } from '../dom/events/index';
import type { DOMEnvironment } from '../dom/index';

/** Exposes coarsened timestamps relative to its environment time origin. */
// https://w3c.github.io/hr-time/#the-performance-interface
export class PerformanceImpl extends EventTargetImpl {
  /** Environment-owned clock conversion and precision policy. */
  #timing: EnvironmentTiming;

  constructor(timing: EnvironmentTiming, env: DOMEnvironment) {
    super(env);
    this.#timing = timing;
  }

  /** Environment time origin expressed relative to the Unix epoch. */
  // https://w3c.github.io/hr-time/#dom-performance-timeorigin
  get timeOrigin(): DOMHighResTimeStamp {
    return this.#timing.getTimeOriginTimestamp().toTimestamp();
  }

  /** Elapsed high-resolution time since this environment's origin. */
  // https://w3c.github.io/hr-time/#dom-performance-now
  now(): DOMHighResTimeStamp {
    return this.#timing.currentHighResolutionTime().toTimestamp();
  }
}

/*
 * [Exposed=(Window,Worker)]
 * interface Performance : EventTarget {
 *   DOMHighResTimeStamp now();
 *   readonly attribute DOMHighResTimeStamp timeOrigin;
 *   [Default] object toJSON();
 * };
 */
export const performanceIDL = defineInterface({
  name: 'Performance',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  implementation: impl(PerformanceImpl),
  members: [
    op('now', reference('DOMHighResTimeStamp')),
    roAttr('timeOrigin', reference('DOMHighResTimeStamp')),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});
