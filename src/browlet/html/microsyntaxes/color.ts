import { asciiLower, surroundingASCIIWhitespacePattern } from '../../../infra/index';
import { ColorRgba, absoluteColorFromRgba, type AbsoluteColor } from '../../../stylelet/index';

/** Parse an HTML legacy color into an opaque Stylelet sRGB value; return null on failure. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-legacy-colour-value
export function parseLegacyColor(input: string): AbsoluteColor | null {
  // SPEC_CLASH(html-legacy-color-whitespace): Follow HTML's original-empty check and edge-only trimming; Firefox compresses whitespace first.
  if (input.length === 0) return null;
  // SPEC_CLASH(html-legacy-color-ascii-whitespace): Follow HTML/Firefox/WebKit; Chromium also trims vertical tabs.
  input = input.replace(surroundingASCIIWhitespacePattern, '');
  const name = asciiLower(input);
  // SPEC_CLASH(html-legacy-color-transparent): Follow HTML/Chromium/WebKit's failure; Firefox returns a transparent color.
  if (name === 'transparent') return null;

  if (Object.hasOwn(ColorRgba, name)) {
    return absoluteColorFromRgba(ColorRgba[name as keyof typeof ColorRgba]);
  }

  let red: number;
  let green: number;
  let blue: number;
  if (shortHexPattern.test(input)) {
    const hex = parseInt(input.slice(1), 16);
    red = (hex >> 8) * 17;
    green = ((hex >> 4) & 15) * 17;
    blue = (hex & 15) * 17;
  } else {
    // A non-BMP code point occupies two UTF-16 units. Replacing each non-hex unit
    // with '0' is equivalent to the spec's prior replacement of that point with '00',
    // including when truncation falls between those zeros. Lone surrogates become '0'.
    // SPEC_CLASH(html-legacy-color-hash-limit): Follow HTML/Firefox's 128-character limit before removing '#'; Chromium/WebKit remove it first.
    input = input.slice(0, 128);
    if (input.charCodeAt(0) === 35) input = input.slice(1);
    input = input.replace(nonHexPattern, '0');
    // Pad to a nonempty length divisible by three, then split equally into RGB.
    input = input.padEnd(Math.max(3, Math.ceil(input.length / 3) * 3), '0');

    const length = input.length / 3;
    let start = Math.max(0, length - 8);
    while (length - start > 2 && input.charCodeAt(start) === 48 &&
      input.charCodeAt(length + start) === 48 && input.charCodeAt(2 * length + start) === 48) {
      start++;
    }
    const end = Math.min(start + 2, length);
    red = parseInt(input.slice(start, end), 16);
    green = parseInt(input.slice(length + start, length + end), 16);
    blue = parseInt(input.slice(2 * length + start, 2 * length + end), 16);
  }

  return absoluteColorFromRgba(((red << 24) | (green << 16) | (blue << 8) | 0xff) >>> 0);
}

const shortHexPattern = /^#[0-9a-fA-F]{3}$/;
// Deliberately match UTF-16 code units, so each non-BMP character contributes two zeros.
const nonHexPattern = /[^0-9a-fA-F]/g;
