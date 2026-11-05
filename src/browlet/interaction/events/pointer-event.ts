import { InternalError } from '../../../infra/index';
import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary, emptySequence,
  idlType, impl, integer, op, reference, roAttr, sequence, xattr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import type { NodeImpl } from '../../dom/nodes/index';
import type { DOMEnvironment } from '../../dom/environment';
import type { WindowImpl } from '../../browsing/window/index';

import { MouseEventImpl, type MouseEventInit, type MouseEventInput } from './mouse-event';

/** Pointer data supplied by construction, without registering a live device or active pointer. */
// https://w3c.github.io/pointerevents/#pointerevent-interface
// MouseInputProcessor connects trusted mouse delivery through PointerEventStream.
// Other device producers still own acquisition, identity, registration, and retirement.
export class PointerEventImpl extends MouseEventImpl {
  pointerId: PointerId;
  /** Contact geometry in CSS pixels. */
  width: number;
  height: number;
  pressure: number;
  tangentialPressure: number;
  /** Plane angles in degrees; absent values can be derived from the spherical angles. */
  tiltX: number;
  tiltY: number;
  twist: number;
  /** Spherical angles in radians; explicit constructor values are retained. */
  altitudeAngle: number;
  azimuthAngle: number;
  pointerType: string;
  isPrimary: boolean;
  /** Author-supplied data; trusted producers use zero for an unidentified device. */
  // https://w3c.github.io/pointerevents/#dom-pointerevent-persistentdeviceid
  // TODO(native device identity): map identifiable hardware to a page/session ID,
  // randomize it for a new session, and never expose the hardware identifier itself.
  // The aggregate mouse producer has no identified device and retains zero.
  persistentDeviceId: number;
  /** Retained event identities, independent of each author-facing sequence result. */
  #coalescedEvents: PointerEventImpl[];
  #predictedEvents: PointerEventImpl[];

  constructor(type: string, eventInitDict: PointerEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    // §3.3.12.2 preserves integer coordinates for these three compatibility types.
    // SPEC_CLASH(pointer-event-coordinate-reinitialization): Keep construction-time rounding like Firefox/WebKit; Chromium re-evaluates it after initEvent changes type.
    if (type !== 'click' && type !== 'auxclick' && type !== 'contextmenu') {
      this.screenX = eventInitDict.screenX ?? 0;
      this.screenY = eventInitDict.screenY ?? 0;
      this.clientX = eventInitDict.clientX ?? 0;
      this.clientY = eventInitDict.clientY ?? 0;
    }
    this.pointerId = eventInitDict.pointerId ?? 0;
    this.width = eventInitDict.width ?? 1;
    this.height = eventInitDict.height ?? 1;
    this.pressure = eventInitDict.pressure ?? 0;
    this.tangentialPressure = eventInitDict.tangentialPressure ?? 0;
    this.tiltX = eventInitDict.tiltX ?? 0;
    this.tiltY = eventInitDict.tiltY ?? 0;
    this.twist = eventInitDict.twist ?? 0;
    this.altitudeAngle = eventInitDict.altitudeAngle ?? Math.PI / 2;
    this.azimuthAngle = eventInitDict.azimuthAngle ?? 0;
    this.pointerType = eventInitDict.pointerType ?? '';
    this.isPrimary = eventInitDict.isPrimary ?? false;
    this.persistentDeviceId = eventInitDict.persistentDeviceId ?? 0;
    this.#coalescedEvents = eventInitDict.coalescedEvents?.slice() ?? [];
    this.#predictedEvents = eventInitDict.predictedEvents?.slice() ?? [];

    // SPEC_CLASH(pointer-event-orientation-support): Use §3.1.5 and Chromium/Firefox's defaults/conversion; the probed WebKit lacks angle attributes and loses some supplied tilts.
    // Derive only a wholly omitted representation. Supplying either member of
    // both pairs keeps the supplied values and defaults the remaining members.
    const hasTilt = eventInitDict.tiltX !== undefined || eventInitDict.tiltY !== undefined;
    const hasAngles = eventInitDict.altitudeAngle !== undefined || eventInitDict.azimuthAngle !== undefined;
    if (hasTilt && !hasAngles) this.#setAnglesFromTilt();
    else if (hasAngles && !hasTilt) this.#setTiltFromAngles();
  }

