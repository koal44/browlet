/*
 * [Exposed=Window]
 * interface StyleSheetList {
 *   getter CSSStyleSheet? item(unsigned long index);
 *   readonly attribute unsigned long length;
 * };
 */
export class StyleSheetListImpl implements StyleSheetList {
  [index: number]: CSSStyleSheet;

  readonly #styleSheets: CSSStyleSheet[] = [];

  constructor() {
    styleSheetLists.set(this, this.#styleSheets);
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

export function insertStyleSheet(
  list: StyleSheetListImpl,
  index: number,
  styleSheet: CSSStyleSheet,
): void {
  const styleSheets = getStyleSheets(list);

  styleSheets.splice(index, 0, styleSheet);
  defineIndex(list, styleSheets.length - 1);
}

export function removeStyleSheet(
  list: StyleSheetListImpl,
  styleSheet: CSSStyleSheet,
): boolean {
  const styleSheets = getStyleSheets(list);
  const index = styleSheets.indexOf(styleSheet);
  if (index < 0) return false;

  styleSheets.splice(index, 1);
  Reflect.deleteProperty(list, String(styleSheets.length));
  return true;
}

const styleSheetLists = new WeakMap<
  StyleSheetListImpl,
  CSSStyleSheet[]
>();

function getStyleSheets(list: StyleSheetListImpl): CSSStyleSheet[] {
  const styleSheets = styleSheetLists.get(list);
  if (!styleSheets) throw new TypeError('Illegal invocation');
  return styleSheets;
}

function defineIndex(list: StyleSheetListImpl, index: number): void {
  Object.defineProperty(list, index, {
    configurable: true,
    enumerable: true,
    get: () => list.item(index),
  });
}
