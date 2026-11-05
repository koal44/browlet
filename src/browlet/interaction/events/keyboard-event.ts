import {
  arg, atArg, constant, ctor, defineDictionary, defineInterface, definePartialDictionary, definePartialInterface,
  dictMember, emptyDictionary, idlType, impl, integer, nullable, op, reference, roAttr,
} from '../../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../../timing/index';

import type { NodeImpl } from '../../dom/nodes/index';
import type { DOMEnvironment } from '../../dom/environment';
import type { WindowImpl } from '../../browsing/window/index';

import { UIEventImpl } from './ui-event';
import { EventModifierState, type EventModifierInit } from './event-modifiers';

/** Key data and modifier state captured for one notification. */
// https://w3c.github.io/uievents/#interface-keyboardevent
// KeyboardInputProcessor retains adapter-supplied modifier state before queuing
// trusted delivery, then uses selectKey() for each press/release independently.
// These per-event snapshots do not change device state or establish an IME session.
// TODO(UI Events §§4.2–4.3): The native adapter must supply layout/modifier facts
// afresh for every notification, including key-string classification and glyph-only text.
// isKeyboardCode() recognizes the vocabulary; physical/native scan-code mapping,
// including Fn/media positions and virtual keyboards, still belongs to the adapter.
// Dead keys/IME need composition state, not inferred keystrokes. Constructor strings
// remain converted DOMStrings and must bypass the producer's NFC selection.
// SPEC_CLASH(virtual-keyboard-code): §4.2.4 permits undefined/factory-reset key values; UIEvents-Code requires its code vocabulary. Producer choice remains pending.
// TODO(UI Events §§3.5.5–3.5.6): Connect the producer's explicit focus, activation,
// default-action and composition dependencies. Editing must order beforeinput ->
// edit -> input. Queued keyup already selects current focus, and cancellation
// already gates ordinary keydown effects. Synthetic dispatch does not run them.
// TODO(UI Events §§7.3, 8.3): Native legacy codes need the OS/key mapping and IME state;
// do not derive them from author-supplied key strings. Optional keypress production
// needs the same focused target and cancellation/editing pipeline as keydown.
// SPEC_CLASH(keypress-input-order): §8.3.2 puts keypress after beforeinput; all three probed browsers put it before. Native producer policy remains pending.
export class KeyboardEventImpl extends UIEventImpl {
  /** Effective key value supplied by the constructor or input producer. */
  key: string;
  /** Physical-key identifier, independent of the effective key's text. */
  code: string;
  /** Logical key location; author input undergoes unsigned-long conversion without remapping. */
  location: number;
  /** Whether this notification repeats a key held down by the input source. */
  repeat: boolean;
  /** Whether this notification belongs to a composition session. */
  isComposing: boolean;
  /** Legacy numeric codes supplied explicitly, without deriving them from key or code. */
  charCode: number;
  keyCode: number;
  /** Captured state shared by the convenience getters and modifier queries. */
  #modifiers: EventModifierState;

  constructor(type: string, eventInitDict: KeyboardEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.key = eventInitDict.key ?? '';
    this.code = eventInitDict.code ?? '';
    this.location = eventInitDict.location ?? 0;
    this.repeat = eventInitDict.repeat ?? false;
    this.isComposing = eventInitDict.isComposing ?? false;
    this.charCode = eventInitDict.charCode ?? 0;
    this.keyCode = eventInitDict.keyCode ?? 0;
    this.#modifiers = new EventModifierState(eventInitDict);
  }

  /** Create a trusted key notification using the target's realm and the producer's captured input. */
  // https://w3c.github.io/uievents/#event-type-keydown
  // https://w3c.github.io/uievents/#event-type-keyup
  // DOM allocation and UI Events attributes are combined here. Key selection is
  // performed by the producer; constructor strings never enter that algorithm.
  static create(type: KeyboardEventType, target: NodeImpl, key: string, input: KeyboardEventInput): KeyboardEventImpl {
    const event = target.createTrustedEvent(KeyboardEventImpl);
    event.initializeUIEvent(type, target, true, true);
    event.composed = true;
    event.isTrusted = true;
    event.key = key;
    event.code = input.code;
    event.location = input.location;
    event.repeat = input.repeat;
    event.isComposing = input.isComposing;
    event.keyCode = input.keyCode;
    event.charCode = 0;
    event.#modifiers = input.modifiers;
    return event;
  }

