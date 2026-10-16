import { HTML_NAMESPACE } from '../../../infra/index';
import {
  arg, defineInterface, idlType, impl, indexedGetter, iter, namedGetter, nullable, op,
  reference, roAttr, xattr,
} from '../../../web-idl/index';

import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { NodeImpl } from './node';

/** Shared storage for snapshots and lazily refreshed live collections. */
abstract class NodeCollection<T extends NodeImpl> implements Iterable<T> {
  /** Numeric properties belong to the platform object; implementations use item(). */
  [index: number]: undefined;

  #source: LiveCollectionSource<T> | null;
  #items: T[];
  #document: DocumentImpl | null = null;
  #version = -1;

  constructor(source: T[] | LiveCollectionSource<T>) {
    this.#source = Array.isArray(source) ? null : source;
    this.#items = Array.isArray(source) ? source : [];
  }

  /** Number of nodes currently represented by the collection. */
  get length(): number {
    return this.items.length;
  }

  /** Current contents; one document revision covers both tree and attribute changes. */
  protected get items(): readonly T[] {
    const source = this.#source;
    if (source !== null) {
      const document = source.root.nodeDocument;
      if (document !== this.#document || document.collectionVersion !== this.#version) {
        this.#items = source.collect();
        this.#document = document;
        this.#version = document.collectionVersion;
      }
    }
    return this.#items;
  }

  /** Return the indexed node, or null outside the current collection. */
  item(index: number): T | null {
    return this.items[index] ?? null;
  }

  /** Indices exposed by Web IDL, independent of implementation storage. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.items.keys();
  }

  /** Recheck live contents at each iteration step, including after intervening mutations. */
  *[Symbol.iterator](): IterableIterator<T> {
    for (let index = 0; index < this.length; index++) yield this.item(index)!;
  }
}

/** Owner-supplied membership, refreshed after tree/attribute changes or adoption of the root. */
export type LiveCollectionSource<T extends NodeImpl> = {
  root: NodeImpl;
  collect(): T[];
};

/** Live children, an owner's filtered live view, or a static result whose array this list owns. */
// https://dom.spec.whatwg.org/#interface-nodelist
export class NodeListImpl extends NodeCollection<NodeImpl> {
  constructor(source: NodeImpl | NodeImpl[] | LiveCollectionSource<NodeImpl>) {
    super(!NodeImpl.is(source) ? source : {
      root: source,
      collect() {
        const nodes: NodeImpl[] = [];
        for (let child = source.firstChild; child; child = child.nextSibling) nodes.push(child);
        return nodes;
      },
    });
  }
}

/*
 * [Exposed=Window]
 * interface NodeList {
 *   getter Node? item(unsigned long index);
 *   readonly attribute unsigned long length;
 *   iterable<Node>;
 * };
 */
export const nodeListIDL = defineInterface({
  name: 'NodeList',
  exposed: 'Window',
  implementation: impl(NodeListImpl),
  members: [
    op('item', nullable(reference('Node')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter(
        (list: NodeListImpl) => list.getSupportedPropertyIndices(),
        { unsupportedValue: null },
      ),
    ),
    roAttr('length', idlType.unsignedLong),
    iter(reference('Node')),
  ],
});

/** Live element view, rooted in an ordinary tree and filtered in tree order. */
// https://dom.spec.whatwg.org/#interface-htmlcollection
export class HTMLCollectionImpl extends NodeCollection<ElementImpl> {
  constructor(
    source: NodeImpl | LiveCollectionSource<ElementImpl>,
    matches: (element: ElementImpl) => boolean = () => true,
    childrenOnly = false,
  ) {
    super(!NodeImpl.is(source) ? source : {
      root: source,
      collect() {
        const elements: ElementImpl[] = [];
        for (
          let node = source.firstChild;
          node;
          node = childrenOnly ? node.nextSibling : node.nextDescendant(source)
        ) {
          if (node.isElement() && matches(node)) elements.push(node);
        }
        return elements;
      },
    });
  }

  /** Unique nonempty IDs and HTML names, in tree order with each element's ID first. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (const element of this.items) {
      const id = element.getAttributeNS(null, 'id');
      const name = element.namespaceURI === HTML_NAMESPACE ? element.getAttributeNS(null, 'name') : null;
      if (id) names.add(id);
      if (name) names.add(name);
    }
    return names;
  }

  /** First element matching a nonempty ID or eligible HTML name. */
  // https://dom.spec.whatwg.org/#dom-htmlcollection-nameditem
  namedItem(name: string): ElementImpl | null {
    if (name === '') return null;
    for (const element of this.items) {
      if (
        element.getAttributeNS(null, 'id') === name ||
        (element.namespaceURI === HTML_NAMESPACE && element.getAttributeNS(null, 'name') === name)
      ) return element;
    }
    return null;
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
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(reference('Element')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter(
        (collection: HTMLCollectionImpl) => collection.getSupportedPropertyIndices(),
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
