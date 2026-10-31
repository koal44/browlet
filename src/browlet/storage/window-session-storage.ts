import { defineInterfaceMixin, DOMExceptionImpl, DOMExceptionNames, reference, roAttr } from '../../web-idl/core/index';
import { StorageBottle } from '../../storage/index';

import type { WindowImpl } from '../browsing/window/index';

import { StorageImpl } from './storage';

/** Acquires session storage for the including Window's associated Document. */
// https://html.spec.whatwg.org/multipage/webstorage.html#the-sessionstorage-attribute
export class WindowSessionStorageMixin {
  /** Window whose current Document and relevant settings select the storage map. */
  #window: WindowImpl;

  constructor(window: WindowImpl) {
    this.#window = window;
  }

  /** Acquire session storage once per Document through its current traversable. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-sessionstorage
  get sessionStorage(): StorageImpl {
    const window = this.#window;
    const document = window.getAssociatedDocument();
    if (document.sessionStorageHolder !== null) return document.sessionStorageHolder;
    const map = StorageBottle.obtainSessionMap(window.env, 'sessionStorage');
    if (map === null) throw new DOMExceptionImpl('', DOMExceptionNames.security);
    const storage = new StorageImpl(map, 'session', window.env);
    document.sessionStorageHolder = storage;
    return storage;
  }
}

/*
 * interface mixin WindowSessionStorage {
 *   readonly attribute Storage sessionStorage;
 * };
 * Window includes WindowSessionStorage;
 */
export const windowSessionStorageIDL = defineInterfaceMixin({
  name: 'WindowSessionStorage',
  members: [roAttr('sessionStorage', reference('Storage'))],
});
