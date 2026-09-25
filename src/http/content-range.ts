import { surroundingTabOrSpacePattern } from '../infra/patterns';

// RFC 9110 §§14.1.2 and 14.4. Unknown range units cannot be combined by a byte cache.
/** Parse a byte Content-Range; malformed values and unsupported units return null. */
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

/** Byte-range metadata; omit offsets for unsatisfied ranges and lengths when unknown. */
export type ContentRange = {
  first?: bigint;
  last?: bigint;
  completeLength?: bigint;
};

const contentRangePattern = /^bytes (?:([0-9]+)-([0-9]+)\/([0-9]+|\*)|\*\/([0-9]+))$/i;
