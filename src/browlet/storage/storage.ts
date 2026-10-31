import { QuotaExceededErrorImpl, arg, defineInterface, idlType, impl, nullable, op, roAttr } from '../../web-idl/core/index';
import { areSameOrigin, serializeURL } from '../../url/index';
import { WebStorageEndpoint, type StorageProxyMap, type StorageType } from '../../storage/index';

import { domManipulationTaskSource } from '../scripting/index';
import { StorageEventImpl } from './events/index';
import type { WindowEnvironment } from '../environment';

/** A Window-owned view of an existing local or session storage map. */
// https://html.spec.whatwg.org/multipage/webstorage.html#the-storage-interface
export class StorageImpl {
  /** The acquired proxy map; reads follow its current backing map. */
  map: StorageProxyMap<string, string>;
  /** Local or session lifetime, selected when the object is created. */
  type: StorageType;
  /** Relevant Window settings, independent of which realm's method is invoked. */
  env: WindowEnvironment;

  constructor(map: StorageProxyMap<string, string>, type: StorageType, env: WindowEnvironment) {
    this.map = map;
    this.type = type;
    this.env = env;
    env.userAgent.storageObjects.add(new WeakRef(this));
  }

  /** Number of current key/value pairs. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-length
  get length(): number {
    return this.map.size;
  }

  /** Return the key at this position in the map, or null outside its current entries. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-key
  key(index: number): string | null {
    if (index >= this.map.size) return null;
    return [...this.map.keys()][index]!;
  }

  /** Read the exact stored string, distinguishing absent keys from empty values. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-getitem
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  /** Store converted strings atomically, then notify other matching Storage objects. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-setitem
  setItem(key: string, value: string): void {
    const oldValue = this.map.get(key) ?? null;
    if (oldValue === value) return;
    const growth = WebStorageEndpoint.entrySize(key, value)
      - (oldValue === null ? 0 : WebStorageEndpoint.entrySize(key, oldValue));

    // Like Chromium, allow non-growing changes even if the quota was lowered below current usage.
    if (growth > 0) {
      const { bottle, shelf } = this.map;
      if ((bottle.quota !== null && bottle.usage + growth > bottle.quota) ||
        shelf.usage + growth > this.env.userAgent.storageQuotaBytes) {
        throw new QuotaExceededErrorImpl('The storage quota has been exceeded.');
      }
    }

    this.map.set(key, value);
    // Reordering is implementation-defined; Map retains existing positions and appends new keys.
    this.#broadcast(key, oldValue, value);
  }

  /** Remove an existing pair and queue its change for other matching Storage objects. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-removeitem
  removeItem(key: string): void {
    if (!this.map.has(key)) return;
    const oldValue = this.map.get(key)!;
    this.map.delete(key);
    // Reordering is implementation-defined; preserve the remaining Map insertion order.
    this.#broadcast(key, oldValue, null);
  }

  /** Clear a nonempty map and queue a single change with null key and values. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-clear
  clear(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.#broadcast(null, null, null);
  }

  /** Current map keys in their existing order; Binding applies named-property visibility. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#the-storage-interface
  getSupportedPropertyNames(): Set<string> {
    return new Set(this.map.keys());
  }

  /** Snapshot the source URL and queue recipient-owned events through HTML's task machinery. */
  // https://html.spec.whatwg.org/multipage/webstorage.html#concept-Storage-broadcast
  #broadcast(key: string | null, oldValue: string | null, newValue: string | null): void {
    const document = this.env.window.getAssociatedDocument();
    const url = serializeURL(document.url);
    const isSession = this.type === 'session';
    const traversable = isSession ? document.getNodeNavigable()?.traversable : null;

    for (const remoteStorage of this.env.userAgent.storageObjects.values()) {
      if (remoteStorage === this || remoteStorage.type !== this.type) continue;
      if (!areSameOrigin(remoteStorage.env.origin, this.env.origin)) continue;
      if (isSession) {
        const remoteDocument = remoteStorage.env.window.getAssociatedDocument();
        if (traversable === undefined || remoteDocument.getNodeNavigable()?.traversable !== traversable) continue;
      }
      remoteStorage.env.realm.queueGlobalTask(domManipulationTaskSource, () => {
        remoteStorage.env.window.fireEvent('storage', StorageEventImpl, (event) => {
          const storageEvent = event as StorageEventImpl;
          storageEvent.key = key;
          storageEvent.oldValue = oldValue;
          storageEvent.newValue = newValue;
          storageEvent.url = url;
          storageEvent.storageArea = remoteStorage;
        });
      });
    }
  }
}

/*
 * [Exposed=Window]
 * interface Storage {
 *   readonly attribute unsigned long length;
 *   DOMString? key(unsigned long index);
 *   getter DOMString? getItem(DOMString key);
 *   setter undefined setItem(DOMString key, DOMString value);
 *   deleter undefined removeItem(DOMString key);
 *   undefined clear();
 * };
 */
export const storageIDL = defineInterface({
  name: 'Storage',
  exposed: 'Window',
  implementation: impl(StorageImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    op('key', nullable(idlType.DOMString), [arg('index', idlType.unsignedLong)]),
    { kind: 'named-getter', name: 'getItem', method: 'getItem', argumentName: 'key', returns: nullable(idlType.DOMString) },
    op('setItem', idlType.undefined,
      [arg('key', idlType.DOMString), arg('value', idlType.DOMString)],
      { special: 'setter' },
    ),
    op('removeItem', idlType.undefined, [arg('key', idlType.DOMString)], { special: 'deleter' }),
    op('clear', idlType.undefined),
  ],
});
