import { HTML_NAMESPACE } from './namespaces';

/** A host node whose representation is private to its DOM operations. */
export type DOMNode = object;

/** Indexed collections may be live; engines request a copy when stability is needed. */
export interface DOMCollection<E extends object = object> extends Iterable<E> {
  length: number;
  item?(index: number): E | null;
  [index: number]: E | undefined;
}

/** DOM access shared by the selector and style engines, without changing node identity. */
export interface DOMOperations<N extends object = object, E extends N = N, A extends object = object> {
  isNode(value: unknown): value is N;
  isElement(node: N): node is E;
  isDocument(node: N): boolean;
  isDocumentFragment(node: N): boolean;
  isText(node: N): boolean;
  isShadowRoot(node: N): boolean;
  isConnected(node: N): boolean;
  isHTMLElement(element: E): boolean;
  isHTMLDocument(document: N): boolean;
  isQuirksMode(document: N): boolean;

  ownerDocument(node: N): N | null;
  root(node: N): N;
  parentNode(node: N): N | null;
  parentElement(node: N): E | null;
  firstChild(node: N): N | null;
  nextSibling(node: N): N | null;
  firstElementChild(node: N): E | null;
  lastElementChild(node: N): E | null;
  nextElementSibling(element: E): E | null;
  previousElementSibling(element: E): E | null;
  childElementCount(node: N): number;
  contains(node: N, other: N | null): boolean;
  compareDocumentPosition(node: N, other: N): number;
  shadowHost(root: N): E;
  textData(text: N): string;
  documentElement(document: N): E | null;
  body(document: N): E | null;
  URL(document: N): string;
  baseURI(node: N): string;

  getId(element: E): string;
  getClass(element: E): string;
  getLocalName(element: E): string;
  getNamespaceURI(element: E): string | null;
  getAttribute(element: E, name: string): string | null;
  getAttributeNS(element: E, namespace: string | null, name: string): string | null;
  hasAttribute(element: E, name: string): boolean;
  hasAttributeNS(element: E, namespace: string | null, name: string): boolean;
  setAttribute(element: E, name: string, value: string): void;
  removeAttribute(element: E, name: string): void;
  attributes(element: E): Iterable<A>;
  attributeLocalName(attribute: A): string;
  attributeNamespaceURI(attribute: A): string | null;
  attributeValue(attribute: A): string;
  /** Existing inline-style state, when the host uses a style implementation directly. */
  inlineStyle?(element: E): object | null;

  getElementById(root: N, id: string): E | null;
  getElementsByTagName(root: N, name: string): DOMCollection<E>;
  getElementsByTagNameNS(root: N, namespace: string | null, name: string): DOMCollection<E>;
  getElementsByClassName(root: N, names: string): DOMCollection<E>;
  hasDocumentAll(document: N): boolean;
  allNamedItem(document: N, name: string): E | DOMCollection<E> | null;
  /** Optional native traversal of descendant elements, excluding the root. */
  walkElements?(root: N): Iterable<E>;
  /** Optional complete, document-ordered indexes; never omit duplicate IDs. */
  cachedIds?(root: N, id: string): Iterable<E>;
  cachedClasses?(root: N, classes: string[]): Iterable<E>;
  /** An increasing version covering all mutations relevant to selector caches. */
  treeVersion?(root: N): number | undefined;
  /** Exposes a host collection's existing array, when available. */
  collectionArray?(collection: DOMCollection<E>): E[] | null;

  designMode(document: N): string | undefined;
  hasFocus(document: N): boolean;
  activeElement(document: N): E | null;
  isDefined(document: N, name: string): boolean;
  hasCustomState(element: E, name: string): boolean;
  /** Observe a capture-phase event, supplying its original node target. */
  listen(document: N, type: string, listener: (target: N | null) => void): void;

  // Live HTML control and media state; these are not attribute fallbacks.
  controlType(element: E): string;
  controlValue(element: E): string;
  formOwner(element: E): E | null;
  checked(element: E): boolean;
  selected(element: E): boolean;
  indeterminate(element: E): boolean;
  supportsValidity(element: E): boolean;
  willValidate(element: E): boolean;
  checkValidity(element: E): boolean;
  rangeUnderflow(element: E): boolean;
  rangeOverflow(element: E): boolean;
  isMediaElement(element: E): boolean;
  currentTime(element: E): number;
  paused(element: E): boolean;
  ended(element: E): boolean;
  readyState(element: E): number;
  seeking(element: E): boolean;
  muted(element: E): boolean;

  /** A readable node description for selector diagnostics. */
  describe(node: N): string;
}

