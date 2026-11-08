import {
  arg, atArg, ctor, defineDictionary, defineInterface, definePartialInterface, dictMember,
  emptyDictionary, idlType, impl, nullable, op, reference, roAttr,
} from '../../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../../timing/index';

import type { ElementImpl } from '../../dom/nodes/index';
import type { DOMEnvironment } from '../../dom/environment';
import type { WindowProxyHandle } from '../../browsing/window/index';

import { UIEventImpl, type UIEventInit } from './ui-event';

/** Text captured for one composition notification, independent of the IME session. */
// https://w3c.github.io/uievents/#interface-compositionevent
// TODO(UI Events §§3.6.2–3.6.7): The input producer must own the composition session,
// select its focused target (HTML §6.6), and coordinate updates with editing/selection
// (HTML §6.8 and Input Events). End notification is required even after canceled start;
// keyboard/input isComposing values must reflect that session, not synthetic dispatch.
// SPEC_CLASH(composition-input-order): UI Events §3.6.6 puts beforeinput before compositionupdate and allows cancellation; Input Events §7 reverses them and makes composition edits noncancelable.
// InputEventImpl.create follows Input Events' noncancelable insertCompositionText fields;
// real session ordering remains pending browser IME evidence and an owner-level decision.
export class CompositionEventImpl extends UIEventImpl {
  /** Converted text; empty data does not imply an absent or canceled session. */
  data: string;

  constructor(type: string, eventInitDict: CompositionEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.data = eventInitDict.data ?? '';
  }

  /**
   * Prepare a trusted notification for the producer's selected target and text.
   * Supply original text for start, current text for update, or final text for end;
   * an empty string is valid. Target selection, session state, and editing remain
   * with the composition producer. Preparation does not dispatch the event.
   */
  // https://w3c.github.io/uievents/#event-type-compositionstart
  // https://w3c.github.io/uievents/#event-type-compositionupdate
  // https://w3c.github.io/uievents/#event-type-compositionend
  // This implementation factory combines DOM allocation with §3.6.7's event tables.
  static create(type: CompositionEventType, target: ElementImpl, data: string): CompositionEventImpl {
    const event = target.createTrustedEvent(CompositionEventImpl);
    // SPEC_CLASH(composition-event-cancelability): Follow §3.6.7's start-only cancellation; Blink/WebKit mark all three cancelable, Gecko none.
    event.initializeUIEvent(`composition${type}`, target, true, type === 'start');
    event.composed = true;
    event.isTrusted = true;
    event.data = data;
    return event;
  }

  /** @deprecated Reinitialize the legacy fields unless this event is being dispatched. */
  // https://w3c.github.io/uievents/#dom-compositionevent-initcompositionevent
  initCompositionEvent(
    type: string, bubbles = false, cancelable = false, view: WindowProxyHandle | null = null, data = '',
  ): void {
    if (this.dispatching) return;

    // The initializer accepts WindowProxy; retain its current Window as UIEvent.view does.
    this.initUIEvent(type, bubbles, cancelable, view?.windowImplementation ?? null, 0);
    this.data = data;
  }
}

/** Converted constructor data; the producer determines the composition's text. */
export interface CompositionEventInit extends UIEventInit {
  data?: string;
}

export type CompositionEventType = 'start' | 'update' | 'end';

/*
 * [Exposed=Window]
 * interface CompositionEvent : UIEvent {
 *   constructor(DOMString type, optional CompositionEventInit eventInitDict = {});
 *   readonly attribute USVString data;
 * };
 */
export const compositionEventIDL = defineInterface<DOMEnvironment>({
  name: 'CompositionEvent',
  inherits: 'UIEvent',
  exposed: 'Window',
  implementation: impl(CompositionEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('CompositionEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    // SPEC_CLASH(composition-event-data-string): Match the DOMString constructor/initializer inputs and all three browsers' UTF-16 preservation, despite the USVString attribute above.
    roAttr('data', idlType.DOMString),
  ],
});

/*
 * dictionary CompositionEventInit : UIEventInit {
 *   DOMString data = "";
 * };
 */
export const compositionEventInitIDL = defineDictionary({
  name: 'CompositionEventInit',
  inherits: 'UIEventInit',
  members: [dictMember('data', idlType.DOMString, { default: '' })],
});

/*
 * partial interface CompositionEvent {
 *   undefined initCompositionEvent(DOMString typeArg, optional boolean bubblesArg = false,
 *     optional boolean cancelableArg = false, optional WindowProxy? viewArg = null,
 *     optional DOMString dataArg = "");
 * };
 */
export const compositionEventInitializersIDL = definePartialInterface({
  name: 'CompositionEvent',
  members: [
    op('initCompositionEvent', idlType.undefined, [
      arg('typeArg', idlType.DOMString),
      arg('bubblesArg', idlType.boolean, { default: false, optional: true }),
      arg('cancelableArg', idlType.boolean, { default: false, optional: true }),
      arg('viewArg', nullable(reference('WindowProxy')), { default: null, optional: true }),
      // SPEC_CLASH(composition-event-legacy-data): Follow the draft/WebKit's empty DOMString default; Chromium uses "undefined" and Firefox nullable data defaulting to null.
      arg('dataArg', idlType.DOMString, { default: '', optional: true }),
    ]),
  ],
});
