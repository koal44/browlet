// https://dom.spec.whatwg.org/#concept-ordered-set-parser
export function parseOrderedSet(input: string): Set<string> {
  return new Set(splitOnAsciiWhitespace(input));
}

// https://dom.spec.whatwg.org/#concept-ordered-set-serializer
export function serializeOrderedSet(set: ReadonlySet<string>): string {
  return [...set].join(' ');
}

// https://infra.spec.whatwg.org/#split-on-ascii-whitespace
export function splitOnAsciiWhitespace(input: string): string[] {
  return input.match(/[^\t\n\f\r ]+/g) ?? [];
}