  get ctrlKey(): boolean { return this.#modifiers.getModifierState('Control'); }
  get shiftKey(): boolean { return this.#modifiers.getModifierState('Shift'); }
  get altKey(): boolean { return this.#modifiers.getModifierState('Alt'); }
  get metaKey(): boolean { return this.#modifiers.getModifierState('Meta'); }

  // SPEC_CLASH(keyboard-event-which): Derive which from keyCode as Chromium does; Firefox/WebKit use an independent constructor input.
  override get which(): number { return this.keyCode; }

  // https://w3c.github.io/uievents/#dom-keyboardevent-getmodifierstate
  getModifierState(keyArg: string): boolean {
    return this.#modifiers.getModifierState(keyArg);
  }

  /** @deprecated Reinitialize the legacy fields unless this event is being dispatched. */
  // https://w3c.github.io/uievents/#dom-keyboardevent-initkeyboardevent
  initKeyboardEvent(
    type: string, bubbles = false, cancelable = false, view: WindowImpl | null = null,
    key = '', location = 0, ctrlKey = false, altKey = false, shiftKey = false, metaKey = false,
  ): void {
    if (this.dispatching) return;

    // SPEC_CLASH(keyboard-event-legacy-init): Use the draft's key argument and preserve unaddressed fields; browsers retain/reset different keyboard payloads.
    // All three browsers initialize detail to zero and replace the modifier snapshot.
    this.initUIEvent(type, bubbles, cancelable, view, 0);
    this.key = key;
    this.location = location;
    this.#modifiers = new EventModifierState({ ctrlKey, altKey, shiftKey, metaKey });
  }
}

/** Native press/release notifications; deprecated keypress has a separate text/IME contract. */
export type KeyboardEventType = 'keydown' | 'keyup';

/** Normalized native attributes supplied alongside the producer's selected key value. */
export interface KeyboardEventInput {
  code: string;
  location: number;
  repeat: boolean;
  isComposing: boolean;
  /** Native legacy code, including zero when unavailable; never inferred from character text. */
  keyCode: number;
  /** Complete held/toggled modifier state after this transition. */
  modifiers: EventModifierState;
}

/** Converted constructor data; key/code mapping belongs to the input producer. */
export interface KeyboardEventInit extends EventModifierInit {
  key?: string;
  code?: string;
  location?: number;
  repeat?: boolean;
  isComposing?: boolean;
  charCode?: number;
  keyCode?: number;
}

/*
 * [Exposed=Window]
 * interface KeyboardEvent : UIEvent {
 *   constructor(DOMString type, optional KeyboardEventInit eventInitDict = {});
 *   const unsigned long DOM_KEY_LOCATION_STANDARD = 0x00;
 *   const unsigned long DOM_KEY_LOCATION_LEFT = 0x01;
 *   const unsigned long DOM_KEY_LOCATION_RIGHT = 0x02;
 *   const unsigned long DOM_KEY_LOCATION_NUMPAD = 0x03;
 *   readonly attribute DOMString key;
 *   readonly attribute DOMString code;
 *   readonly attribute unsigned long location;
 *   readonly attribute boolean ctrlKey;
 *   readonly attribute boolean shiftKey;
 *   readonly attribute boolean altKey;
 *   readonly attribute boolean metaKey;
 *   readonly attribute boolean repeat;
 *   readonly attribute boolean isComposing;
 *   boolean getModifierState(DOMString keyArg);
 * };
 */
export const keyboardEventIDL = defineInterface<DOMEnvironment>({
  name: 'KeyboardEvent',
  inherits: 'UIEvent',
  exposed: 'Window',
  implementation: impl(KeyboardEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('KeyboardEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    constant('DOM_KEY_LOCATION_STANDARD', idlType.unsignedLong, integer(0)),
    constant('DOM_KEY_LOCATION_LEFT', idlType.unsignedLong, integer(1)),
    constant('DOM_KEY_LOCATION_RIGHT', idlType.unsignedLong, integer(2)),
    constant('DOM_KEY_LOCATION_NUMPAD', idlType.unsignedLong, integer(3)),
    roAttr('key', idlType.DOMString),
    roAttr('code', idlType.DOMString),
    roAttr('location', idlType.unsignedLong),
    roAttr('ctrlKey', idlType.boolean),
    roAttr('shiftKey', idlType.boolean),
    roAttr('altKey', idlType.boolean),
    roAttr('metaKey', idlType.boolean),
    roAttr('repeat', idlType.boolean),
    roAttr('isComposing', idlType.boolean),
    op('getModifierState', idlType.boolean, [arg('keyArg', idlType.DOMString)]),
  ],
});

/*
 * dictionary KeyboardEventInit : EventModifierInit {
 *   DOMString key = "";
 *   DOMString code = "";
 *   unsigned long location = 0;
 *   boolean repeat = false;
 *   boolean isComposing = false;
 * };
 */
export const keyboardEventInitIDL = defineDictionary({
  name: 'KeyboardEventInit',
  inherits: 'EventModifierInit',
  members: [
    dictMember('key', idlType.DOMString, { default: '' }),
    dictMember('code', idlType.DOMString, { default: '' }),
    dictMember('location', idlType.unsignedLong, { default: integer(0) }),
    dictMember('repeat', idlType.boolean, { default: false }),
    dictMember('isComposing', idlType.boolean, { default: false }),
  ],
});

/*
 * partial interface KeyboardEvent {
 *   undefined initKeyboardEvent(DOMString typeArg, optional boolean bubblesArg = false,
 *     optional boolean cancelableArg = false, optional Window? viewArg = null,
 *     optional DOMString keyArg = "", optional unsigned long locationArg = 0,
 *     optional boolean ctrlKey = false, optional boolean altKey = false,
 *     optional boolean shiftKey = false, optional boolean metaKey = false);
 * };
 */
export const keyboardEventInitializersIDL = definePartialInterface({
  name: 'KeyboardEvent',
  members: [
    op('initKeyboardEvent', idlType.undefined, [
      arg('typeArg', idlType.DOMString),
      arg('bubblesArg', idlType.boolean, { default: false, optional: true }),
      arg('cancelableArg', idlType.boolean, { default: false, optional: true }),
      arg('viewArg', nullable(reference('Window')), { default: null, optional: true }),
      arg('keyArg', idlType.DOMString, { default: '', optional: true }),
      arg('locationArg', idlType.unsignedLong, { default: integer(0), optional: true }),
      arg('ctrlKey', idlType.boolean, { default: false, optional: true }),
      arg('altKey', idlType.boolean, { default: false, optional: true }),
      arg('shiftKey', idlType.boolean, { default: false, optional: true }),
      arg('metaKey', idlType.boolean, { default: false, optional: true }),
    ]),
  ],
});

/*
 * partial interface KeyboardEvent {
 *   readonly attribute unsigned long charCode;
 *   readonly attribute unsigned long keyCode;
 * };
 */
export const keyboardEventLegacyAttributesIDL = definePartialInterface({
  name: 'KeyboardEvent',
  members: [roAttr('charCode', idlType.unsignedLong), roAttr('keyCode', idlType.unsignedLong)],
});

/*
 * partial dictionary KeyboardEventInit {
 *   unsigned long charCode = 0;
 *   unsigned long keyCode = 0;
 * };
 */
export const keyboardEventLegacyInitIDL = definePartialDictionary({
  name: 'KeyboardEventInit',
  members: [
    dictMember('charCode', idlType.unsignedLong, { default: integer(0) }),
    dictMember('keyCode', idlType.unsignedLong, { default: integer(0) }),
  ],
});
