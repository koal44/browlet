import { arg, defineInterface, idlType, impl, indexedGetter, nullable, op, reference, roAttr } from '../../web-idl/core/index';

import type { CSSStyleSheetImpl } from './css-stylesheet';

/** Live stylesheet sequence whose order and membership are maintained by its owner. */
// https://drafts.csswg.org/cssom/#the-stylesheetlist-interface
export class StyleSheetListImpl<
  T extends CSSStyleSheetImpl = CSSStyleSheetImpl,
> {
  /** Sheets in the order exposed by this collection. */
  #styleSheets: T[] = [];

  /** Current number of sheets in the collection. */
  // https://drafts.csswg.org/cssom/#dom-stylesheetlist-length
  get length(): number {
    return this.#styleSheets.length;
  }

  /** Return the sheet at an index, or null outside the collection. */
  // https://drafts.csswg.org/cssom/#dom-stylesheetlist-item
  item(index: number): T | null {
    return this.#styleSheets[index] ?? null;
  }

  /** Iterate the retained implementations in collection order. */
  [Symbol.iterator](): ArrayIterator<T> {
    return this.#styleSheets[Symbol.iterator]();
  }

  /** Insert a sheet at the position selected by the owning collection algorithm. */
  insert(index: number, styleSheet: T): void {
    this.#styleSheets.splice(index, 0, styleSheet);
  }

  /** Remove the first occurrence of a sheet and report whether it was present. */
  remove(styleSheet: T): boolean {
    const index = this.#styleSheets.indexOf(styleSheet);
    if (index < 0) return false;

    this.#styleSheets.splice(index, 1);
    return true;
  }

  /** Enumerate the live collection's supported platform indices. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#styleSheets.keys();
  }
}

/*
 * [Exposed=Window]
 * interface StyleSheetList {
 *   getter CSSStyleSheet? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
export const styleSheetListIDL = defineInterface({
  name: 'StyleSheetList',
  exposed: 'Window',
  implementation: impl(StyleSheetListImpl),
  members: [
    op('item', nullable(reference('CSSStyleSheet')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((list: StyleSheetListImpl) => list.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    roAttr('length', idlType.unsignedLong),
  ],
});
