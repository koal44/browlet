import { arg, defineInterface, idlType, impl, indexedGetter, nullable, op, reference, roAttr } from '../../web-idl/core/index';

import type { CSSStyleSheetImpl } from './css-stylesheet';

/*
 * [Exposed=Window]
 * interface StyleSheetList {
 *   getter CSSStyleSheet? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
export class StyleSheetListImpl<
  T extends CSSStyleSheetImpl = CSSStyleSheetImpl,
> {
  #styleSheets: T[] = [];

  get length(): number {
    return this.#styleSheets.length;
  }

  item(index: number): T | null {
    return this.#styleSheets[index] ?? null;
  }

  [Symbol.iterator](): ArrayIterator<T> {
    return this.#styleSheets[Symbol.iterator]();
  }

  insert(index: number, styleSheet: T): void {
    this.#styleSheets.splice(index, 0, styleSheet);
  }

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

// https://drafts.csswg.org/cssom/#the-stylesheetlist-interface
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
