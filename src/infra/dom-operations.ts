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