/** DOM operations for platform objects implementing the ordinary browser DOM API. */
export const standardDOM: DOMOperations<Node, Element, Attr> = {
  isNode: (value): value is Node => !!value && typeof value === 'object' &&
    'nodeType' in value && typeof value.nodeType === 'number' && 'nodeName' in value,
  isElement: (node): node is Element => node.nodeType === 1,
  isDocument: (node) => node.nodeType === 9,
  isDocumentFragment: (node) => node.nodeType === 11,
  isText: (node) => node.nodeType === 3,
  isShadowRoot: (node) => node.nodeType === 11 && 'host' in node && node.host !== null,
  isConnected: (node) => node.isConnected,
  isHTMLElement: (element) => element.namespaceURI === HTML_NAMESPACE,
  isHTMLDocument: (document) => (document as Document).contentType.includes('/html') ||
    (document as Document).createElement('DiV').localName === 'div',
  isQuirksMode: (document) => (document as Document).compatMode !== 'CSS1Compat',

  ownerDocument: (node) => node.ownerDocument,
  root: (node) => node.getRootNode(),
  parentNode: (node) => node.parentNode,
  parentElement: (node) => node.parentElement,
  firstChild: (node) => node.firstChild,
  nextSibling: (node) => node.nextSibling,
  firstElementChild: (node) => (node as ParentNode).firstElementChild,
  lastElementChild: (node) => (node as ParentNode).lastElementChild,
  nextElementSibling: (element) => element.nextElementSibling,
  previousElementSibling: (element) => element.previousElementSibling,
  childElementCount: (node) => (node as ParentNode).childElementCount,
  contains: (node, other) => node.contains(other),
  compareDocumentPosition: (node, other) => node.compareDocumentPosition(other),
  shadowHost: (root) => (root as ShadowRoot).host,
  textData: (text) => (text as Text).data,
  documentElement: (document) => (document as Document).documentElement,
  body: (document) => (document as Document).body,
  URL: (document) => (document as Document).URL,
  baseURI: (node) => node.baseURI,

  getId: (element) => typeof element.id === 'string' ? element.id : element.getAttribute('id') ?? '',
  getClass: (element) => typeof element.className === 'string' ? element.className : element.getAttribute('class') ?? '',
  getLocalName: (element) => element.localName,
  getNamespaceURI: (element) => element.namespaceURI,
  getAttribute: (element, name) => element.getAttribute(name),
  getAttributeNS: (element, namespace, name) => element.getAttributeNS(namespace, name),
  hasAttribute: (element, name) => element.hasAttribute(name),
  hasAttributeNS: (element, namespace, name) => element.hasAttributeNS(namespace, name),
  setAttribute: (element, name, value) => element.setAttribute(name, value),
  removeAttribute: (element, name) => element.removeAttribute(name),
  attributes: (element) => element.attributes,
  attributeLocalName: (attribute) => attribute.localName,
  attributeNamespaceURI: (attribute) => attribute.namespaceURI,
  attributeValue: (attribute) => attribute.value,

  getElementById: (root, id) => (root as Document | DocumentFragment).getElementById(id),
  getElementsByTagName: (root, name) => (root as Document | Element).getElementsByTagName(name),
  getElementsByTagNameNS: (root, namespace, name) => (root as Document | Element).getElementsByTagNameNS(namespace, name),
  getElementsByClassName: (root, names) => (root as Document | Element).getElementsByClassName(names),
  hasDocumentAll: (document) => 'all' in document,
  allNamedItem: (document, name) => (document as Document).all.namedItem(name),
  *walkElements(root) {
    const document = root.nodeType === 9 ? root as Document : root.ownerDocument!;
    const walker = document.createTreeWalker(root, 1);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as Element;
  },

  designMode: (document) => (document as Document).designMode,
  hasFocus: (document) => (document as Document).hasFocus(),
  activeElement: (document) => (document as Document).activeElement,
  isDefined: (document, name) => !!(document as Document).defaultView?.customElements.get(name),
  // CustomStateSet has no public reverse lookup from its element.
  hasCustomState: () => false,
  listen: (document, type, listener) => {
    document.addEventListener(type, (event) => listener(standardDOM.isNode(event.target) ? event.target : null), true);
  },

  controlType: (element) => (element as HTMLInputElement | HTMLButtonElement).type,
  controlValue: (element) => (element as HTMLInputElement | HTMLTextAreaElement).value,
  formOwner: (element) => (element as HTMLInputElement | HTMLButtonElement).form,
  checked: (element) => (element as HTMLInputElement).checked,
  selected: (element) => (element as HTMLOptionElement).selected,
  indeterminate: (element) => (element as HTMLInputElement).indeterminate,
  supportsValidity: (element) => 'willValidate' in element,
  willValidate: (element) => (element as HTMLInputElement).willValidate,
  checkValidity: (element) => (element as HTMLInputElement | HTMLFormElement).checkValidity(),
  rangeUnderflow: (element) => (element as HTMLInputElement).validity.rangeUnderflow,
  rangeOverflow: (element) => (element as HTMLInputElement).validity.rangeOverflow,
  isMediaElement: (element) => 'currentTime' in element && 'paused' in element && 'ended' in element && 'readyState' in element,
  currentTime: (element) => (element as HTMLMediaElement).currentTime,
  paused: (element) => (element as HTMLMediaElement).paused,
  ended: (element) => (element as HTMLMediaElement).ended,
  readyState: (element) => (element as HTMLMediaElement).readyState,
  seeking: (element) => (element as HTMLMediaElement).seeking,
  muted: (element) => (element as HTMLMediaElement).muted,
  describe: (node) => node.nodeType === 1 ? (node as Element).outerHTML : node.textContent ?? '',
};
