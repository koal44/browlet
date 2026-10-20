import {
  arg, defineInterface, idlType, impl, indexedGetter, nullable, op,
  reference, roAttr, union, xattr,
} from '../../../web-idl/core/index';

import { HTMLCollectionImpl } from './collections';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { HTMLElementImpl } from './html/index';

/** Live view of every descendant element of a document, including legacy named lookup. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#the-htmlallcollection-interface
export class HTMLAllCollectionImpl {
  #document: DocumentImpl;
  #elements: HTMLCollectionImpl;

  constructor(document: DocumentImpl) {
    this.#document = document;
    this.#elements = new HTMLCollectionImpl(document, () => true);
  }

  get length(): number { return this.#elements.length; }

  /** Current supported numeric properties, independent of implementation storage. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#elements.getSupportedPropertyIndices();
  }

  /** Nonempty IDs and eligible HTML names, in tree order with IDs first. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (const element of this.#elements) {
      const id = element.getAttributeNS(null, 'id');
      if (id) names.add(id);
      if (element instanceof HTMLElementImpl && element.isAllNamedElement) {
        const name = element.getAttributeNS(null, 'name');
        if (name) names.add(name);
      }
    }
    return names;
  }

  /** Return the indexed element, or null outside the live collection. */
  // https://html.spec.whatwg.org/#concept-get-all-indexed
  getIndexedElement(index: number): ElementImpl | null {
    return this.#elements.item(index);
  }

  /** Return one matching element, a live collection of multiple matches, or null. */
  // https://html.spec.whatwg.org/#concept-get-all-named
  namedItem(name: string): HTMLCollectionImpl | ElementImpl | null {
    if (name === '') return null;
    const matches = new HTMLCollectionImpl(this.#document, (element) =>
      element.getAttributeNS(null, 'id') === name ||
      (element instanceof HTMLElementImpl && element.isAllNamedElement && element.getAttributeNS(null, 'name') === name));
    const length = matches.length;
    return length === 0 ? null : length === 1 ? matches.item(0) : matches;
  }

  /** Interpret canonical array-index spellings numerically and all other strings as names. */
  // https://html.spec.whatwg.org/#dom-HTMLAllCollection-item
  // https://html.spec.whatwg.org/#concept-get-all-indexed-or-named
  item(nameOrIndex?: string): HTMLCollectionImpl | ElementImpl | null {
    if (nameOrIndex === undefined) return null;
    const index = Number(nameOrIndex) >>> 0;
    return index !== 0xFFFFFFFF && String(index) === nameOrIndex
      ? this.getIndexedElement(index) : this.namedItem(nameOrIndex);
  }
}

/*
 * [Exposed=Window, LegacyUnenumerableNamedProperties]
 * interface HTMLAllCollection {
 *   readonly attribute unsigned long length;
 *   getter Element (unsigned long index);
 *   getter (HTMLCollection or Element)? namedItem(DOMString name);
 *   (HTMLCollection or Element)? item(optional DOMString nameOrIndex);
 * };
 */
export const htmlAllCollectionIDL = defineInterface({
  name: 'HTMLAllCollection',
  exposed: 'Window',
  ...xattr('LegacyUnenumerableNamedProperties'),
  documentAll: true,
  implementation: impl(HTMLAllCollectionImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    op(undefined, reference('Element'),
      [arg('index', idlType.unsignedLong)],
      {
        ...indexedGetter((collection: HTMLAllCollectionImpl) => collection.getSupportedPropertyIndices(),
          { unsupportedValue: null }),
        invoke(_env, index) {
          return (this as HTMLAllCollectionImpl).getIndexedElement(index);
        },
      },
    ),
    {
      kind: 'named-getter', name: 'namedItem', method: 'namedItem',
      returns: nullable(union(reference('HTMLCollection'), reference('Element'))),
    },
    op('item', nullable(union(reference('HTMLCollection'), reference('Element'))),
      [arg('nameOrIndex', idlType.DOMString, { optional: true })],
    ),
  ],
});