  /** Create an initialized event in the target's realm; the producer establishes trust before dispatch. */
  // https://w3c.github.io/pointerevents/#dfn-create-a-pointerevent
  static override create(
    type: string, target: NodeImpl | WindowImpl, bubbles: boolean, cancelable: boolean, input: MouseEventInput,
  ): PointerEventImpl {
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.initializePointerEvent(type, target, bubbles, cancelable, input);
    return event;
  }

  /** Copy a targeted mouse input into a fresh event in its target's realm, without dispatching it. */
  // https://w3c.github.io/pointerevents/#dfn-create-pointerevent-from-mouseevent
  // SPEC_GAP(pointer-from-mouse-flags): The draft omits bubbles/cancelable; callers supply them explicitly, as for create().
  static fromMouseEvent(type: string, source: MouseEventImpl, bubbles: boolean, cancelable: boolean): PointerEventImpl {
    const target = source.target;
    // UIEvent initialization needs a node document or Window. This is a producer
    // precondition, not an author-facing conversion of arbitrary dispatched events.
    if (!target || (!target.isNode() && !target.isWindow())) {
      throw new InternalError('PointerEvent creation from MouseEvent requires a Node or Window target');
    }
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.#initializeFromMouseEvent(type, source, bubbles, cancelable, target);
    return event;
  }

  /** Create a trusted activation event at its selected target, with non-pointer identity by default. */
  // https://w3c.github.io/pointerevents/#the-click-auxclick-and-contextmenu-events
  // §§3.3.12.1–3.3.12.2 specialize the existing mouse-field copy. Pointer delivery
  // supplies its retained ID/type; keyboard/voice activation keeps -1 and "".
  // The producer supplies MouseEvent input (including modifiers and click count),
  // rather than reading an ambient input device or inferring data from event names.
  // TODO(HTML §8.1.8.3 / keyboard input): connect §11.2.15's null-native callers
  // through synthetic pointer-event firing with current modifiers and its optional
  // not-trusted flag. HTMLElement.click()
  // and keyboard activation remain their owners' callers, not automatic dispatch here.
  static createActivation(type: PointerActivationEventType, target: NodeImpl, source: MouseEventImpl): PointerEventImpl {
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.#initializeFromMouseEvent(type, source, true, true, target);
    event.view = target.nodeDocument.getRelevantGlobalObject();
    event.relatedTarget = null;
    event.composed = true;
    event.isTrusted = true;
    event.pointerId = -1;
    // SPEC_CLASH(pointer-activation-defaults): Follow the draft and Chromium's pointer defaults; Firefox/WebKit retain isPrimary, and WebKit retains contextmenu pressure.
    return event;
  }

