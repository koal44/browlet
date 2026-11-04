import { InternalError } from '../../../infra/index';
import {
  arg, atArg, ctor, defineDictionary, defineInterface, definePartialDictionary, definePartialInterface,
  dictMember, emptyDictionary, idlType, impl, integer, nullable, op, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import type { EventTargetImpl } from '../../dom/events/index';
import type { NodeImpl } from '../../dom/nodes/index';
import type { DOMEnvironment } from '../../dom/environment';
import type { WindowImpl } from '../../browsing/window/index';

import { UIEventImpl } from './ui-event';
import { EventModifierState, type EventModifierInit } from './event-modifiers';

/** Mouse-event data, independent of device state and native input delivery. */
// https://w3c.github.io/pointerevents/#mouseevent-interface
// TODO(Pointer Events, MouseEvent Algorithms): the native producer still needs
// hit testing, held buttons/modifiers, and click counting. initializeMouseEvent()
// consumes the producer's explicit input snapshot and clears movement before
// Window.setPointerLockAttributesForMousemove().
// Author construction and dispatch must not update the Window's movement history.
export class MouseEventImpl extends UIEventImpl {
  /** Screen-relative coordinates after the MouseEvent compatibility rounding. */
  screenX: number;
  screenY: number;
  /** Coordinates relative to the associated viewport. */
  clientX: number;
  clientY: number;
  /** Changed button and the independently supplied held-button bitmask. */
  button: number;
  buttons: number;
  /** Relative motion supplied by construction or the native producer. */
  movementX: number;
  movementY: number;
  /** Modifier snapshot shared when copying input data and replaced by legacy initialization. */
  #modifiers: EventModifierState;
  /** Native initialization includes AltGraph in altKey without changing the separate Alt flag. */
  #altKey: boolean;

  constructor(type: string, eventInitDict: MouseEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    // SPEC_CLASH(mouse-event-coordinates): Accept CSSOM View doubles but floor MouseEvent coordinates like all three browsers; Pointer Events still declares long.
    this.screenX = Math.floor(eventInitDict.screenX ?? 0);
    this.screenY = Math.floor(eventInitDict.screenY ?? 0);
    this.clientX = Math.floor(eventInitDict.clientX ?? 0);
    this.clientY = Math.floor(eventInitDict.clientY ?? 0);
    this.button = eventInitDict.button ?? 0;
    this.buttons = eventInitDict.buttons ?? 0;
    this.relatedTarget = eventInitDict.relatedTarget ?? null;
    // SPEC_CLASH(mouse-event-fractional-movement): Keep Pointer Lock's doubles, as WebKit does; Chromium/Firefox truncate synthetic movement.
    this.movementX = eventInitDict.movementX ?? 0;
    this.movementY = eventInitDict.movementY ?? 0;
    this.#modifiers = new EventModifierState(eventInitDict);
    this.#altKey = eventInitDict.altKey ?? false;
  }

  get layerX(): number {
    // TODO(Pointer Events MouseEvent.layerX / CSS Positioned Layout, painting a stacking context):
    // Find the nearest positioned/stacking-context ancestor and convert the event position.
    throw new InternalError('MouseEvent.layerX requires CSS layout and painting geometry');
  }

  get layerY(): number {
    // TODO(Pointer Events MouseEvent.layerY / CSS Positioned Layout, painting a stacking context):
    // Find the nearest positioned/stacking-context ancestor and convert the event position.
    throw new InternalError('MouseEvent.layerY requires CSS layout and painting geometry');
  }

  get ctrlKey(): boolean { return this.#modifiers.getModifierState('Control'); }
  get shiftKey(): boolean { return this.#modifiers.getModifierState('Shift'); }
  get altKey(): boolean { return this.#altKey; }
  get metaKey(): boolean { return this.#modifiers.getModifierState('Meta'); }

  // SPEC_CLASH(mouse-event-which): Use UI Events' button + 1 with unsigned-long wrapping, like Chromium/Firefox; WebKit returns zero for negative buttons and fresh legacy events.
  override get which(): number { return (this.button + 1) >>> 0; }

  getModifierState(keyArg: string): boolean {
    return this.#modifiers.getModifierState(keyArg);
  }

  /** Initialize producer data; the producer establishes trust after DOM initialization. */
  // https://w3c.github.io/pointerevents/#dfn-initialize-a-mouseevent
  // Native coordinates and device state are explicit inputs, not ambient globals.
  initializeMouseEvent(
    type: string, target: NodeImpl | WindowImpl, bubbles: boolean, cancelable: boolean, input: MouseEventInput,
  ): void {
    this.initializeUIEvent(type, target, bubbles, cancelable);
    this.screenX = Math.floor(input.screenX);
    this.screenY = Math.floor(input.screenY);
    this.clientX = Math.floor(input.clientX);
    this.clientY = Math.floor(input.clientY);
    this.#modifiers = input.modifiers;
    // "Set mouse event modifiers" keeps Alt and AltGraph distinct, but either sets altKey.
    this.#altKey = input.modifiers.getModifierState('Alt') || input.modifiers.getModifierState('AltGraph');
    this.button = 0;
    this.buttons = input.buttons;
    this.initializePointerLockAttributes();
  }

  /** @deprecated Reinitialize the legacy fields unless this event is being dispatched. */
  // https://w3c.github.io/pointerevents/#dom-mouseevent-initmouseevent
  initMouseEvent(
    type: string, bubbles = false, cancelable = false, view: WindowImpl | null = null, detail = 0,
    screenX = 0, screenY = 0, clientX = 0, clientY = 0,
    ctrlKey = false, altKey = false, shiftKey = false, metaKey = false,
    button = 0, relatedTarget: EventTargetImpl | null = null,
  ): void {
    if (this.dispatching) return;

    this.initUIEvent(type, bubbles, cancelable, view, detail);
    // The legacy signature keeps long arguments, unlike the constructor's doubles.
    // Chromium/Firefox truncate these inputs; WebKit floors negative fractions.
    this.screenX = screenX;
    this.screenY = screenY;
    this.clientX = clientX;
    this.clientY = clientY;
    this.#modifiers = new EventModifierState({ ctrlKey, altKey, shiftKey, metaKey });
    this.#altKey = altKey;
    this.button = button;
    this.relatedTarget = relatedTarget;
    // SPEC_CLASH(mouse-event-legacy-buttons): Preserve the unaddressed buttons field, like Firefox/WebKit; Chromium clears it.
    // All three browsers preserve movement. Legacy initialization is not native input.
  }

  /** Clear relative motion during host-event initialization, before applying native movement. */
  // https://w3c.github.io/uievents/#initialize-pointerlock-attributes-for-mouseevent-id
  initializePointerLockAttributes(): void {
    this.movementX = 0;
    this.movementY = 0;
  }

  override isMouseEvent(): this is MouseEventImpl {
    return true;
  }

  /** Copy input attributes into a fresh event without copying dispatch or cancellation state. */
  protected copyInputFrom(source: MouseEventImpl): void {
    this.timeStamp = source.timeStamp;
    this.view = source.view;
    this.detail = source.detail;
    this.screenX = source.screenX;
    this.screenY = source.screenY;
    this.clientX = source.clientX;
    this.clientY = source.clientY;
    this.button = source.button;
    this.buttons = source.buttons;
    this.relatedTarget = source.relatedTarget;
    this.movementX = source.movementX;
    this.movementY = source.movementY;
    // Modifier snapshots have no mutating operations; legacy initialization replaces the snapshot.
    this.#modifiers = source.#modifiers;
    this.#altKey = source.#altKey;
  }
}

/** Normalized producer input, with positions already mapped to screen/viewport CSS pixels. */
// TODO(Pointer Events, MouseEvent Algorithms / native input and CSSOM View): the
// input adapter must supply current buttons/modifiers and mapped coordinates.
// There is no default snapshot: missing input must not masquerade as an idle mouse.
export type MouseEventInput = {
  screenX: number;
  screenY: number;
  clientX: number;
  clientY: number;
  buttons: number;
  modifiers: EventModifierState;
};

/** A position relative to the origin of the screen coordinate system. */
export type ScreenPosition = {
  x: number;
  y: number;
};

/** Converted data; construction does not infer button state or event-type defaults. */
export interface MouseEventInit extends EventModifierInit {
  screenX?: number;
  screenY?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  buttons?: number;
  relatedTarget?: EventTargetImpl | null;
  movementX?: number;
  movementY?: number;
}

// The four coordinate declarations use CSSOM View's replacement double types.
// Other CSSOM View extensions (page/offset coordinates and x/y aliases) remain
// with that owner; no geometry or scrolling calculation is implied by this binding.
/*
 * [Exposed=Window]
 * interface MouseEvent : UIEvent {
 *   constructor(DOMString type, optional MouseEventInit eventInitDict = {});
 *   readonly attribute double screenX;
 *   readonly attribute double screenY;
 *   readonly attribute double clientX;
 *   readonly attribute double clientY;
 *   readonly attribute long layerX;
 *   readonly attribute long layerY;
 *   readonly attribute boolean ctrlKey;
 *   readonly attribute boolean shiftKey;
 *   readonly attribute boolean altKey;
 *   readonly attribute boolean metaKey;
 *   readonly attribute short button;
 *   readonly attribute unsigned short buttons;
 *   readonly attribute EventTarget? relatedTarget;
 *   boolean getModifierState(DOMString keyArg);
 * };
 */
export const mouseEventIDL = defineInterface<DOMEnvironment>({
  name: 'MouseEvent',
  inherits: 'UIEvent',
  exposed: 'Window',
  implementation: impl(MouseEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('MouseEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('screenX', idlType.double),
    roAttr('screenY', idlType.double),
    roAttr('clientX', idlType.double),
    roAttr('clientY', idlType.double),
    roAttr('layerX', idlType.long),
    roAttr('layerY', idlType.long),
    roAttr('ctrlKey', idlType.boolean),
    roAttr('shiftKey', idlType.boolean),
    roAttr('altKey', idlType.boolean),
    roAttr('metaKey', idlType.boolean),
    roAttr('button', idlType.short),
    roAttr('buttons', idlType.unsignedShort),
    roAttr('relatedTarget', nullable(reference('EventTarget'))),
    op('getModifierState', idlType.boolean, [arg('keyArg', idlType.DOMString)]),
  ],
});

/*
 * dictionary MouseEventInit : EventModifierInit {
 *   double screenX = 0;
 *   double screenY = 0;
 *   double clientX = 0;
 *   double clientY = 0;
 *   short button = 0;
 *   unsigned short buttons = 0;
 *   EventTarget? relatedTarget = null;
 * };
 */
export const mouseEventInitIDL = defineDictionary({
  name: 'MouseEventInit',
  inherits: 'EventModifierInit',
  members: [
    dictMember('screenX', idlType.double, { default: integer(0) }),
    dictMember('screenY', idlType.double, { default: integer(0) }),
    dictMember('clientX', idlType.double, { default: integer(0) }),
    dictMember('clientY', idlType.double, { default: integer(0) }),
    dictMember('button', idlType.short, { default: integer(0) }),
    dictMember('buttons', idlType.unsignedShort, { default: integer(0) }),
    dictMember('relatedTarget', nullable(reference('EventTarget')), { default: null }),
  ],
});

/*
 * partial interface MouseEvent {
 *   undefined initMouseEvent(DOMString typeArg, optional boolean bubblesArg = false,
 *     optional boolean cancelableArg = false, optional Window? viewArg = null,
 *     optional long detailArg = 0, optional long screenXArg = 0, optional long screenYArg = 0,
 *     optional long clientXArg = 0, optional long clientYArg = 0,
 *     optional boolean ctrlKeyArg = false, optional boolean altKeyArg = false,
 *     optional boolean shiftKeyArg = false, optional boolean metaKeyArg = false,
 *     optional short buttonArg = 0, optional EventTarget? relatedTargetArg = null);
 * };
 */
export const mouseEventInitializersIDL = definePartialInterface({
  name: 'MouseEvent',
  members: [
    op('initMouseEvent', idlType.undefined, [
      arg('typeArg', idlType.DOMString),
      arg('bubblesArg', idlType.boolean, { default: false, optional: true }),
      arg('cancelableArg', idlType.boolean, { default: false, optional: true }),
      arg('viewArg', nullable(reference('Window')), { default: null, optional: true }),
      arg('detailArg', idlType.long, { default: integer(0), optional: true }),
      arg('screenXArg', idlType.long, { default: integer(0), optional: true }),
      arg('screenYArg', idlType.long, { default: integer(0), optional: true }),
      arg('clientXArg', idlType.long, { default: integer(0), optional: true }),
      arg('clientYArg', idlType.long, { default: integer(0), optional: true }),
      arg('ctrlKeyArg', idlType.boolean, { default: false, optional: true }),
      arg('altKeyArg', idlType.boolean, { default: false, optional: true }),
      arg('shiftKeyArg', idlType.boolean, { default: false, optional: true }),
      arg('metaKeyArg', idlType.boolean, { default: false, optional: true }),
      arg('buttonArg', idlType.short, { default: integer(0), optional: true }),
      arg('relatedTargetArg', nullable(reference('EventTarget')), { default: null, optional: true }),
    ]),
  ],
});

// https://w3c.github.io/pointerlock/#extensions-to-the-mouseevent-interface
/*
 * partial interface MouseEvent {
 *   readonly attribute double movementX;
 *   readonly attribute double movementY;
 * };
 */
export const mouseEventMovementIDL = definePartialInterface({
  name: 'MouseEvent',
  members: [roAttr('movementX', idlType.double), roAttr('movementY', idlType.double)],
});

/*
 * partial dictionary MouseEventInit {
 *   double movementX = 0;
 *   double movementY = 0;
 * };
 */
export const mouseEventMovementInitIDL = definePartialDictionary({
  name: 'MouseEventInit',
  members: [
    dictMember('movementX', idlType.double, { default: integer(0) }),
    dictMember('movementY', idlType.double, { default: integer(0) }),
  ],
});
