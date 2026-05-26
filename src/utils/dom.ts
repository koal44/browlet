const ELEMENT_NODE = 1;
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

export function isElement(n: Node): n is Element {
  return n.nodeType === ELEMENT_NODE;
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

export function isHtmlElement(e: Element): e is HTMLElement {
  return e.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export function isSvgElement(e: Element): e is SVGElement {
  return e.namespaceURI === 'http://www.w3.org/2000/svg';
}

export function isMathElement(e: Element): e is MathMLElement {
  return e.namespaceURI === 'http://www.w3.org/1998/Math/MathML';
}

export function isHtmlSvgOrMathElement(e: Element): e is HTMLElement | SVGElement | MathMLElement {
  return isHtmlElement(e) || isSvgElement(e) || isMathElement(e);
}

export function isHtmlMediaElement(e: Element): e is HTMLMediaElement {
  return 'currentTime' in e && 'paused' in e && 'ended' in e && 'readyState' in e;
}

export function isIFrame(e: Element): e is HTMLIFrameElement {
  return e.localName === 'iframe';
}

export function isHtmlInput(e: Element): e is HTMLInputElement {
  return e.localName === 'input';
}

export function isHtmlButton(e: Element): e is HTMLButtonElement {
  return e.localName === 'button';
}

export type FormStateElement = HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLOptGroupElement | HTMLOptionElement | HTMLSelectElement | HTMLTextAreaElement;
const FORM_STATE_ELEMENTS = new Set(['button', 'fieldset', 'input', 'optgroup', 'option', 'select', 'textarea']);
export function isFormStateElement(e: Element): e is FormStateElement {
  return FORM_STATE_ELEMENTS.has(e.localName);
}

export function isHtmlTextArea(e: Element): e is HTMLTextAreaElement {
  return e.localName === 'textarea';
}

export function isHtmlFieldSet(e: Element): e is HTMLFieldSetElement {
  return e.localName === 'fieldset';
}

export function isHtmlLegend(e: Element): e is HTMLLegendElement {
  return e.localName === 'legend';
}

export function isHtmlOptGroup(e: Element): e is HTMLOptGroupElement {
  return e.localName === 'optgroup';
}

export function isHtmlOption(e: Element): e is HTMLOptionElement {
  return e.localName === 'option';
}

export function isHtmlProgress(e: Element): e is HTMLProgressElement {
  return e.localName === 'progress';
}

export function isHtmlSelect(e: Element): e is HTMLSelectElement {
  return e.localName === 'select';
}

export function isHtmlForm(e: Element): e is HTMLFormElement {
  return e.localName === 'form';
}

export type ValidityElement =
  HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLObjectElement |
  HTMLOutputElement | HTMLSelectElement | HTMLTextAreaElement;

export function isValidityElement(e: Element): e is ValidityElement {
  return 'willValidate' in e;
}

export function isNamedItemAnElement(item: Element | HTMLCollection): item is Element {
  return (item as { nodeType?: unknown; }).nodeType === 1;
}

export function getIdAttr(e: Element): string {
  const v = e.id;
  return typeof v === 'string' ? v : e.getAttribute('id') || '';
}

export function getClassAttr(e: Element): string {
  const v = e.className;
  return typeof v === 'string' ? v : e.getAttribute('class') || '';
}
