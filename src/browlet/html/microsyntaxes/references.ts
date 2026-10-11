/** Extract the nonempty name after the first # anywhere in the input, preserving the suffix literally. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-hash-name-reference
// HTML combines string parsing with element lookup; DOM's image-map helpers own the latter.
export function parseHashNameReference(input: string): string | null {
  const hash = input.indexOf('#');
  if (hash === -1 || hash === input.length - 1) return null;
  return input.slice(hash + 1);
}
