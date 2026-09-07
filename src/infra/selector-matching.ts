import { isAsciiWhitespace } from './ascii';

/*
 * Selector runtime helpers: expectedLower is already ASCII-lowercased.
 * Callers prepare it once when compiling a selector; only actual is folded
 * during matching.
 */

export function asciiEquals(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;
  if (actual.length !== n) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return true;
}

export function asciiStartsWith(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;
  if (actual.length < n) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return true;
}

export function asciiEndsWith(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;
  const offset = actual.length - n;
  if (offset < 0) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(offset + i);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return true;
}

export function asciiIncludes(actual: string, expectedLower: string): boolean {
  const m = expectedLower.length;

  // Native `[attr*=""]` matches nothing in selector semantics, and the compiler
  // should short-circuit that case before reaching here.
  if (m === 0) return false;
  if (actual.length < m) return false;

  const limit = actual.length - m;

  outer:
  for (let start = 0; start <= limit; start++) {
    for (let i = 0; i < m; i++) {
      let c = actual.charCodeAt(start + i);
      if (c >= 65 && c <= 90) c += 32;

      if (c !== expectedLower.charCodeAt(i)) continue outer;
    }

    return true;
  }

  return false;
}

export function asciiDashMatch(actual: string, expectedLower: string): boolean {
  const n = expectedLower.length;

  if (actual.length < n) return false;

  for (let i = 0; i < n; i++) {
    let c = actual.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;

    if (c !== expectedLower.charCodeAt(i)) return false;
  }

  return actual.length === n || actual.at(n) === '-';
}

/** ASCII case-insensitive token lookup against the prepared expectedLower. */
export function hasAsciiWhitespaceToken(actual: string, expectedLower: string): boolean {
  const n = actual.length;
  const m = expectedLower.length;

  if (m === 0) return false;

  let i = 0;

  while (i < n) {
    // Skip leading ASCII whitespace.
    while (i < n && isAsciiWhitespace(actual.charCodeAt(i))) {
      i++;
    }

    const start = i;

    // Find end of this token.
    while (i < n && !isAsciiWhitespace(actual.charCodeAt(i))) {
      i++;
    }

    if (i - start === m) {
      let matched = true;

      for (let j = 0; j < m; j++) {
        let c = actual.charCodeAt(start + j);

        if (c >= 65 && c <= 90) {
          c += 32;
        }

        if (c !== expectedLower.charCodeAt(j)) {
          matched = false;
          break;
        }
      }

      if (matched) return true;
    }
  }

  return false;
}
