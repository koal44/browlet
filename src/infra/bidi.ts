import { forgivingBase64Decode } from './base64';
import { bidiRangeCount, packedBidiRanges } from './bidi-data';

/** Return the first strong code point's direction (L: left-to-right; R/AL: right-to-left), or null. */
// https://www.unicode.org/reports/tr9/#Bidirectional_Character_Types
export function firstStrongDirection(text: string): TextDirection | null {
  if (text.length === 0) return null;
  const ranges = strongRanges ??= unpackStrongRanges();
  const lastRange = ranges.length / 3 - 1;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index)!;
    index += codePoint > 0xffff ? 2 : 1;
    let low = 0;
    let high = lastRange;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const offset = middle * 3;
      if (codePoint < ranges[offset]!) high = middle - 1;
      else if (codePoint > ranges[offset + 1]!) low = middle + 1;
      else return ranges[offset + 2] === 1 ? 'ltr' : 'rtl';
    }
  }
  return null;
}

/** Base text direction; determining it does not perform bidirectional layout. */
export type TextDirection = 'ltr' | 'rtl';

// Allocate the searchable table only on the first nonempty text lookup.
let strongRanges: Uint32Array | undefined;

/** Expand trusted generated data into sorted inclusive start/end/direction triples. */
function unpackStrongRanges(): Uint32Array {
  const bytes = forgivingBase64Decode(packedBidiRanges)!;
  const ranges = new Uint32Array(bidiRangeCount * 3);
  let index = 0;
  let previousEnd = -1;
  let isGap = true;
  let value = 0;
  let shift = 0;
  for (const byte of bytes) {
    value |= (byte & 127) << shift;
    if (byte & 128) {
      shift += 7;
      continue;
    }
    if (isGap) {
      ranges[index] = previousEnd + 1 + value;
    } else {
      previousEnd = ranges[index]! + (value >>> 1);
      ranges[index + 1] = previousEnd;
      ranges[index + 2] = (value & 1) + 1;
      index += 3;
    }
    isGap = !isGap;
    value = 0;
    shift = 0;
  }
  return ranges;
}
