/*
 * MIME Sniffing §6.1 pattern matching algorithm.
 *
 * https://mimesniff.spec.whatwg.org/#pattern-matching-algorithm
 */
export function matchesBytePattern(
  input: Uint8Array,
  pattern: Uint8Array,
  mask: Uint8Array,
  ignored: Set<number>,
): boolean {
  if (pattern.length !== mask.length) {
    throw new RangeError('A byte pattern and its mask must have equal lengths');
  }
  if (input.length < pattern.length) return false;

  let start = 0;
  while (start < input.length && ignored.has(input[start]!)) start++;
  if (input.length - start < pattern.length) return false;

  for (let position = 0; position < pattern.length; position++) {
    const masked = input[start + position]! & mask[position]!;
    if (masked !== pattern[position]) return false;
  }
  return true;
}
