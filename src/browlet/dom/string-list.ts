import {
  arg, defineInterface, idlType, impl, indexedGetter, nullable, op, roAttr,
} from '../../web-idl/core/index';

/** Read-only platform view of an associated string list maintained by its owner. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#the-domstringlist-interface
export class DOMStringListImpl {
  #list: string[];

  /** Retain the associated list; its owner determines whether it changes or is a snapshot. */
  constructor(list: string[]) {
    this.#list = list;
  }

  // https://html.spec.whatwg.org/#dom-domstringlist-length
  get length(): number {
    return this.#list.length;
  }

  /** Return the indexed string, or null outside the associated list. */
  // https://html.spec.whatwg.org/#dom-domstringlist-item
  item(index: number): string | null {
    return this.#list[index] ?? null;
  }

  /** Test exact string membership without normalizing or discarding duplicates. */
  // https://html.spec.whatwg.org/#dom-domstringlist-contains
  contains(string: string): boolean {
    return this.#list.includes(string);
  }

  /** Expose the current indices of the associated list to Web IDL. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#list.keys();
  }
}

/*
 * [Exposed=(Window,Worker)]
 * interface DOMStringList {
 *   readonly attribute unsigned long length;
 *   getter DOMString? item(unsigned long index);
 *   boolean contains(DOMString string);
 * };
 */
export const domStringListIDL = defineInterface({
  name: 'DOMStringList',
  exposed: ['Window', 'Worker'],
  implementation: impl(DOMStringListImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(idlType.DOMString),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((list: DOMStringListImpl) => list.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    op('contains', idlType.boolean, [arg('string', idlType.DOMString)]),
  ],
});
