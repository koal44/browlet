
// convert escape sequence in a CSS string or identifier
// to javascript string with characters representations
export function cssIdentUnescape(str: string): string {
  if (!/[\\\x00]/.test(str)) return str;

  return str
    .replace(/\x00/g, '\uFFFD')
    .replace(
      /\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([\s\S])|\\$/g,
      (_match, hex: string | undefined, escaped: string | undefined) => {
        if (hex !== undefined) {
          const codePoint = parseInt(hex, 16);

          if (
            codePoint === 0 ||
            codePoint > 0x10ffff ||
            (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ) {
            return '\uFFFD';
          }

          return stringFromCodePoint(codePoint);
        }

        if (escaped !== undefined) {
          return escaped;
        }

        // CSS EOF escape: trailing "\" -> U+FFFD.
        return '\uFFFD';
      },
    );
}

// convert single codepoint to string
function stringFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ) {
    return "\ufffd";
  }
  return String.fromCodePoint(cp);
}

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

export function hasCssToken(actual: string, token: string): boolean {
  const n = actual.length;
  const m = token.length;

  if (m === 0) return false;

  let i = 0;
  while (i < n) {
    while (i < n && isCssSpace(actual.charCodeAt(i))) i++;
    const start = i;
    while (i < n && !isCssSpace(actual.charCodeAt(i))) i++;
    if (i - start === m && actual.slice(start, i) === token) return true;
  }

  return false;
}

export function asciiHasCssToken(actual: string, expectedLower: string): boolean {
  const n = actual.length;
  const m = expectedLower.length;

  if (m === 0) return false;

  let i = 0;

  while (i < n) {
    // Skip leading CSS whitespace.
    while (i < n && isCssSpace(actual.charCodeAt(i))) {
      i++;
    }

    const start = i;

    // Find end of this token.
    while (i < n && !isCssSpace(actual.charCodeAt(i))) {
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

export function isCssSpace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

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

export function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\-\\]/g, '\\$&');
}
