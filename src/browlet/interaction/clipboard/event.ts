import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary,
  idlType, impl, nullable, reference, roAttr,
} from '../../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../../timing/index';

import { EventImpl, type EventInit } from '../../dom/events/index';
import type { DataTransferImpl } from '../drag-drop/index';
import type { DOMEnvironment } from '../../dom/environment';

/** Clipboard event data; synthetic construction and dispatch do not access the system clipboard. */
// https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
// SystemClipboard.fireEvent owns trusted delivery and its temporary DataTransfer.
// SystemClipboard.runAction owns admission and copy/cut/paste action branching.
// TODO(Clipboard integration): connect keyboard/menu/script command callers and
// the explicit native/rendering/editing dependencies; synthetic DOM dispatch must
// never invoke these effects.
export class ClipboardEventImpl extends EventImpl {
  /** The supplied transfer keeps its identity, mutability, and relevant realm. */
  clipboardData: DataTransferImpl | null;

  constructor(type: string, eventInitDict: ClipboardEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    // SPEC_CLASH(clipboard-event-data): Follow the draft/Chromium/WebKit; Firefox ignores clipboardData and creates its own transfer from legacy data/dataType options.
    this.clipboardData = eventInitDict.clipboardData ?? null;
  }
}

/** Converted constructor input; a synthetic event does not create or clone a data store. */
export interface ClipboardEventInit extends EventInit {
  clipboardData?: DataTransferImpl | null;
}

/*
 * dictionary ClipboardEventInit : EventInit {
 *   DataTransfer? clipboardData = null;
 * };
 */
export const clipboardEventInitIDL = defineDictionary({
  name: 'ClipboardEventInit', inherits: 'EventInit',
  members: [dictMember('clipboardData', nullable(reference('DataTransfer')), { default: null })],
});

/*
 * [Exposed=Window]
 * interface ClipboardEvent : Event {
 *   constructor(DOMString type, optional ClipboardEventInit eventInitDict = {});
 *   readonly attribute DataTransfer? clipboardData;
 * };
 */
export const clipboardEventIDL = defineInterface<DOMEnvironment>({
  name: 'ClipboardEvent', inherits: 'Event', exposed: 'Window',
  implementation: impl(ClipboardEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('ClipboardEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('clipboardData', nullable(reference('DataTransfer'))),
  ],
});
