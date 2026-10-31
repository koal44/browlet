import { defineInterfaceMixin, DOMExceptionImpl, DOMExceptionNames, reference, roAttr } from '../../web-idl/core/index';
import { StorageBottle } from '../../storage/index';

import type { WindowImpl } from '../browsing/window/index';

import { StorageImpl } from './storage';

/** Acquires local storage for the including Window's associated Document. */
// https://html.spec.whatwg.org/multipage/webstorage.html#the-localstorage-attribute
export class WindowLocalStorageMixin {
  /** Window whose current Document and relevant settings select the storage map. */
  #window: WindowImpl;

  constructor(window: WindowImpl) {
    this.#window = window;
  }

  /** Acquire local storage once per Document through its relevant settings. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-localstorage
  get localStorage(): StorageImpl {
    const window = this.#window;
    const document = window.getAssociatedDocument();
    if (document.localStorageHolder !== null) return document.localStorageHolder;
    const map = StorageBottle.obtainLocalMap(window.env, 'localStorage');
    if (map === null) throw new DOMExceptionImpl('', DOMExceptionNames.security);
    const storage = new StorageImpl(map, 'local', window.env);
    document.localStorageHolder = storage;
    return storage;
  }
}

/*
 * interface mixin WindowLocalStorage {
 *   readonly attribute Storage localStorage;
 * };
 * Window includes WindowLocalStorage;
 */
export const windowLocalStorageIDL = defineInterfaceMixin({
  name: 'WindowLocalStorage',
  members: [roAttr('localStorage', reference('Storage'))],
});
