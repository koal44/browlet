import { HTML_NAMESPACE } from './namespaces';
import type { DOMOperations, DOMCollection } from './dom-operations';

/** DOM operations for platform objects implementing the ordinary browser DOM API. */
export const standardDOM: DOMOperations<
  StandardNode, StandardElement, StandardAttribute, StandardDocument, StandardDocumentFragment, StandardShadowRoot
> = {
  isNode: (value): value is StandardNode => !!value && typeof value === 'object' &&
    'nodeType' in value && typeof value.nodeType === 'number' && 'nodeName' in value,
  isElement: (node): node is StandardElement => node.nodeType === 1,
  isDocument: (node): node is StandardDocument => node.nodeType === 9,
  isDocumentFragment: (node): node is StandardDocumentFragment => node.nodeType === 11,
  isText: (node) => node.nodeType === 3,
  isShadowRoot: (node): node is StandardShadowRoot => node.nodeType === 11 && 'host' in node && node.host !== null,
  isConnected: (node) => node.isConnected,
  isHTMLElement: (element) => element.namespaceURI === HTML_NAMESPACE,
  isHTMLDocument: (document) => document.contentType.includes('/html') ||
    document.createElement('DiV').localName === 'div',
  isQuirksMode: (document) => document.compatMode !== 'CSS1Compat',

  ownerDocument: (node) => node.ownerDocument,
  root: (node) => node.getRootNode(),
  parentNode: (node) => node.parentNode as StandardDocument | StandardElement | StandardDocumentFragment | null,
  parentElement: (node) => node.parentElement,
  firstChild: (node) => node.firstChild,
  nextSibling: (node) => node.nextSibling,
  firstElementChild: (node) => node.firstElementChild,
  lastElementChild: (node) => node.lastElementChild,
  nextElementSibling: (element) => element.nextElementSibling,
  previousElementSibling: (element) => element.previousElementSibling,
  childElementCount: (node) => node.childElementCount,
  contains: (node, other) => node.contains(other),
  compareDocumentPosition: (node, other) => node.compareDocumentPosition(other),
  shadowHost: (root) => root.host,
  textData: (text) => (text as StandardText).data,
  documentElement: (document) => document.documentElement,
  body: (document) => document.body,
  URL: (document) => document.URL,
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

  getElementById: (root, id) => root.getElementById(id),
  getElementsByTagName: (root, name) => root.getElementsByTagName(name),
  getElementsByTagNameNS: (root, namespace, name) => root.getElementsByTagNameNS(namespace, name),
  getElementsByClassName: (root, names) => root.getElementsByClassName(names),
  hasDocumentAll: (document) => 'all' in document,
  allNamedItem: (document, name) => document.all.namedItem(name),
  *walkElements(root) {
    const document = root.nodeType === 9 ? root as StandardDocument : root.ownerDocument!;
    const walker = document.createTreeWalker(root, 1);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as StandardElement;
  },

  designMode: (document) => document.designMode,
  hasFocus: (document) => document.hasFocus(),
  activeElement: (document) => document.activeElement,
  isDefined: (document, name) => !!document.defaultView?.customElements.get(name),
  // CustomStateSet has no public reverse lookup from its element.
  hasCustomState: () => false,
  listen: (document, type, listener) => {
    document.addEventListener(type, (event) => listener(standardDOM.isNode(event.target) ? event.target : null), true);
  },

  controlType: (element) => (element as StandardFormControl).type,
  controlValue: (element) => (element as StandardFormControl).value,
  formOwner: (element) => (element as StandardFormControl).form,
  checked: (element) => (element as StandardInputElement).checked,
  selected: (element) => (element as StandardOptionElement).selected,
  indeterminate: (element) => (element as StandardInputElement).indeterminate,
  supportsValidity: (element) => 'willValidate' in element,
  willValidate: (element) => (element as StandardFormControl).willValidate,
  checkValidity: (element) => (element as StandardValidatableElement).checkValidity(),
  rangeUnderflow: (element) => (element as StandardFormControl).validity.rangeUnderflow,
  rangeOverflow: (element) => (element as StandardFormControl).validity.rangeOverflow,
  isMediaElement: (element) => 'currentTime' in element && 'paused' in element && 'ended' in element && 'readyState' in element,
  currentTime: (element) => (element as StandardMediaElement).currentTime,
  paused: (element) => (element as StandardMediaElement).paused,
  ended: (element) => (element as StandardMediaElement).ended,
  readyState: (element) => (element as StandardMediaElement).readyState,
  seeking: (element) => (element as StandardMediaElement).seeking,
  muted: (element) => (element as StandardMediaElement).muted,
  describe: (node) => node.nodeType === 1 ? (node as StandardElement).outerHTML : node.textContent ?? '',
};

