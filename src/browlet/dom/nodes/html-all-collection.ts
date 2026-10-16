import { HTML_NAMESPACE } from '../../../infra/index';
import {
  arg, defineInterface, idlType, impl, indexedGetter, namedGetter, nullable, op,
  reference, roAttr, union, xattr,
} from '../../../web-idl/index';

import { HTMLCollectionImpl } from './collections';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';

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
      if (isAllNamedElement(element)) {
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
      (isAllNamedElement(element) && element.getAttributeNS(null, 'name') === name));
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
  implementation: impl(HTMLAllCollectionImpl, {
    createHTMLAllCollection(context, collection) {
      // https://html.spec.whatwg.org/#HTMLAllCollection-call
      // [[Call]] ignores thisArgument and every argument after the first.
      return context.realm.createHTMLDDA((value: unknown) => {
        if (value === undefined) return null;
        const name = context.jsToImpl(value, idlType.DOMString);
        return context.implToJS(collection.item(name), allItemType);
      });
    },
  }),
  members: [
    roAttr('length', idlType.unsignedLong),
    op(undefined, reference('Element'),
      [arg('index', idlType.unsignedLong)],
      {
        ...indexedGetter((collection: HTMLAllCollectionImpl) => collection.getSupportedPropertyIndices(),
          { unsupportedValue: null }),
        invoke(_context, index) {
          return (this as HTMLAllCollectionImpl).getIndexedElement(index);
        },
      },
    ),
    op('namedItem', nullable(union(reference('HTMLCollection'), reference('Element'))),
      [arg('name', idlType.DOMString)],
      namedGetter((collection: HTMLAllCollectionImpl) => collection.getSupportedPropertyNames()),
    ),
    op('item', nullable(union(reference('HTMLCollection'), reference('Element'))),
      [arg('nameOrIndex', idlType.DOMString, { optional: true })],
    ),
  ],
});

const allItemType = nullable(union(reference('HTMLCollection'), reference('Element')));

// https://html.spec.whatwg.org/#all-named-elements
const allNamedElements = new Set([
  'a', 'button', 'embed', 'form', 'frame', 'frameset', 'iframe', 'img', 'input',
  'map', 'meta', 'object', 'select', 'textarea',
]);

function isAllNamedElement(element: ElementImpl): boolean {
  return element.namespaceURI === HTML_NAMESPACE && allNamedElements.has(element.localName);
}
