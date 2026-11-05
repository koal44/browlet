import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary,
  idlType, impl, nullable, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import type { DOMEnvironment } from '../../dom/environment';

import { UIEventImpl, type UIEventInit } from './ui-event';

/** Input notification data, independent of the editing operation that produces it. */
// https://w3c.github.io/uievents/#interface-inputevent
// TODO(HTML §6.8, Input Events §6): Editing must select the host, data, inputType, and composition
// state, dispatch cancelable beforeinput where required, apply the edit, then dispatch input.
// Synthetic construction/dispatch does not run those steps or start a composition session.
// TODO(Input Events §6.1): Add the separate dataTransfer/targetRanges partials when integrating
// that specification. HTML's DataTransfer data API now exists in drag-drop;
// editing-owned target ranges and the Input Events declaration contributions remain unfinished.
export class InputEventImpl extends UIEventImpl {
  /** Text supplied after Web IDL conversion; null and the empty string remain distinct. */
  data: string | null;
  /** Whether the producer or constructor marks this notification as part of a composition. */
  isComposing: boolean;
  /** Input operation name, without restricting author-created events to known editing operations. */
  inputType: string;

  constructor(type: string, eventInitDict: InputEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.data = eventInitDict.data ?? null;
    this.isComposing = eventInitDict.isComposing ?? false;
    // SPEC_CLASH(input-event-input-type): Preserve DOMString input as Firefox/WebKit do; Chromium filters unrecognized names to empty.
    this.inputType = eventInitDict.inputType ?? '';
  }
}

/** Converted UI Events constructor data; Input Events' extension is a separate partial. */
export interface InputEventInit extends UIEventInit {
  data?: string | null;
  isComposing?: boolean;
  inputType?: string;
}

/*
 * [Exposed=Window]
 * interface InputEvent : UIEvent {
 *   constructor(DOMString type, optional InputEventInit eventInitDict = {});
 *   readonly attribute USVString? data;
 *   readonly attribute boolean isComposing;
 *   readonly attribute DOMString inputType;
 * };
 */
export const inputEventIDL = defineInterface<DOMEnvironment>({
  name: 'InputEvent',
  inherits: 'UIEvent',
  exposed: 'Window',
  implementation: impl(InputEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('InputEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    // SPEC_CLASH(input-event-data-string): Match the DOMString constructor input and all three browsers' UTF-16 preservation, despite the USVString attribute above.
    roAttr('data', nullable(idlType.DOMString)),
    roAttr('isComposing', idlType.boolean),
    roAttr('inputType', idlType.DOMString),
  ],
});

/*
 * dictionary InputEventInit : UIEventInit {
 *   DOMString? data = null;
 *   boolean isComposing = false;
 *   DOMString inputType = "";
 * };
 */
export const inputEventInitIDL = defineDictionary({
  name: 'InputEventInit',
  inherits: 'UIEventInit',
  members: [
    dictMember('data', nullable(idlType.DOMString), { default: null }),
    dictMember('isComposing', idlType.boolean, { default: false }),
    dictMember('inputType', idlType.DOMString, { default: '' }),
  ],
});
