import {
  annotated, arg, attr, defineInterface, DOMExceptionImpl, idlType, impl, indexedGetter,
  nullable, op, reference, roAttr, xattr,
} from '../../web-idl/core/index';

import {
  parseMediaQueryList, serializeMediaQuery, serializeMediaQueryList,
  type MediaQuery,
} from '../values/index';

/** Retain and edit a media query list; device matching belongs to Conditional Rules. */
// https://drafts.csswg.org/cssom/#the-medialist-interface
export class MediaListImpl {
  #queries: MediaQuery[] = [];

  // https://drafts.csswg.org/cssom/#create-a-medialist-object
  constructor(text: string) {
    this.mediaText = text;
  }

  // https://drafts.csswg.org/cssom/#dom-medialist-mediatext
  get mediaText(): string {
    return serializeMediaQueryList(this.#queries);
  }

  set mediaText(value: string) {
    this.#queries = parseMediaQueryList(value);
  }

  // https://drafts.csswg.org/cssom/#dom-medialist-length
  get length(): number {
    return this.#queries.length;
  }

  /** Return the serialized query, or null outside the list. */
  // https://drafts.csswg.org/cssom/#dom-medialist-item
  item(index: number): string | null {
    const query = this.#queries[index];
    return query === undefined ? null : serializeMediaQuery(query);
  }

  /** Append one query unless its serialization is already present. */
  // https://drafts.csswg.org/cssom/#dom-medialist-appendmedium
  // SPEC_CLASH(media-list-mutation-comparison): Follow CSSOM/Chromium's no-op
  // for duplicates; Firefox moves the query to the end and WebKit appends it.
  appendMedium(medium: string): void {
    const query = parseSingleMediaQuery(medium);
    if (query === null) return;

    const serialized = serializeMediaQuery(query);
    if (!this.#queries.some((item) => serializeMediaQuery(item) === serialized)) {
      this.#queries.push(query);
    }
  }

  /** Remove every equivalent query, throwing NotFoundError if none matches. */
  // https://drafts.csswg.org/cssom/#dom-medialist-deletemedium
  // SPEC_CLASH(media-list-mutation-comparison): Remove all matches, following
  // CSSOM/Chromium/Firefox; WebKit removes only one. See the CSSOM roadmap.
  deleteMedium(medium: string): void {
    const query = parseSingleMediaQuery(medium);
    if (query === null) return;

    const serialized = serializeMediaQuery(query);
    const length = this.#queries.length;
    this.#queries = this.#queries.filter((item) => serializeMediaQuery(item) !== serialized);

    if (this.#queries.length === length) {
      throw new DOMExceptionImpl(`"${medium}" was not found in the media list.`, 'NotFoundError');
    }
  }

  /** Supply live indexed properties to the host's Web IDL binding. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#queries.keys();
  }
}

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
export const mediaListIDL = defineInterface({
  name: 'MediaList',
  exposed: 'Window',
  implementation: impl(MediaListImpl),
  members: [
    attr('mediaText', annotated(reference('CSSOMString'), xattr('LegacyNullToEmptyString')), { stringifier: true }),
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(reference('CSSOMString')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((list: MediaListImpl) => list.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    op('appendMedium', idlType.undefined, [arg('medium', reference('CSSOMString'))]),
    op('deleteMedium', idlType.undefined, [arg('medium', reference('CSSOMString'))]),
  ],
});

/** Parse exactly one query, including an invalid query recovered as `not all`. */
// https://drafts.csswg.org/cssom/#parse-a-media-query
// SPEC_CLASH(media-list-mutation-input): Follow CSSOM/Chromium's list recovery
// and ignore empty/multiple-query input. Firefox/WebKit differ; see the roadmap.
function parseSingleMediaQuery(input: string): MediaQuery | null {
  const queries = parseMediaQueryList(input);
  return queries.length === 1 ? queries[0]! : null;
}
