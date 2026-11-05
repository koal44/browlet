import {
  arg, atArg, ctor, defineDictionary, defineInterface, definePartialInterface, dictMember,
  emptyDictionary, idlType, impl, integer, nullable, op, reference, roAttr,
} from '../../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../../timing/index';

import { EventImpl, type EventInit } from '../../dom/events/index';
import type { NodeImpl } from '../../dom/nodes/index';
import type { DOMEnvironment } from '../../dom/environment';
import type { WindowImpl } from '../../browsing/window/index';

/** Context shared by user-interface events, independent of their input producers. */
// https://w3c.github.io/uievents/#interface-uievent
export class UIEventImpl extends EventImpl {
  /** Window selected by the constructor or producer, independently of the event's realm. */
  // SPEC_CLASH(ui-event-retired-view): Retain Window identity; projection returns null after replacement, matching Chromium rather than Firefox/WebKit.
  view: WindowImpl | null;
  /** Event-specific numeric detail after Web IDL long conversion. */
  detail: number;

  constructor(type: string, eventInitDict: UIEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.view = eventInitDict.view ?? null;
    this.detail = eventInitDict.detail ?? 0;
  }

  /** @deprecated Plain UIEvents have no key or button code; derived interfaces supply theirs. */
  // SPEC_CLASH(ui-event-which-init): All three browsers return zero and ignore UIEventInit.which, unlike the draft's informative dictionary extension.
  get which(): number {
    return 0;
  }

  /** Initialize a producer's event; DOM initialization clears trust, which trusted producers must then establish. */
  // https://w3c.github.io/uievents/#initialize-a-uievent
  initializeUIEvent(type: string, target: NodeImpl | WindowImpl, bubbles: boolean, cancelable: boolean): void {
    this.initializeEvent(type, bubbles, cancelable);
    this.target = target;
    // The algorithm requires a node document. Window targets already supply its view.
    this.view = target.isWindow() ? target : target.nodeDocument.getRelevantGlobalObject();
    this.detail = 0;
  }

  /** @deprecated Reinitialize an idle event and its view/detail without changing its timestamp. */
  // https://w3c.github.io/uievents/#dom-uievent-inituievent
  initUIEvent(type: string, bubbles = false, cancelable = false, view: WindowImpl | null = null, detail = 0): void {
    if (this.dispatching) return;

    // SPEC_CLASH(ui-event-legacy-reset): Follow DOM: clear target and retain composed; Chromium retains target, while Firefox clears composed.
    this.initEvent(type, bubbles, cancelable);
    this.view = view;
    this.detail = detail;
  }
}

/** Converted constructor data, also used by DOM's legacy event factory. */
export interface UIEventInit extends EventInit {
  view?: WindowImpl | null;
  detail?: number;
}

/*
 * [Exposed=Window]
 * interface UIEvent : Event {
 *   constructor(DOMString type, optional UIEventInit eventInitDict = {});
 *   readonly attribute Window? view;
 *   readonly attribute long detail;
 * };
 */
export const uiEventIDL = defineInterface<DOMEnvironment>({
  name: 'UIEvent',
  inherits: 'Event',
  exposed: 'Window',
  implementation: impl(UIEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('UIEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('view', nullable(reference('Window'))),
    roAttr('detail', idlType.long),
  ],
});

/*
 * dictionary UIEventInit : EventInit {
 *   Window? view = null;
 *   long detail = 0;
 * };
 */
export const uiEventInitIDL = defineDictionary({
  name: 'UIEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('view', nullable(reference('Window')), { default: null }),
    dictMember('detail', idlType.long, { default: integer(0) }),
  ],
});

/*
 * partial interface UIEvent {
 *   undefined initUIEvent(DOMString typeArg, optional boolean bubblesArg = false,
 *     optional boolean cancelableArg = false, optional Window? viewArg = null,
 *     optional long detailArg = 0);
 * };
 */
export const uiEventInitializersIDL = definePartialInterface({
  name: 'UIEvent',
  members: [
    op('initUIEvent', idlType.undefined, [
      arg('typeArg', idlType.DOMString),
      arg('bubblesArg', idlType.boolean, { default: false, optional: true }),
      arg('cancelableArg', idlType.boolean, { default: false, optional: true }),
      arg('viewArg', nullable(reference('Window')), { default: null, optional: true }),
      arg('detailArg', idlType.long, { default: integer(0), optional: true }),
    ]),
  ],
});

/*
 * partial interface UIEvent {
 *   readonly attribute unsigned long which;
 * };
 */
export const uiEventLegacyAttributesIDL = definePartialInterface({
  name: 'UIEvent',
  members: [roAttr('which', idlType.unsignedLong)],
});
