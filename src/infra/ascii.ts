export function asciiLower(s: string): string {
  for (let i = 0, l = s.length; i < l; ++i) {
    const c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      let out = s.slice(0, i) + String.fromCharCode(c + 32);
      for (++i; i < l; ++i) {
        const d = s.charCodeAt(i);
        out += d >= 65 && d <= 90 ? String.fromCharCode(d + 32) : s[i];
      }
      return out;
    }
  }
  return s;
}

/** Matches a whole token separated by ASCII whitespace, case-sensitively. */
export function hasWhitespaceToken(actual: string, token: string): boolean {
  const n = actual.length;
  const m = token.length;

  if (m === 0) return false;

  let i = 0;
  while (i < n) {
    while (i < n && isAsciiWhitespace(actual.charCodeAt(i))) i++;
    const start = i;
    while (i < n && !isAsciiWhitespace(actual.charCodeAt(i))) i++;
    if (i - start === m && actual.slice(start, i) === token) return true;
  }

  return false;
}

/** Infra, ASCII whitespace. */
export function isAsciiWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}
