import { surroundingTabOrSpacePattern } from '../infra/patterns';
import { TextCursor } from '../infra/text-cursor';
import { parseHTTPDate } from './date';
import { isHTTPTabOrSpace } from './syntax';

// RFC 9110 §§8.8.3 and 8.8.3.2. Entity tags are opaque, not quoted strings.
/** An entity tag's opaque value and explicit weakness indicator. */
export class EntityTag {
  constructor(public value: string, public weak = false) {}

  /** Parse one complete ETag field; malformed or repeated tags return null. */
  static parse(input: string): EntityTag | null {
    const cursor = new TextCursor(input);
    cursor.consumeWhile(isHTTPTabOrSpace);
    const tag = readEntityTag(cursor);
    cursor.consumeWhile(isHTTPTabOrSpace);
    return cursor.eof() ? tag : null;
  }

  matches(other: EntityTag, comparison: 'strong' | 'weak'): boolean {
    return this.value === other.value &&
      (comparison === 'weak' || (!this.weak && !other.weak));
  }

  serialize(): string {
    return `${this.weak ? 'W/' : ''}"${this.value}"`;
  }
}

// RFC 9110 §§13.1.1–13.1.2, with §5.6.1's empty list-member handling.
/** Parse a combined If-Match/If-None-Match field without splitting opaque tags. */
export function parseEntityTagList(input: string): EntityTagList | null {
  if (input.replace(surroundingTabOrSpacePattern, '') === '*') return '*';
  const cursor = new TextCursor(input);
  const tags: EntityTag[] = [];
  while (true) {
    cursor.consumeWhile((ch) => ch === ',' || isHTTPTabOrSpace(ch));
    if (cursor.eof()) return tags;
    const tag = readEntityTag(cursor);
    if (tag === null) return null;
    tags.push(tag);
    cursor.consumeWhile(isHTTPTabOrSpace);
    if (!cursor.eof() && cursor.peek() !== ',') return null;
  }
}

/** Serialize a parsed validator list without changing opaque tag values. */
export function serializeEntityTagList(tags: EntityTagList): string {
  return tags === '*' ? '*' : tags.map((tag) => tag.serialize()).join(', ');
}

// RFC 9110 §8.8.2.2, client/cache inference. These are parsed UTC epoch milliseconds.
// The caller must establish a common clock or enough separation to discount skew;
// the one-second minimum alone does not establish that evidence.
/** Whether a stored Last-Modified is strong, given reliable relative clock values. */
export function isStrongLastModified(
  lastModified: number | null,
  date: number | null,
  clocksReliable: boolean,
): boolean {
  return clocksReliable && lastModified !== null && date !== null && date - lastModified >= 1000;
}

// RFC 9110 §13.1.5. The caller only adds If-Range to a request that has Range.
/** Select a strong validator for If-Range; a weak entity tag forbids date fallback. */
export function selectIfRangeValidator(
  tag: EntityTag | null,
  lastModified: number | null,
  date: number | null,
  clocksReliable: boolean,
): IfRangeValidator | null {
  if (tag !== null) return tag.weak ? null : tag;
  return isStrongLastModified(lastModified, date, clocksReliable) ? lastModified : null;
}

/** Parse one If-Range field; date interpretation uses the caller's clock. */
export function parseIfRange(input: string, now: number): IfRangeValidator | null {
  return EntityTag.parse(input) ?? parseHTTPDate(input, now);
}

// RFC 9110 §13.1.5: both forms use exact equality, not earlier-than comparison.
/** Compare If-Range with the selected representation's validator. */
export function matchesIfRange(
  validator: IfRangeValidator,
  tag: EntityTag | null,
  lastModified: number | null,
  lastModifiedIsStrong: boolean,
): boolean {
  return typeof validator === 'number'
    ? lastModifiedIsStrong && validator === lastModified
    : tag !== null && validator.matches(tag, 'strong');
}

export type EntityTagList = '*' | EntityTag[];

/** An entity tag or a parsed HTTP-date in UTC epoch milliseconds. */
export type IfRangeValidator = EntityTag | number;

function readEntityTag(cursor: TextCursor): EntityTag | null {
  const weak = cursor.match('W');
  if (weak && !cursor.match('/')) return null;
  if (!cursor.match('"')) return null;
  const start = cursor.pos();
  cursor.consumeWhile((ch) => entityTagCharacterPattern.test(ch));
  const value = cursor.slice(start);
  return cursor.match('"') ? new EntityTag(value, weak) : null;
}

const entityTagCharacterPattern = /^[\x21\x23-\x7e\x80-\xff]$/;
