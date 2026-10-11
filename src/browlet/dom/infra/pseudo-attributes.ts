import { isXMLName } from './name-validation';

/** Parse XML stylesheet pseudo-attributes; return null for malformed input or duplicate names. */
// https://www.w3.org/TR/xml-stylesheet/#PA
export function parsePseudoAttributes(input: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let position = 0;
  while (position < input.length) {
    const start = position;
    while (position < input.length && XML_WHITESPACE_RE.test(input[position]!)) position++;
    if (position === input.length) break;
    if (start !== 0 && position === start) return null;
    PSEUDO_ATTRIBUTE_RE.lastIndex = position;
    const match = PSEUDO_ATTRIBUTE_RE.exec(input);
    if (match === null) return null;
    const name = match[1]!;
    if (!isXMLName(name) || attributes.has(name)) return null;
    const value = decodeReferences(match[2] ?? match[3]!);
    if (value === null) return null;
    attributes.set(name, value);
    position = PSEUDO_ATTRIBUTE_RE.lastIndex;
  }
  return attributes;
}

/** Decode only XML character references and the five predefined entity references. */
function decodeReferences(value: string): string | null {
  let result = '';
  let start = 0;
  for (let amp = value.indexOf('&'); amp !== -1; amp = value.indexOf('&', start)) {
    result += value.slice(start, amp);
    CHARACTER_REFERENCE_RE.lastIndex = amp;
    const match = CHARACTER_REFERENCE_RE.exec(value);
    if (match === null) return null;
    if (match[3] !== undefined) {
      result += entities[match[3]];
    } else {
      const code = match[1] === undefined ? Number(match[2]) : Number.parseInt(match[1], 16);
      if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xD7FF) ||
        (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF))) return null;
      result += String.fromCodePoint(code);
    }
    start = CHARACTER_REFERENCE_RE.lastIndex;
  }
  return result + value.slice(start);
}

// These scanners run synchronously without author callbacks; each sticky match sets its own position.
const PSEUDO_ATTRIBUTE_RE = /([^ \t\r\n=]+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/y;
const CHARACTER_REFERENCE_RE = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/y;
const XML_WHITESPACE_RE = /[ \t\r\n]/;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
