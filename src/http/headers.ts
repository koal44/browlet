import { nonASCIIDigitPattern, surroundingTabOrSpacePattern } from '../infra/patterns';
import { TextCursor } from '../infra/text-cursor';
import { isHTTPTabOrSpace } from './syntax';

/** An entity tag's opaque value and explicit weakness indicator. */
// https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3
// Entity tags are opaque, not quoted strings.
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

  /** Compare opaque values, requiring two strong tags for a strong comparison. */
  // https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2
  matches(other: EntityTag, comparison: 'strong' | 'weak'): boolean {
    return this.value === other.value &&
      (comparison === 'weak' || (!this.weak && !other.weak));
  }

  serialize(): string {
    return `${this.weak ? 'W/' : ''}"${this.value}"`;
  }
}

/** Parse a combined If-Match/If-None-Match field without splitting opaque tags. */
// UNUSED: retained for local cache precondition evaluation.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1
// https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2
// Empty list members follow §5.6.1.
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
// UNUSED: retained with the conditional-header parser.
export function serializeEntityTagList(tags: EntityTagList): string {
  return tags === '*' ? '*' : tags.map((tag) => tag.serialize()).join(', ');
}

/** Whether Last-Modified is strong, given epoch-millisecond dates and reliable relative clocks. */
// UNUSED: retained for partial-response cache validation.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2
// The caller must establish a common clock or enough separation to discount skew;
// the one-second minimum alone does not establish that evidence.
export function isStrongLastModified(
  lastModified: number | null,
  date: number | null,
  clocksReliable: boolean,
): boolean {
  return clocksReliable && lastModified !== null && date !== null && date - lastModified >= 1000;
}

/** Select a strong validator for If-Range; a weak entity tag forbids date fallback. */
// UNUSED: retained for partial-response cache validation.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5
// The caller only adds If-Range to a request that has Range.
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
// UNUSED: retained for partial-response cache validation.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5
export function parseIfRange(input: string, now: number): IfRangeValidator | null {
  return EntityTag.parse(input) ?? parseHTTPDate(input, now);
}

/** Compare If-Range with the selected representation's validator. */
// UNUSED: retained for partial-response cache validation.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5
// Both forms use exact equality, not earlier-than comparison.
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

/** Parse an HTTP-date as UTC epoch milliseconds; now resolves two-digit years. */
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7
// Cache-recipient case insensitivity follows RFC 9111 §4.2.
export function parseHTTPDate(input: string, now: number): number | null {
  const value = input.replace(surroundingTabOrSpacePattern, '');
  let match: string[] | null = imfFixdatePattern.exec(value);
  let obsolete = false;
  if (!match) {
    match = rfc850DatePattern.exec(value);
    obsolete = match !== null;
  }
  if (!match) {
    const asctime = asctimeDatePattern.exec(value);
    if (!asctime || asctime[0] !== value) return null;
    match = [asctime[0], asctime[1]!, asctime[3]!, asctime[2]!,
      asctime[7]!, asctime[4]!, asctime[5]!, asctime[6]!];
  }
  if (match[0] !== value) return null;

  const weekday = (obsolete ? longWeekdays : shortWeekdays).indexOf(match[1]!.toLowerCase());
  const day = Number(match[2]);
  const month = months.indexOf(match[3]!.toLowerCase());
  let year = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);
  if (weekday === -1 || month === -1 || hour > 23 || minute > 59 || second > 60) {
    return null;
  }

  const limit = new Date(now);
  if (obsolete) {
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    year += Math.floor(limit.getUTCFullYear() / 100) * 100;
  }
  // Date's setters preserve years 0000–0099, unlike Date.UTC's 1900 offset.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  // ECMAScript cannot represent a leap second. Round down for cache expiry
  // rather than extending freshness (RFC 9111 §4.2).
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  if (obsolete && date.getTime() > limit.getTime()) {
    year -= 100;
    date.setUTCFullYear(year, month, day);
  }
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month ||
    date.getUTCDate() !== day || date.getUTCDay() !== weekday) return null;
  return date.getTime();
}

/** Format UTC epoch milliseconds as an HTTP-date, or null outside its four-digit year range. */
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7
export function serializeHTTPDate(value: number): string | null {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(year) || year < 0 || year > 9999) return null;
  // RFC 9110 §5.6.7 requires senders to use IMF-fixdate, at whole-second precision.
  return date.toUTCString();
}

/** Parse a byte Content-Range; malformed values and unsupported units return null. */
// UNUSED: retained for partial-response cache validation and assembly.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-14.4
// Unknown range units cannot be combined by a byte cache.
export function parseContentRange(input: string): ContentRange | null {
  const value = input.replace(surroundingTabOrSpacePattern, '');
  const match = contentRangePattern.exec(value);
  if (match === null || match[0] !== value) return null;

  if (match[4] !== undefined) {
    return { completeLength: BigInt(match[4]) };
  }

  const first = BigInt(match[1]!);
  const last = BigInt(match[2]!);
  if (last < first) return null;
  const range: ContentRange = { first, last };
  if (match[3] !== '*') {
    const completeLength = BigInt(match[3]!);
    if (completeLength <= last) return null;
    range.completeLength = completeLength;
  }
  return range;
}

/** Parse Retry-After without scheduling a retry; now resolves obsolete two-digit years. */
// UNUSED: no retry-policy consumer yet.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3
// A delay starts at response receipt; deciding to retry is the caller's policy.
export function parseRetryAfter(input: string, now: number): RetryAfter | null {
  const value = input.replace(surroundingTabOrSpacePattern, '');
  if (value !== '' && !nonASCIIDigitPattern.test(value)) {
    return { delaySeconds: BigInt(value) };
  }
  const date = parseHTTPDate(value, now);
  return date === null ? null : { date };
}

export type EntityTagList = '*' | EntityTag[];

/** An entity tag or a parsed HTTP-date in UTC epoch milliseconds. */
export type IfRangeValidator = EntityTag | number;

/** Byte-range metadata; omit offsets for unsatisfied ranges and lengths when unknown. */
export type ContentRange = {
  first?: bigint;
  last?: bigint;
  completeLength?: bigint;
};

/** A parsed field supplies either an absolute UTC time in milliseconds or an exact delay in seconds. */
export type RetryAfter = {
  date?: number;
  delaySeconds?: bigint;
};

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
const shortWeekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const longWeekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const imfFixdatePattern = /^([a-z]{3}), ([0-9]{2}) ([a-z]{3}) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/i;
const rfc850DatePattern = /^([a-z]+), ([0-9]{2})-([a-z]{3})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/i;
const asctimeDatePattern = /^([a-z]{3}) ([a-z]{3}) ([ 0-9][0-9]) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/i;
const contentRangePattern = /^bytes (?:([0-9]+)-([0-9]+)\/([0-9]+|\*)|\*\/([0-9]+))$/i;
