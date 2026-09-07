// convert escape sequence in a CSS string or identifier
// to javascript string with character representations
export function cssIdentUnescape(str: string): string {
  if (str.indexOf('\\') < 0 && str.indexOf('\x00') < 0) return str;

  return str
    .replace(NULL_RE, REPLACEMENT_CHARACTER)
    .replace(
      CSS_ESCAPE_RE,
      (_match, hex: string | undefined, escaped: string | undefined) => {
        if (hex !== undefined) {
          const codePoint = parseInt(hex, 16);
          return codePoint === 0 ? REPLACEMENT_CHARACTER : stringFromCodePoint(codePoint);
        }

        if (escaped !== undefined) return escaped;

        // CSS EOF escape: trailing "\" -> U+FFFD.
        return REPLACEMENT_CHARACTER;
      },
    );
}

// convert single codepoint to string
function stringFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return REPLACEMENT_CHARACTER;
  }
  return String.fromCodePoint(cp);
}

const REPLACEMENT_CHARACTER = '\ufffd';

// eslint-disable-next-line no-control-regex
const NULL_RE = /\x00/g;

const CSS_ESCAPE_RE = /\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([\s\S])|\\$/g;
