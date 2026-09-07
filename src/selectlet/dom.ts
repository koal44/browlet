const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;

export function isNode(x: unknown): x is Node {
  return !!x &&
    typeof x === 'object' &&
    typeof (x as Node).nodeType === 'number' &&
    typeof (x as Node).nodeName === 'string';
}

export function isDocument(n: Node): n is Document {
  return n.nodeType === DOCUMENT_NODE;
}

export function isDocumentFragment(n: Node): n is DocumentFragment {
  return n.nodeType === DOCUMENT_FRAGMENT_NODE;
}

export function isComment(n: Node): n is Comment {
  return n.nodeType === COMMENT_NODE;
}

export function isText(n: Node): n is Text {
  return n.nodeType === TEXT_NODE;
}

export function isHtmlDoc(doc: Document): doc is HTMLDocument {
  return doc.contentType.includes('/html') || doc.createElement('DiV').localName === 'div';
}

export function isQuirksMode(doc: Document): boolean {
  return doc.compatMode !== 'CSS1Compat';
}

export function isNamedItemAnElement(item: Element | HTMLCollection): item is Element {
  return (item as { nodeType?: unknown; }).nodeType === 1;
}
