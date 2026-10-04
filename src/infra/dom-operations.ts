/** A host node whose representation is private to its DOM operations. */
export type DOMNode = object & {
  [nodeRole]?: 'element' | 'document' | 'fragment' | 'shadow-root' | 'processing-instruction' | 'other';
};
export type DOMElement = DOMNode & { [nodeRole]?: 'element'; };
export type DOMDocument = DOMNode & { [nodeRole]?: 'document'; };
export type DOMDocumentFragment = DOMNode & { [nodeRole]?: 'fragment' | 'shadow-root'; };
export type DOMShadowRoot = DOMDocumentFragment & { [nodeRole]?: 'shadow-root'; };
export type DOMProcessingInstruction = DOMNode & { [nodeRole]?: 'processing-instruction'; };
export type DOMParentNode = DOMDocument | DOMElement | DOMDocumentFragment;
export type DOMQueryRoot = DOMParentNode;

// These optional, type-only roles distinguish opaque nodes inside the engines.
// Hosts need not define the symbol or add properties to their node objects.
declare const nodeRole: unique symbol;

/** Indexed collections may be live; engines request a copy when stability is needed. */
export interface DOMCollection<E extends object = DOMElement> extends Iterable<E> {
  length: number;
  item?(index: number): E | null;
  [index: number]: E | undefined;
}

/** DOM access shared by the selector and style engines, without changing node identity. */
export interface DOMOperations<
  N extends object = DOMNode, E extends N = N & DOMElement, A extends object = object,
  D extends N = N & DOMDocument, F extends N = N & DOMDocumentFragment,
  S extends F = F & DOMShadowRoot,
> {
  isNode(value: unknown): value is N;
  isElement(node: N): node is E;
  isDocument(node: N): node is D;
  isDocumentFragment(node: N): node is F;
  isText(node: N): boolean;
  isShadowRoot(node: N): node is S;
  isConnected(node: N): boolean;
  isHTMLElement(element: E): boolean;
  isHTMLDocument(document: D): boolean;
  isQuirksMode(document: D): boolean;

  /** The document owning this node; null only when the node is itself a document. */
  ownerDocument(node: N): D | null;
  root(node: N): N;
  parentNode(node: N): D | E | F | null;
  parentElement(node: N): E | null;
  firstChild(node: N): N | null;
  nextSibling(node: N): N | null;
  firstElementChild(node: D | E | F): E | null;
  lastElementChild(node: D | E | F): E | null;
  nextElementSibling(element: E): E | null;
  previousElementSibling(element: E): E | null;
  childElementCount(node: D | E | F): number;
  contains(node: N, other: N | null): boolean;
  compareDocumentPosition(node: N, other: N): number;
  shadowHost(root: S): E;
  textData(text: N): string;
  documentElement(document: D): E | null;
  body(document: D): E | null;
  URL(document: D): string;
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

  getElementById(root: D | F, id: string): E | null;
  getElementsByTagName(root: D | E, name: string): DOMCollection<E>;
  getElementsByTagNameNS(root: D | E, namespace: string | null, name: string): DOMCollection<E>;
  getElementsByClassName(root: D | E, names: string): DOMCollection<E>;
  hasDocumentAll(document: D): boolean;
  allNamedItem(document: D, name: string): E | DOMCollection<E> | null;
  /** Optional native traversal of descendant elements, excluding the root. */
  walkElements?(root: N): Iterable<E>;
  /** Optional complete, document-ordered indexes; never omit duplicate IDs. */
  cachedIds?(root: N, id: string): Iterable<E>;
  cachedClasses?(root: N, classes: string[]): Iterable<E>;
  /** An increasing version covering all mutations relevant to selector caches. */
  treeVersion?(root: N): number | undefined;
  /** Exposes a host collection's existing array, when available. */
  collectionArray?(collection: DOMCollection<E>): E[] | null;

  designMode(document: D): string | undefined;
  hasFocus(document: D): boolean;
  activeElement(document: D): E | null;
  isDefined(document: D, name: string): boolean;
  hasCustomState(element: E, name: string): boolean;
  /** Observe a capture-phase event, supplying its original node target. */
  listen(document: D, type: string, listener: (target: N | null) => void): void;

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
