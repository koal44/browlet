import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary,
  idlType, impl, nullable, op, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import { EventImpl, type EventInit } from '../../dom/events/index';
import type { DOMEnvironment } from '../../dom/environment';
import type { StorageImpl } from '../storage';

/** A storage change's values, source URL, and receiving Storage object. */
// https://html.spec.whatwg.org/multipage/webstorage.html#the-storageevent-interface
export class StorageEventImpl extends EventImpl {
  /** Changed key, or null when the whole map was cleared. */
  key: string | null;
  /** Previous value, or null when no pair existed. */
  oldValue: string | null;
  /** Replacement value, or null when the pair was removed. */
  newValue: string | null;
  /** Source document URL supplied when the change was broadcast. */
  url: string;
  /** The recipient's Storage object; Binding preserves its existing identity. */
  storageArea: StorageImpl | null;

  constructor(type: string, eventInitDict: StorageEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.key = eventInitDict.key ?? null;
    this.oldValue = eventInitDict.oldValue ?? null;
    this.newValue = eventInitDict.newValue ?? null;
    this.url = eventInitDict.url ?? '';
    this.storageArea = eventInitDict.storageArea ?? null;
  }

  /** @deprecated Reinitialize an idle event, retaining its timestamp and composed flag. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-storageevent-initstorageevent
  initStorageEvent(
    type: string, bubbles = false, cancelable = false, key: string | null = null,
    oldValue: string | null = null, newValue: string | null = null, url = '',
    storageArea: StorageImpl | null = null,
  ): void {
    if (this.dispatching) return;
    this.initEvent(type, bubbles, cancelable);
    this.key = key;
    this.oldValue = oldValue;
    this.newValue = newValue;
    this.url = url;
    this.storageArea = storageArea;
  }
}

/*
 * [Exposed=Window]
 * interface StorageEvent : Event {
 *   constructor(DOMString type, optional StorageEventInit eventInitDict = {});
 *   readonly attribute DOMString? key;
 *   readonly attribute DOMString? oldValue;
 *   readonly attribute DOMString? newValue;
 *   readonly attribute USVString url;
 *   readonly attribute Storage? storageArea;
 *   undefined initStorageEvent(DOMString type, optional boolean bubbles = false,
 *     optional boolean cancelable = false, optional DOMString? key = null,
 *     optional DOMString? oldValue = null, optional DOMString? newValue = null,
 *     optional USVString url = "", optional Storage? storageArea = null);
 * };
 */
export const storageEventIDL = defineInterface<DOMEnvironment>({
  name: 'StorageEvent',
  inherits: 'Event',
  exposed: 'Window',
  implementation: impl(StorageEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('StorageEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('key', nullable(idlType.DOMString)),
    roAttr('oldValue', nullable(idlType.DOMString)),
    roAttr('newValue', nullable(idlType.DOMString)),
    roAttr('url', idlType.USVString),
    roAttr('storageArea', nullable(reference('Storage'))),
    op('initStorageEvent', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('bubbles', idlType.boolean, { default: false, optional: true }),
      arg('cancelable', idlType.boolean, { default: false, optional: true }),
      arg('key', nullable(idlType.DOMString), { default: null, optional: true }),
      arg('oldValue', nullable(idlType.DOMString), { default: null, optional: true }),
      arg('newValue', nullable(idlType.DOMString), { default: null, optional: true }),
      arg('url', idlType.USVString, { default: '', optional: true }),
      arg('storageArea', nullable(reference('Storage')), { default: null, optional: true }),
    ]),
  ],
});

/** Converted constructor data, also used by internal event creation. */
export interface StorageEventInit extends EventInit {
  key?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  url?: string;
  storageArea?: StorageImpl | null;
}

/*
 * dictionary StorageEventInit : EventInit {
 *   DOMString? key = null;
 *   DOMString? oldValue = null;
 *   DOMString? newValue = null;
 *   USVString url = "";
 *   Storage? storageArea = null;
 * };
 */
export const storageEventInitIDL = defineDictionary({
  name: 'StorageEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('key', nullable(idlType.DOMString), { default: null }),
    dictMember('oldValue', nullable(idlType.DOMString), { default: null }),
    dictMember('newValue', nullable(idlType.DOMString), { default: null }),
    dictMember('url', idlType.USVString, { default: '' }),
    dictMember('storageArea', nullable(reference('Storage')), { default: null }),
  ],
});