  /** Reduce only the calculation input, retaining a positive exact multiple at the upper endpoint. */
  // SPEC_GAP(pointer-event-orientation-range): Constructor normalization is unspecified. Wrap calculation inputs like Chromium, without changing explicit fields; Firefox clamps altitude.
  // Modulo also bounds the work for arbitrarily large finite author inputs.
  static #wrapAngle(angle: number, maximum: number): number {
    if (angle >= 0 && angle <= maximum) return angle;
    const remainder = angle % maximum;
    if (remainder < 0) return remainder + maximum;
    return remainder === 0 && angle > 0 ? maximum : remainder;
  }

  /** Binding creates a fresh sequence array while preserving each event's platform identity. */
  // SPEC_CLASH(pointer-event-list-realm): Keep Binding's receiver-realm arrays like Chromium/WebKit; Firefox allocates in the borrowed method's realm.
  getCoalescedEvents(): PointerEventImpl[] {
    return this.#coalescedEvents;
  }

  /** Binding creates a fresh sequence array while preserving each event's platform identity. */
  getPredictedEvents(): PointerEventImpl[] {
    return this.#predictedEvents;
  }

  /**
   * Prepare fresh target-realm samples for trusted delivery. Supplied snapshots must
   * be chronological, with timestamps in the parent's time coordinate. An unbatched
   * move/raw input supplies its own single coalesced sample; prediction is optional.
   * Source snapshots remain unchanged and may be reused for corresponding raw/move lists.
   */
  // https://w3c.github.io/pointerevents/#coalesced-and-predicted-events
  initializeSampleLists(samples: PointerEventSamples | undefined, target: NodeImpl): void {
    // SPEC_CLASH(pointer-chord-samples): §9.1 and Firefox retain a sample for chorded pointermove/raw; Chromium/WebKit expose empty lists for these button changes.
    if (!this.isTrusted) return;
    const movement = this.type === 'pointermove' || this.type === 'pointerrawupdate';
    this.#coalescedEvents = movement
      ? this.#createSamples(samples?.coalescedEvents.length ? samples.coalescedEvents : [this], true, target)
      : [];
    this.#predictedEvents = this.type === 'pointermove'
      ? this.#createSamples(samples?.predictedEvents ?? [], false, target)
      : [];
  }

  /** Reset pointer-specific data while initializing the inherited input attributes. */
  // https://w3c.github.io/pointerevents/#dfn-initialize-a-pointerevent
  initializePointerEvent(
    type: string, target: NodeImpl | WindowImpl, bubbles: boolean, cancelable: boolean, input: MouseEventInput,
  ): void {
    this.initializeMouseEvent(type, target, bubbles, cancelable, input);
    // Apply the same §3.3.12.2 coordinate rule as construction; legacy initEvent does not do this.
    if (type !== 'click' && type !== 'auxclick' && type !== 'contextmenu') {
      this.screenX = input.screenX;
      this.screenY = input.screenY;
      this.clientX = input.clientX;
      this.clientY = input.clientY;
    }
    this.pointerId = 0;
    this.width = 1;
    this.height = 1;
    this.pressure = 0;
    this.tangentialPressure = 0;
    this.tiltX = 0;
    this.tiltY = 0;
    this.twist = 0;
    this.altitudeAngle = Math.PI / 2;
    this.azimuthAngle = 0;
    this.pointerType = '';
    this.isPrimary = false;
    this.persistentDeviceId = 0;
    this.#coalescedEvents = [];
    this.#predictedEvents = [];
  }

  /** Apply type-dependent attributes to a fresh internal event, retaining its supplied pointer data and trust. */
  // https://w3c.github.io/pointerevents/#attributes-and-default-actions
  // Attribute-assignment portion of "fire a pointer event".
  // Target selection, capture processing, and dispatch are separate.
  setPointerEventAttributes(type: PointerEventType): void {
    const enterOrLeave = type === 'pointerenter' || type === 'pointerleave';
    const boundary = enterOrLeave || type === 'pointerover' || type === 'pointerout';
    const capture = type === 'gotpointercapture' || type === 'lostpointercapture';
    this.type = type;
    this.bubbles = !enterOrLeave;
    // SPEC_CLASH(pointer-rawupdate-cancelable): Follow the draft and Chromium; the probed Firefox makes raw updates cancelable.
    this.cancelable = !enterOrLeave && !capture && type !== 'pointercancel' && type !== 'pointerrawupdate';
    this.composed = !enterOrLeave;
    // SPEC_CLASH(pointer-event-detail): Follow the draft and Chromium/Firefox's zero; the probed WebKit reports 1 for pointerdown/up.
    this.detail = 0;
    // https://w3c.github.io/pointerevents/#the-pointerup-event
    if (type === 'pointerup') this.pressure = 0;
    // Boundary events retain the opposite target; capture notifications retain
    // the triggering event's attributes, including relatedTarget.
    if (!boundary && !capture) this.relatedTarget = null;

    // TODO(Pointer Events §3.1.3 / input producer): connect PointerEventStream's target
    // preparation and dispatch steps to context-local device delivery.
    // §§10.2–10.3's compatibility mapping and suppression run in PointerEventStream.
    // TODO(Pointer Events §11 / HTML): mouse default actions still need their focus,
    // editing and drag owners; event cancellation alone does not implement them.
  }

  /** Copy input fields into a fresh pointer event, retaining independent dispatch state and sample lists. */
  // https://w3c.github.io/pointerevents/#attributes-and-default-actions
  // SPEC_CLASH(pointer-capture-event-data): Follow the draft and Chromium; WebKit uses defaults, as Firefox also does for detached-target loss.
  override copyInputFrom(source: this): void {
    super.copyInputFrom(source);
    this.pointerId = source.pointerId;
    this.width = source.width;
    this.height = source.height;
    this.pressure = source.pressure;
    this.tangentialPressure = source.tangentialPressure;
    this.tiltX = source.tiltX;
    this.tiltY = source.tiltY;
    this.twist = source.twist;
    this.altitudeAngle = source.altitudeAngle;
    this.azimuthAngle = source.azimuthAngle;
    this.pointerType = source.pointerType;
    this.isPrimary = source.isPrimary;
    this.persistentDeviceId = source.persistentDeviceId;
    // §9 keeps the fresh notification's sample lists empty. Copying attributes
    // does not copy the triggering event's dispatch state, flags, or sample lists.
  }

  // https://w3c.github.io/pointerevents/#populating-and-maintaining-the-coalesced-and-predicted-events-lists
  // SPEC_CLASH(pointer-sample-targets): Follow §9.3/WebKit on every retarget and cleanup; Chromium keeps the original inner target, and Firefox retains the first observed target.
  protected override targetChanged(): void {
    if (!this.isTrusted) return;
    for (const sample of this.#coalescedEvents) sample.target = this.target;
    for (const sample of this.#predictedEvents) sample.target = this.target;
  }

  /** Copy measured data into independent, undispatched events owned by the delivery target's realm. */
  // §9.1–§9.3: source order is a producer precondition, not something allocation may reorder or clamp.
  #createSamples(sources: PointerEventImpl[], coalesced: boolean, target: NodeImpl): PointerEventImpl[] {
    const samples: PointerEventImpl[] = [];
    let previous = coalesced ? -Infinity : this.timeStamp;
    const latest = coalesced ? this.timeStamp : Infinity;
    for (const source of sources) {
      if (source.timeStamp < previous || source.timeStamp > latest) {
        throw new InternalError('Pointer samples must be chronological and on the correct side of the parent timestamp');
      }
      previous = source.timeStamp;
      const sample = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
      // SPEC_CLASH(pointer-sample-data): Preserve measured input and timestamps like all three browsers instead of §9.3's blanket defaulting; keep composed=false like Chromium rather than Firefox/WebKit.
      sample.copyInputFrom(source);
      sample.type = this.type;
      sample.pointerId = this.pointerId;
      sample.pointerType = this.pointerType;
      sample.isPrimary = this.isPrimary;
      sample.target = this.target;
      sample.relatedTarget = null;
      sample.detail = 0;
      // Fresh Event allocation supplies false bubbles/cancelable/composed, null
      // currentTarget, no dispatch path, and empty sample lists of its own.
      samples.push(sample);
    }
    return samples;
  }

  /** Copy only the MouseEvent portion, even when the source is itself a PointerEvent. */
  #initializeFromMouseEvent(
    type: string, source: MouseEventImpl, bubbles: boolean, cancelable: boolean, target: NodeImpl | WindowImpl,
  ): void {
    // Fresh allocation supplies the pointer defaults; the source replaces the
    // inherited input fields, so no current device-state snapshot is needed.
    this.initializeUIEvent(type, target, bubbles, cancelable);
    const timeStamp = this.timeStamp;
    super.copyInputFrom(source);
    // timeStamp belongs to Event creation, rather than the copied mouse fields.
    // Retain the allocation realm's clock instead of importing another realm's timestamp.
    this.timeStamp = timeStamp;
    // A PointerEvent source can still carry fractional MouseEvent coordinates.
    // §3.3.12.2 requires integer coordinates on these compatibility event types.
    if (type === 'click' || type === 'auxclick' || type === 'contextmenu') {
      this.screenX = Math.floor(this.screenX);
      this.screenY = Math.floor(this.screenY);
      this.clientX = Math.floor(this.clientX);
      this.clientY = Math.floor(this.clientY);
    }
  }

  // https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle
  #setAnglesFromTilt(): void {
    let tiltX = this.tiltX % 180;
    let tiltY = this.tiltY % 180;
    if (tiltX > 90) tiltX -= 180;
    else if (tiltX < -90) tiltX += 180;
    if (tiltY > 90) tiltY -= 180;
    else if (tiltY < -90) tiltY += 180;
    const x = tiltX * Math.PI / 180;
    const y = tiltY * Math.PI / 180;

    this.azimuthAngle = 0;
    if (tiltX === 0) {
      if (tiltY > 0) this.azimuthAngle = Math.PI / 2;
      else if (tiltY < 0) this.azimuthAngle = 3 * Math.PI / 2;
    } else if (tiltY === 0) {
      if (tiltX < 0) this.azimuthAngle = Math.PI;
    } else if (Math.abs(tiltX) !== 90 && Math.abs(tiltY) !== 90) {
      this.azimuthAngle = Math.atan2(Math.tan(y), Math.tan(x));
      if (this.azimuthAngle < 0) this.azimuthAngle += 2 * Math.PI;
    }

    if (Math.abs(tiltX) === 90 || Math.abs(tiltY) === 90) this.altitudeAngle = 0;
    else if (tiltX === 0) this.altitudeAngle = Math.PI / 2 - Math.abs(y);
    else if (tiltY === 0) this.altitudeAngle = Math.PI / 2 - Math.abs(x);
    else this.altitudeAngle = Math.atan(1 / Math.sqrt(Math.tan(x) ** 2 + Math.tan(y) ** 2));
  }

  // https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle
  #setTiltFromAngles(): void {
    const altitude = PointerEventImpl.#wrapAngle(this.altitudeAngle, Math.PI / 2);
    const azimuth = PointerEventImpl.#wrapAngle(this.azimuthAngle, 2 * Math.PI);
    if (altitude === 0) {
      if (azimuth === Math.PI / 2 || azimuth === 3 * Math.PI / 2) this.tiltX = 0;
      else this.tiltX = azimuth < Math.PI / 2 || azimuth > 3 * Math.PI / 2 ? 90 : -90;
      if (azimuth === 0 || azimuth === Math.PI || azimuth === 2 * Math.PI) this.tiltY = 0;
      else this.tiltY = azimuth < Math.PI ? 90 : -90;
    } else {
      const tangent = Math.tan(altitude);
      // The attributes are integers, so normalize Math.round's negative zero.
      this.tiltX = Math.round(Math.atan(Math.cos(azimuth) / tangent) * 180 / Math.PI) || 0;
      this.tiltY = Math.round(Math.atan(Math.sin(azimuth) / tangent) * 180 / Math.PI) || 0;
    }
  }
}

