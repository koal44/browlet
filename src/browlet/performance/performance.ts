import { EventTargetImpl } from '../dom/events/event-target';
import { withPerformanceStub } from '../stubs';
import {
  defineInterface, defineTypedef, idlType, op, roAttr, reference, xattr,
} from '../../web-idl/declaration/index';
import { impl } from '../../web-idl/index';
import type { EnvironmentTiming } from './high-resolution-time';
import { implicitlyConvertDurationToTimestamp } from './clock';

/*
 * typedef double DOMHighResTimeStamp;
 * typedef unsigned long long EpochTimeStamp;
 *
 * [Exposed=(Window,Worker)]
 * interface Performance : EventTarget {
 *   DOMHighResTimeStamp now();
 *   readonly attribute DOMHighResTimeStamp timeOrigin;
 *   [Default] object toJSON();
 * };
 */
export class PerformanceImpl
  extends withPerformanceStub(EventTargetImpl)
  implements Performance
{
  readonly #timing: EnvironmentTiming;

  constructor(timing: EnvironmentTiming) {
    super();
    this.#timing = timing;
  }

  now(): DOMHighResTimeStamp {
    return implicitlyConvertDurationToTimestamp(
      this.#timing.currentHighResolutionTime(),
    );
  }

  get timeOrigin(): DOMHighResTimeStamp {
    return implicitlyConvertDurationToTimestamp(
      this.#timing.getTimeOriginTimestamp(),
    );
  }
}

// -- Web IDL ------------------------------------------------------------

export const domHighResTimeStampIDL = defineTypedef({
  name: 'DOMHighResTimeStamp',
  type: idlType.double,
});

export const epochTimeStampIDL = defineTypedef({
  name: 'EpochTimeStamp',
  type: idlType.unsignedLongLong,
});

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
