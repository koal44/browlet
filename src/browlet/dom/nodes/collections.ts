import {
  arg, defineInterface, idlType, indexedGetter, namedGetter, nullable, op,
  roAttr, reference, xattr,
} from '../../../web-idl/declaration/index';
import { bind, impl } from '../../../web-idl/index';
import { HTML_NAMESPACE } from '../../../shared/namespaces';
import type { ElementImpl } from './element';

export class HTMLCollectionImpl<T extends ElementImpl = ElementImpl>
  extends Array<T>
  implements HTMLCollectionOf<T>
{
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  readonly #collect: (() => Iterable<T>) | undefined;
  #refreshing = false;

  constructor(collect?: () => Iterable<T>) {
    super();
    this.#collect = collect;
    this.refresh();
  }

  item(index: number): T | null {
    this.refresh();
    return this[index] ?? null;
  }

  getSupportedPropertyIndices(): ReadonlySet<number> {
    this.refresh();
    return new Set(this.keys());
  }

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

// -- Web IDL ------------------------------------------------------------

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
    roAttr('length', idlType.unsignedLong, bind({
      get() {
        const collection = this as HTMLCollectionImpl;
        collection.refresh();
        return collection.length;
      },
    })),
    op('item', nullable(reference('Element')), [
      arg('index', idlType.unsignedLong),
    ], indexedGetter(
      (collection: HTMLCollectionImpl) =>
        collection.getSupportedPropertyIndices(),
    )),
    op('namedItem', nullable(reference('Element')), [
      arg('name', idlType.DOMString),
    ], namedGetter(
      (collection: HTMLCollectionImpl) =>
        collection.getSupportedPropertyNames(),
    )),
  ],
});

function isNamedByName(element: ElementImpl, name: string): boolean {
  return element.namespaceURI === HTML_NAMESPACE &&
    element.getAttribute('name') === name;
}
