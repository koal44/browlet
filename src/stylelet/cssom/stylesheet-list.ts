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
  [index: number]: T;

  readonly #styleSheets: T[] = [];

  item(index: number): T | null {
    return this.#styleSheets[index] ?? null;
  }

  get length(): number {
    return this.#styleSheets.length;
  }

  [Symbol.iterator](): ArrayIterator<T> {
    return this.#styleSheets[Symbol.iterator]();
  }

  insert(index: number, styleSheet: T): void {
    this.#styleSheets.splice(index, 0, styleSheet);
    this.#defineIndex(this.#styleSheets.length - 1);
  }

  remove(styleSheet: T): boolean {
    const index = this.#styleSheets.indexOf(styleSheet);
    if (index < 0) return false;

    this.#styleSheets.splice(index, 1);
    Reflect.deleteProperty(this, String(this.#styleSheets.length));
    return true;
  }

  #defineIndex(index: number): void {
    Object.defineProperty(this, index, {
      configurable: true,
      enumerable: true,
      get: () => this.item(index),
    });
  }
}