/** PointerEvent identifier; native streams scope these to a top-level browsing context. */
export type PointerId = number;

/** Event types covered by §3.1.3.1's table; compatibility click types have separate firing rules. */
export type PointerEventType = PointerInputEventType | 'gotpointercapture' | 'lostpointercapture';

/** Activation events use their own target selection and do not process pending capture. */
export type PointerActivationEventType = 'click' | 'auxclick' | 'contextmenu';

/** Input events that process pending capture; capture notifications use their explicit targets. */
export type PointerInputEventType = 'pointerover' | 'pointerenter' | 'pointerdown' | 'pointermove' | 'pointerrawupdate' |
  'pointerup' | 'pointercancel' | 'pointerout' | 'pointerleave';

/**
 * Chronological native input snapshots; delivery creates independent platform events.
 * The producer owns prediction provenance; list validation cannot detect sensitive
 * history from outside the current gesture.
 */
export interface PointerEventSamples {
  coalescedEvents: PointerEventImpl[];
  predictedEvents: PointerEventImpl[];
}

/** Converted constructor data; missing orientation members remain absent until construction. */
export interface PointerEventInit extends MouseEventInit {
  pointerId?: PointerId;
  width?: number;
  height?: number;
  pressure?: number;
  tangentialPressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  pointerType?: string;
  isPrimary?: boolean;
  persistentDeviceId?: number;
  coalescedEvents?: PointerEventImpl[];
  predictedEvents?: PointerEventImpl[];
}

