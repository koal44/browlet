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
export class SelectletMediaList implements MediaList {
  [index: number]: CSSOMString;

  private _queries: MediaQuery[] = [];
  private _indexedLength = 0;

  constructor(text: CSSOMString | null = '') {
    this.mediaText = text;
  }

  get mediaText(): CSSOMString {
    return serializeMediaQueryList(this._queries);
  }

  set mediaText(value: CSSOMString | null) {
    this._queries = value === null || value === ''
      ? []
      : parseMediaQueryList(value);
    this.updateIndices();
  }

  get length(): number {
    return this._queries.length;
  }

  item(index: number): CSSOMString | null {
    const query = this._queries[index >>> 0];
    return query === undefined ? null : serializeMediaQuery(query);
  }

  appendMedium(medium: CSSOMString): void {
    const query = parseSingleMediaQuery(medium);
    if (query === null || this._queries.some((item) => mediaQueriesEqual(item, query))) {
      return;
    }

    this._queries.push(query);
    this.updateIndices();
  }

  deleteMedium(medium: CSSOMString): void {
    const query = parseSingleMediaQuery(medium);
    if (query === null) return;

    const length = this._queries.length;
    this._queries = this._queries.filter((item) => !mediaQueriesEqual(item, query));

    if (this._queries.length === length) {
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
    return this._queries.map(serializeMediaQuery)[Symbol.iterator]();
  }

  private updateIndices(): void {
    for (let index = 0; index < this._indexedLength; index++) {
      Reflect.deleteProperty(this, index);
    }

    for (let index = 0; index < this._queries.length; index++) {
      Object.defineProperty(this, index, {
        configurable: true,
        enumerable: true,
        get: () => this.item(index),
      });
    }

    this._indexedLength = this._queries.length;
  }
}

function parseSingleMediaQuery(input: CSSOMString): MediaQuery | null {
  const queries = parseMediaQueryList(input);
  return queries.length === 1 ? queries[0]! : null;
}

function mediaQueriesEqual(left: MediaQuery, right: MediaQuery): boolean {
  return serializeMediaQuery(left) === serializeMediaQuery(right);
}
