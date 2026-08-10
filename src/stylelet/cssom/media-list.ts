import {
  parseMediaQueryList, serializeMediaQuery, serializeMediaQueryList,
  type MediaQuery,
} from '../values/media-query';
import { domExceptionName } from './exceptions';
import type { CSSOMString } from './string';

/*
 * [Exposed=Window]
 * interface MediaList {
 *   stringifier attribute [LegacyNullToEmptyString] CSSOMString mediaText;
 *   readonly attribute unsigned long length;
 *   getter CSSOMString? item(unsigned long index);
 *   undefined appendMedium(CSSOMString medium);
 *   undefined deleteMedium(CSSOMString medium);
 * };
 */
export class MediaListImpl implements MediaList {
  [index: number]: CSSOMString;

  #queries: MediaQuery[] = [];
  #indexedLength = 0;

  constructor(text: CSSOMString | null = '') {
    this.mediaText = text;
  }

  get mediaText(): CSSOMString {
    return serializeMediaQueryList(this.#queries);
  }

  set mediaText(value: CSSOMString | null) {
    this.#queries = value === null || value === ''
      ? []
      : parseMediaQueryList(value);
    this.updateIndices();
  }

  get length(): number {
    return this.#queries.length;
  }

  item(index: number): CSSOMString | null {
    const query = this.#queries[index >>> 0];
    return query === undefined ? null : serializeMediaQuery(query);
  }

  appendMedium(medium: CSSOMString): void {
    const query = parseSingleMediaQuery(medium);
    if (query === null || this.#queries.some((item) => mediaQueriesEqual(item, query))) {
      return;
    }

    this.#queries.push(query);
    this.updateIndices();
  }

  deleteMedium(medium: CSSOMString): void {
    const query = parseSingleMediaQuery(medium);
    if (query === null) return;

    const length = this.#queries.length;
    this.#queries = this.#queries.filter((item) => !mediaQueriesEqual(item, query));

    if (this.#queries.length === length) {
      throw new DOMException(
        `"${medium}" was not found in the media list.`,
        domExceptionName.notFound,
      );
    }

    this.updateIndices();
  }

  toString(): CSSOMString {
    return this.mediaText;
  }

  [Symbol.iterator](): ArrayIterator<CSSOMString> {
    return this.#queries.map(serializeMediaQuery)[Symbol.iterator]();
  }

  private updateIndices(): void {
    for (let index = 0; index < this.#indexedLength; index++) {
      Reflect.deleteProperty(this, index);
    }

    for (let index = 0; index < this.#queries.length; index++) {
      Object.defineProperty(this, index, {
        configurable: true,
        enumerable: true,
        get: () => this.item(index),
      });
    }

    this.#indexedLength = this.#queries.length;
  }
}

function parseSingleMediaQuery(input: CSSOMString): MediaQuery | null {
  const queries = parseMediaQueryList(input);
  return queries.length === 1 ? queries[0]! : null;
}

function mediaQueriesEqual(left: MediaQuery, right: MediaQuery): boolean {
  return serializeMediaQuery(left) === serializeMediaQuery(right);
}
