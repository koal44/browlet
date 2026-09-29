/** Parse unique tokens in first-occurrence order, separated by ASCII whitespace. */
// https://dom.spec.whatwg.org/#concept-ordered-set-parser
export function parseOrderedSet(input: string): Set<string> {
  return new Set(splitOnAsciiWhitespace(input));
}

/** Join tokens in insertion order with a single space. */
// https://dom.spec.whatwg.org/#concept-ordered-set-serializer
export function serializeOrderedSet(set: ReadonlySet<string>): string {
  return [...set].join(' ');
}

// https://infra.spec.whatwg.org/#split-on-ascii-whitespace
export function splitOnAsciiWhitespace(input: string): string[] {
  return input.match(ASCII_WHITESPACE_TOKEN_RE) ?? [];
}

const ASCII_WHITESPACE_TOKEN_RE = /[^\t\n\f\r ]+/g;
