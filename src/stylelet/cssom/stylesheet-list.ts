/*
 * [Exposed=Window]
 * interface StyleSheetList {
 *   getter CSSStyleSheet? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
export class StyleSheetListImpl implements StyleSheetList {
  [index: number]: CSSStyleSheet;

  readonly #styleSheets: CSSStyleSheet[];

  constructor(styleSheets: CSSStyleSheet[] = []) {
    this.#styleSheets = [...styleSheets];

    for (let index = 0; index < this.#styleSheets.length; index++) {
      Object.defineProperty(this, index, {
        configurable: true,
        enumerable: true,
        get: () => this.item(index),
      });
    }
  }

  item(index: number): CSSStyleSheet | null {
    return this.#styleSheets[index] ?? null;
  }

  get length(): number {
    return this.#styleSheets.length;
  }

  [Symbol.iterator](): ArrayIterator<CSSStyleSheet> {
    return this.#styleSheets[Symbol.iterator]();
  }
}
