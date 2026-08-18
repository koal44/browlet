// DOM §1.2 Ordered sets
export function parseOrderedSet(input: string): Set<string> {
  return new Set(splitOnAsciiWhitespace(input));
}

export function serializeOrderedSet(set: ReadonlySet<string>): string {
  return [...set].join(' ');
}

export function splitOnAsciiWhitespace(input: string): string[] {
  return input.match(/[^\t\n\f\r ]+/g) ?? [];
}
