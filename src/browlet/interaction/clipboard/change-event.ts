import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary,
  emptySequence, frozenArray, idlType, impl, integer, reference, roAttr, sequence,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import { EventImpl, type EventInit } from '../../dom/events/index';
import type { DOMEnvironment } from '../../dom/environment';

/** Clipboard change data; construction copies supplied values without observing the system clipboard. */
// https://w3c.github.io/clipboard-apis/#h-clipboardchange-event-steps
// TODO(Clipboard §5.2.1 / fire a clipboardchange event, Document focus steps, generate a changeId):
// The native producer still needs mandatory formats, a changing system identifier,
// storage-key hashing, activation/permission gating, and pending focus replay.
// Document.hasFocus() is an existing throwing dependency; this data object does
// not choose the notification target or supply native clipboard access.
export class ClipboardChangeEventImpl extends EventImpl {
  /** Immutable snapshot by list identity; Binding owns its realm's frozen array. */
  types: readonly string[];
  /** Author input is a bigint; only the native producer derives a 128-bit identifier. */
  changeId: bigint;

  constructor(type: string, eventInitDict: ClipboardChangeEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    // SPEC_CLASH(clipboard-change-types-identity): Retain the FrozenArray value's identity; Chromium returns a fresh array per access.
    this.types = eventInitDict.types?.slice() ?? [];
    this.changeId = eventInitDict.changeId ?? 0n;
  }
}

/** Converted event input; native format filtering and identifier generation belong to the producer. */
export interface ClipboardChangeEventInit extends EventInit {
  types?: string[];
  changeId?: bigint;
}

/*
 * dictionary ClipboardChangeEventInit : EventInit {
 *   sequence<DOMString> types = [];
 *   bigint changeId = 0;
 * };
 */
export const clipboardChangeEventInitIDL = defineDictionary({
  name: 'ClipboardChangeEventInit', inherits: 'EventInit',
  members: [
    dictMember('types', sequence(idlType.DOMString), { default: emptySequence }),
    dictMember('changeId', idlType.bigint, { default: integer(0) }),
  ],
});

/*
 * [Exposed=Window]
 * interface ClipboardChangeEvent : Event {
 *   constructor(DOMString type, optional ClipboardChangeEventInit eventInitDict = {});
 *   readonly attribute FrozenArray<DOMString> types;
 *   readonly attribute bigint changeId;
 * };
 */
// SPEC_CLASH(clipboard-change-constructor): Follow the draft's type/init signature; Chromium accepts only init and fixes the event type.
// SPEC_CLASH(clipboard-change-exposure): Follow the draft's Window exposure; Chromium requires a secure context, Firefox/WebKit do not expose the interface yet.
export const clipboardChangeEventIDL = defineInterface<DOMEnvironment>({
  name: 'ClipboardChangeEvent', inherits: 'Event', exposed: 'Window',
  implementation: impl(ClipboardChangeEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('ClipboardChangeEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('types', frozenArray(idlType.DOMString)),
    roAttr('changeId', idlType.bigint),
  ],
});
