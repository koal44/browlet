import { arg, atArg, defineInterface, idlType, impl, nullable, op, reference, roAttr } from '../../../web-idl/core/index';

import type { DOMEnvironment } from '../../dom/environment';
import type { WindowImpl } from '../../browsing/window/index';

import { UIEventImpl } from './ui-event';

/** Legacy text payload, allocated by Document.createEvent() or an internal producer. */
// https://w3c.github.io/uievents/#legacy-textevent-events
// TODO(UI Events §8.4): Trusted textInput production still needs focused-target
// selection (HTML §6.6) and the editing/IME pipeline (HTML §6.8 / Input Events).
// Author initialization and dispatch must not insert text or start that pipeline.
// SPEC_CLASH(synthetic-textinput-editing): Follow Chromium/Firefox's listener-only dispatch; WebKit edits a focused input and emits trusted beforeinput/input events.
// SPEC_CLASH(textinput-beforeinput-order): Chromium/Firefox deliver beforeinput before textInput; WebKit reverses them. Native producer policy remains pending.
export class TextEventImpl extends UIEventImpl {
  data = '';

  /** @deprecated Reinitialize the legacy fields unless this event is being dispatched. */
  // https://w3c.github.io/uievents/event-algo.html#dom-textevent-inittextevent
  initTextEvent(type: string, bubbles = false, cancelable = false, view: WindowImpl | null = null, data = 'undefined'): void {
    if (this.dispatching) return;

    this.initUIEvent(type, bubbles, cancelable, view, 0);
    this.data = data;
  }
}

/*
 * [Exposed=Window]
 * interface TextEvent : UIEvent {
 *   readonly attribute DOMString data;
 *   undefined initTextEvent(DOMString type, optional boolean bubbles = false,
 *     optional boolean cancelable = false, optional Window? view = null,
 *     optional DOMString data = "undefined");
 * };
 */
export const textEventIDL = defineInterface<DOMEnvironment>({
  name: 'TextEvent', inherits: 'UIEvent', exposed: 'Window',
  implementation: impl(TextEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    roAttr('data', idlType.DOMString),
    op('initTextEvent', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('bubbles', idlType.boolean, { default: false, optional: true }),
      arg('cancelable', idlType.boolean, { default: false, optional: true }),
      arg('view', nullable(reference('Window')), { default: null, optional: true }),
      arg('data', idlType.DOMString, { default: 'undefined', optional: true }),
    ]),
  ],
});
