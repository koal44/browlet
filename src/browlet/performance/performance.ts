import { EventTargetImpl } from '../dom/events/event-target';
import {
  defineInterface, defineTypedef, idlType, impl, op, reference, roAttr, xattr,
} from '../../web-idl/index';
import type { EnvironmentTiming } from './high-resolution-time';
import type { DOMEnvironment } from '../dom/environment';

/** Exposes coarsened timestamps relative to its environment time origin. */
// https://w3c.github.io/hr-time/#the-performance-interface
export class PerformanceImpl extends EventTargetImpl {
  /** Environment-owned clock conversion and precision policy. */
  #timing: EnvironmentTiming;

  constructor(timing: EnvironmentTiming, env: DOMEnvironment) {
    super(env);
    this.#timing = timing;
  }

  /** Elapsed high-resolution time since this environment's origin. */
  // https://w3c.github.io/hr-time/#dom-performance-now
  now(): DOMHighResTimeStamp {
    return this.#timing.currentHighResolutionTime().toTimestamp();
  }

  /** Environment time origin expressed relative to the Unix epoch. */
  // https://w3c.github.io/hr-time/#dom-performance-timeorigin
  get timeOrigin(): DOMHighResTimeStamp {
    return this.#timing.getTimeOriginTimestamp().toTimestamp();
  }
}

/*
 * typedef double DOMHighResTimeStamp;
 */
export const domHighResTimeStampIDL = defineTypedef({
  name: 'DOMHighResTimeStamp',
  type: idlType.double,
});

/*
 * typedef unsigned long long EpochTimeStamp;
 */
export const epochTimeStampIDL = defineTypedef({
  name: 'EpochTimeStamp',
  type: idlType.unsignedLongLong,
});

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