/** Browser-shaped node view used only by the standard adapter. */
export interface StandardNode {
  nodeType: number;
  nodeName: string;
  isConnected: boolean;
  ownerDocument: StandardDocument | null;
  parentNode: (StandardNode & StandardParentNode) | null;
  parentElement: StandardElement | null;
  firstChild: StandardNode | null;
  nextSibling: StandardNode | null;
  baseURI: string;
  textContent: string | null;
  getRootNode(): StandardNode;
  contains(other: StandardNode | null): boolean;
  compareDocumentPosition(other: StandardNode): number;
}

/** Browser-shaped element view; form and media state have separate views below. */
export interface StandardElement extends StandardNode, StandardParentNode {
  id: string;
  className: string | object;
  localName: string;
  namespaceURI: string | null;
  nextElementSibling: StandardElement | null;
  previousElementSibling: StandardElement | null;
  attributes: Iterable<StandardAttribute>;
  outerHTML: string;
  getAttribute(name: string): string | null;
  getAttributeNS(namespace: string | null, name: string): string | null;
  hasAttribute(name: string): boolean;
  hasAttributeNS(namespace: string | null, name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getElementsByTagName(name: string): DOMCollection<StandardElement>;
  getElementsByTagNameNS(namespace: string | null, name: string): DOMCollection<StandardElement>;
  getElementsByClassName(names: string): DOMCollection<StandardElement>;
}

/** Browser-shaped document view, including the live state queried by selectors. */
export interface StandardDocument extends StandardNode, StandardParentNode {
  contentType: string;
  compatMode: string;
  documentElement: StandardElement | null;
  body: StandardElement | null;
  URL: string;
  designMode: string;
  activeElement: StandardElement | null;
  defaultView: { customElements: { get(name: string): unknown; }; } | null;
  all: { namedItem(name: string): StandardElement | DOMCollection<StandardElement> | null; };
  createElement(name: string): StandardElement;
  createDocumentFragment(): StandardDocumentFragment;
  createTreeWalker(root: StandardNode, whatToShow: number): { nextNode(): StandardNode | null; };
  hasFocus(): boolean;
  getElementById(id: string): StandardElement | null;
  getElementsByTagName(name: string): DOMCollection<StandardElement>;
  getElementsByTagNameNS(namespace: string | null, name: string): DOMCollection<StandardElement>;
  getElementsByClassName(names: string): DOMCollection<StandardElement>;
  addEventListener(type: string, listener: (event: { target: unknown; }) => void, capture: boolean): void;
}

/** Browser-shaped fragment view, also implemented by shadow roots. */
export interface StandardDocumentFragment extends StandardNode, StandardParentNode {
  getElementById(id: string): StandardElement | null;
}

/** Browser-shaped processing instruction, including XML stylesheet owners. */
export interface StandardProcessingInstruction extends StandardNode {
  target: string;
  data: string;
}

export interface StandardAttribute {
  localName: string;
  namespaceURI: string | null;
  value: string;
}

interface StandardParentNode {
  firstElementChild: StandardElement | null;
  lastElementChild: StandardElement | null;
  childElementCount: number;
}

interface StandardText extends StandardNode {
  data: string;
}

interface StandardShadowRoot extends StandardDocumentFragment {
  host: StandardElement;
}

interface StandardValidatableElement extends StandardElement {
  checkValidity(): boolean;
}

interface StandardFormControl extends StandardValidatableElement {
  type: string;
  value: string;
  form: StandardElement | null;
  willValidate: boolean;
  validity: { rangeUnderflow: boolean; rangeOverflow: boolean; };
}

interface StandardInputElement extends StandardFormControl {
  checked: boolean;
  indeterminate: boolean;
}

interface StandardOptionElement extends StandardElement {
  selected: boolean;
}

interface StandardMediaElement extends StandardElement {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  readyState: number;
  seeking: boolean;
  muted: boolean;
}
