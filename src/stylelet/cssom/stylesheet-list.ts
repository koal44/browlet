/*
 * [Exposed=Window]
 * interface StyleSheetList {
 *   getter CSSStyleSheet? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
export class StyleSheetListImpl<
  T extends CSSStyleSheet = CSSStyleSheet,
> implements StyleSheetList {
  [index: number]: T;

  readonly #styleSheets: T[] = [];

  constructor() {
    styleSheetLists.set(this, this.#styleSheets);
  }

  item(index: number): T | null {
    return this.#styleSheets[index] ?? null;
  }

  get length(): number {
    return this.#styleSheets.length;
  }

  [Symbol.iterator](): ArrayIterator<T> {
    return this.#styleSheets[Symbol.iterator]();
  }
}

export function insertStyleSheet<T extends CSSStyleSheet>(
  list: StyleSheetListImpl<T>,
  index: number,
  styleSheet: T,
): void {
  const styleSheets = getStyleSheets(list);

  styleSheets.splice(index, 0, styleSheet);
  defineIndex(list, styleSheets.length - 1);
}

export function removeStyleSheet<T extends CSSStyleSheet>(
  list: StyleSheetListImpl<T>,
  styleSheet: T,
): boolean {
  const styleSheets = getStyleSheets(list);
  const index = styleSheets.indexOf(styleSheet);
  if (index < 0) return false;

  styleSheets.splice(index, 1);
  Reflect.deleteProperty(list, String(styleSheets.length));
  return true;
}

const styleSheetLists = new WeakMap<
  StyleSheetListImpl<CSSStyleSheet>,
  CSSStyleSheet[]
>();

function getStyleSheets<T extends CSSStyleSheet>(
  list: StyleSheetListImpl<T>,
): T[] {
  const styleSheets = styleSheetLists.get(list);
  if (!styleSheets) throw new TypeError('Illegal invocation');
  return styleSheets as T[];
}

function defineIndex<T extends CSSStyleSheet>(
  list: StyleSheetListImpl<T>,
  index: number,
): void {
  Object.defineProperty(list, index, {
    configurable: true,
    enumerable: true,
    get: () => list.item(index),
  });
}
