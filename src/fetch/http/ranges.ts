import { isHTTPTabOrSpace } from '../../http/syntax';
import { TextCursor } from '../../infra/text-cursor';
import { serializeInteger } from '../infrastructure';

/** Fetch §2.2.2 — build a content range from integer offsets and length. */
export function buildContentRange(
  rangeStart: number | bigint, rangeEnd: number | bigint, fullLength: number | bigint,
): string {
  return `bytes ${serializeInteger(rangeStart)}-${serializeInteger(rangeEnd)}/${serializeInteger(fullLength)}`;
}

/**
 * Fetch §2.2.2 — parse a single range header value. BigInts preserve the
 * ordering of unbounded decimal offsets. Null indicates failure;
 * an undefined endpoint means omitted.
 * https://fetch.spec.whatwg.org/#simple-range-header-value
 */
export function parseSingleRangeHeaderValue(
  value: string, allowWhitespace: boolean,
): [start?: bigint, end?: bigint] | null {
  if (!value.startsWith('bytes')) return null;
  const position = new TextCursor(value, 5);
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);
  if (!position.match('=')) return null;
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);

  const start = position.pos();
  position.consumeWhile(isASCIIDigit);
  const startValue = position.slice(start);
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);
  if (!position.match('-')) return null;
  if (allowWhitespace) position.consumeWhile(isHTTPTabOrSpace);

  const end = position.pos();
  position.consumeWhile(isASCIIDigit);
  const endValue = position.slice(end);
  if (!position.eof() || startValue === '' && endValue === '') return null;

  const rangeStart = startValue === '' ? undefined : BigInt(startValue);
  const rangeEnd = endValue === '' ? undefined : BigInt(endValue);
  if (rangeStart !== undefined && rangeEnd !== undefined && rangeStart > rangeEnd) return null;
  return [rangeStart, rangeEnd];
}

function isASCIIDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}
