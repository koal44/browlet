import {
  arg, atArg, constant, ctor, defineDictionary, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import type { DOMEnvironment } from '../../dom/environment';

import { MouseEventImpl, type MouseEventInit } from './mouse-event';

/** Wheel measurements and units for one notification, independent of a device gesture. */
// https://w3c.github.io/pointerevents/#interface-wheelevent
// Document.wheelInput owns queued native delivery and gesture targeting.
// Constructing or dispatching this data object does not enter that producer;
// its hit testing, Pointer Lock, and scrolling/zooming dependencies remain explicit.
export class WheelEventImpl extends MouseEventImpl {
  /** Signed deltas in the units identified by deltaMode; no unit conversion here. */
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  /** Converted unsigned-long input; native input must choose a DOM_DELTA unit. */
  deltaMode: number;
  /** Whether the supplied input describes platform-synthesized scroll inertia. */
  momentum: boolean;

  constructor(type: string, eventInitDict: WheelEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    // SPEC_CLASH(wheel-event-negative-zero): Preserve Web IDL doubles, as Firefox does; Chromium/WebKit normalize the probed deltaX negative zero.
    this.deltaX = eventInitDict.deltaX ?? 0;
    this.deltaY = eventInitDict.deltaY ?? 0;
    this.deltaZ = eventInitDict.deltaZ ?? 0;
    // SPEC_CLASH(wheel-event-delta-mode): Follow the unsigned-long constructor IDL and all three browsers; prose restricts deltaMode to the three native units.
    this.deltaMode = eventInitDict.deltaMode ?? 0;
    this.momentum = eventInitDict.momentum ?? false;
  }
}

/** Converted constructor data; author input does not identify a native transaction. */
export interface WheelEventInit extends MouseEventInit {
  deltaX?: number;
  deltaY?: number;
  deltaZ?: number;
  deltaMode?: number;
  momentum?: boolean;
}

/*
 * [Exposed=Window]
 * interface WheelEvent : MouseEvent {
 *   constructor(DOMString type, optional WheelEventInit eventInitDict = {});
 *   const unsigned long DOM_DELTA_PIXEL = 0x00;
 *   const unsigned long DOM_DELTA_LINE = 0x01;
 *   const unsigned long DOM_DELTA_PAGE = 0x02;
 *   readonly attribute double deltaX;
 *   readonly attribute double deltaY;
 *   readonly attribute double deltaZ;
 *   readonly attribute unsigned long deltaMode;
 *   readonly attribute boolean momentum;
 * };
 */
export const wheelEventIDL = defineInterface<DOMEnvironment>({
  name: 'WheelEvent',
  inherits: 'MouseEvent',
  exposed: 'Window',
  implementation: impl(WheelEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('WheelEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    constant('DOM_DELTA_PIXEL', idlType.unsignedLong, integer(0)),
    constant('DOM_DELTA_LINE', idlType.unsignedLong, integer(1)),
    constant('DOM_DELTA_PAGE', idlType.unsignedLong, integer(2)),
    roAttr('deltaX', idlType.double),
    roAttr('deltaY', idlType.double),
    roAttr('deltaZ', idlType.double),
    roAttr('deltaMode', idlType.unsignedLong),
    // SPEC_CLASH(wheel-event-momentum): Implement the draft/Chromium field; Firefox/WebKit do not yet expose it.
    roAttr('momentum', idlType.boolean),
  ],
});

/*
 * dictionary WheelEventInit : MouseEventInit {
 *   double deltaX = 0.0;
 *   double deltaY = 0.0;
 *   double deltaZ = 0.0;
 *   unsigned long deltaMode = 0;
 *   boolean momentum = false;
 * };
 */
export const wheelEventInitIDL = defineDictionary({
  name: 'WheelEventInit',
  inherits: 'MouseEventInit',
  members: [
    dictMember('deltaX', idlType.double, { default: integer(0) }),
    dictMember('deltaY', idlType.double, { default: integer(0) }),
    dictMember('deltaZ', idlType.double, { default: integer(0) }),
    dictMember('deltaMode', idlType.unsignedLong, { default: integer(0) }),
    dictMember('momentum', idlType.boolean, { default: false }),
  ],
});
