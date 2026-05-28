export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function assertNever(x: never): never {
  throw new Error(`Unexpected key: ${String(x)}`);
}

export type Permutations<T, K = T> =
  [T] extends [never] ? [] :
  T extends K ? [T, ...Permutations<Exclude<K, T>>] : never;

export function isElement(x: unknown): x is Element {
  return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 1;
}

export function isDocument(x: unknown): x is Document {
  return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 9;
}

export function isDocumentFragment(x: unknown): x is DocumentFragment {
  return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 11;
}

export function isIFrame(el: Element | null): el is HTMLIFrameElement {
  return !!el && el.localName === 'iframe';
}

export function isTemplate(el: Element | null): el is HTMLTemplateElement {
  return !!el && el.localName === 'template';
}

export function isHtmlDoc(doc: Document): doc is HTMLDocument {
  return doc.contentType.includes('/html') === true;
}

export function isHTMLElement(el: Element | null): el is HTMLElement {
  return !!el && el.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export function cssEscape(ident: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(ident);
  }

  if (ident === '-') return '\\-';

  let out = '';
  const first = ident.charCodeAt(0);

  for (let i = 0, l = ident.length; i < l; i++) {
    const c = ident.charCodeAt(i);
    const digit = c >= 0x30 && c <= 0x39;
    out +=
      c === 0x00 ?                         '\uFFFD' :               // NUL
      c >= 0x01 && c <= 0x1F ?             `\\${c.toString(16)} ` : // control chars
      c === 0x7F ?                         `\\${c.toString(16)} ` : // delete
      digit && i === 0 ?                   `\\${c.toString(16)} ` : // leading digit
      digit && i === 1 && first === 0x2D ? `\\${c.toString(16)} ` : // second char digit after -
      digit ?                              ident.charAt(i) :        // 0-9
      c >= 0x80 ?                          ident.charAt(i) :        // non-ASCII
      c === 0x2D || c === 0x5F ?           ident.charAt(i) :        // - or _
      c >= 0x41 && c <= 0x5A ?             ident.charAt(i) :        // A-Z
      c >= 0x61 && c <= 0x7A ?             ident.charAt(i) :        // a-z
      `\\${ident.charAt(i)}`;  // ASCII punctuation / syntax
  }
  return out;
}
