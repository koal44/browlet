import {
  arg, defineInterface, idlType, impl, indexedGetter, namedGetter, nullable, op, reference,
  roAttr, xattr,
} from '../../../web-idl/index';
import { HTML_NAMESPACE } from '../../../infra/index';
import type { ElementImpl } from './element';

/** Element collection refreshed from its source before DOM collection operations. */
// https://dom.spec.whatwg.org/#interface-htmlcollection
export class HTMLCollectionImpl<T extends ElementImpl = ElementImpl> extends Array<T> {
  /** Recollect current elements for live collections; absent for fixed contents. */
  #collect: (() => Iterable<T>) | undefined;
  /** Prevent a collector from recursively rebuilding the collection. */
  #refreshing = false;

  constructor(collect?: () => Iterable<T>) {
    super();
    this.#collect = collect;
    this.refresh();
  }

  // Array operations must not pass their result length to the collector constructor.
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  // https://dom.spec.whatwg.org/#dom-htmlcollection-item
  item(index: number): T | null {
    this.refresh();
    return this[index] ?? null;
  }

  /** Unique IDs and eligible HTML names exposed as named properties, in tree order. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    this.refresh();
    for (const element of this) {
      const id = element.getAttribute('id');
      const name = element.getAttribute('name');
      if (id) names.add(id);
      if (name && isNamedByName(element, name)) names.add(name);
    }
    return names;
  }

  /** First element matching a nonempty ID or eligible HTML name. */
  // https://dom.spec.whatwg.org/#dom-htmlcollection-nameditem
  namedItem(name: string): T | null {
    if (name === '') return null;
    this.refresh();
    return this.find((element) =>
      element.getAttribute('id') === name ||
      isNamedByName(element, name)
    ) ?? null;
  }

  override [Symbol.iterator](): ArrayIterator<T> {
    this.refresh();
    return super[Symbol.iterator]();
  }

  /** Rebuild live contents without replacing the collection object. */
  refresh(): void {
    if (!this.#collect || this.#refreshing) return;

    this.#refreshing = true;
    try {
      this.length = 0;
      for (const element of this.#collect()) super.push(element);
    } finally {
      this.#refreshing = false;
    }
  }
}

/*
 * [Exposed=Window, LegacyUnenumerableNamedProperties]
 * interface HTMLCollection {
 *   readonly attribute unsigned long length;
 *   getter Element? item(unsigned long index);
 *   getter Element? namedItem(DOMString name);
 * };
 */
export const htmlCollectionIDL = defineInterface({
  name: 'HTMLCollection',
  exposed: 'Window',
  ...xattr('LegacyUnenumerableNamedProperties'),
  implementation: impl(HTMLCollectionImpl),
  members: [
    roAttr('length', idlType.unsignedLong, {
      get() {
        const collection = this as HTMLCollectionImpl;
        collection.refresh();
        return collection.length;
      },
    }),
    op('item', nullable(reference('Element')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter(
        (collection: HTMLCollectionImpl) => {
          collection.refresh();
          return collection.keys();
        },
        { unsupportedValue: null },
      ),
    ),
    op('namedItem', nullable(reference('Element')),
      [arg('name', idlType.DOMString)],
      namedGetter(
        (collection: HTMLCollectionImpl) => collection.getSupportedPropertyNames(),
      ),
    ),
  ],
});

function isNamedByName(element: ElementImpl, name: string): boolean {
  return element.namespaceURI === HTML_NAMESPACE &&
    element.getAttribute('name') === name;
}