/*
 * [Exposed=Window]
 * interface PointerEvent : MouseEvent {
 *   constructor(DOMString type, optional PointerEventInit eventInitDict = {});
 *   readonly attribute long pointerId;
 *   readonly attribute double width;
 *   readonly attribute double height;
 *   readonly attribute float pressure;
 *   readonly attribute float tangentialPressure;
 *   readonly attribute long tiltX;
 *   readonly attribute long tiltY;
 *   readonly attribute long twist;
 *   readonly attribute double altitudeAngle;
 *   readonly attribute double azimuthAngle;
 *   readonly attribute DOMString pointerType;
 *   readonly attribute boolean isPrimary;
 *   readonly attribute long persistentDeviceId;
 *   [SecureContext] sequence<PointerEvent> getCoalescedEvents();
 *   sequence<PointerEvent> getPredictedEvents();
 * };
 */
export const pointerEventIDL = defineInterface<DOMEnvironment>({
  name: 'PointerEvent',
  inherits: 'MouseEvent',
  exposed: 'Window',
  implementation: impl(PointerEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('PointerEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('pointerId', idlType.long),
    roAttr('width', idlType.double),
    roAttr('height', idlType.double),
    roAttr('pressure', idlType.float),
    roAttr('tangentialPressure', idlType.float),
    roAttr('tiltX', idlType.long),
    roAttr('tiltY', idlType.long),
    roAttr('twist', idlType.long),
    roAttr('altitudeAngle', idlType.double),
    roAttr('azimuthAngle', idlType.double),
    roAttr('pointerType', idlType.DOMString),
    roAttr('isPrimary', idlType.boolean),
    roAttr('persistentDeviceId', idlType.long),
    op('getCoalescedEvents', sequence(reference('PointerEvent')), [], xattr('SecureContext')),
    op('getPredictedEvents', sequence(reference('PointerEvent'))),
  ],
});

/*
 * dictionary PointerEventInit : MouseEventInit {
 *   long pointerId = 0;
 *   double width = 1;
 *   double height = 1;
 *   float pressure = 0;
 *   float tangentialPressure = 0;
 *   long tiltX;
 *   long tiltY;
 *   long twist = 0;
 *   double altitudeAngle;
 *   double azimuthAngle;
 *   DOMString pointerType = "";
 *   boolean isPrimary = false;
 *   long persistentDeviceId = 0;
 *   sequence<PointerEvent> coalescedEvents = [];
 *   sequence<PointerEvent> predictedEvents = [];
 * };
 */
export const pointerEventInitIDL = defineDictionary({
  name: 'PointerEventInit',
  inherits: 'MouseEventInit',
  members: [
    dictMember('pointerId', idlType.long, { default: integer(0) }),
    dictMember('width', idlType.double, { default: integer(1) }),
    dictMember('height', idlType.double, { default: integer(1) }),
    dictMember('pressure', idlType.float, { default: integer(0) }),
    dictMember('tangentialPressure', idlType.float, { default: integer(0) }),
    dictMember('tiltX', idlType.long),
    dictMember('tiltY', idlType.long),
    dictMember('twist', idlType.long, { default: integer(0) }),
    dictMember('altitudeAngle', idlType.double),
    dictMember('azimuthAngle', idlType.double),
    dictMember('pointerType', idlType.DOMString, { default: '' }),
    dictMember('isPrimary', idlType.boolean, { default: false }),
    dictMember('persistentDeviceId', idlType.long, { default: integer(0) }),
    dictMember('coalescedEvents', sequence(reference('PointerEvent')), { default: emptySequence }),
    dictMember('predictedEvents', sequence(reference('PointerEvent')), { default: emptySequence }),
  ],
});
