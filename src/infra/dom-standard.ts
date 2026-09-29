import type { DOMOperations } from './dom-operations';
import { HTML_NAMESPACE } from './namespaces';

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
