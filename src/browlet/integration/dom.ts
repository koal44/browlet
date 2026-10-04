import { findElementById } from '../dom/nodes/lookups';
import type { DOMOperations } from '../../infra/index';
import { InternalError } from '../../infra/index';
import { NodeImpl } from '../dom/nodes/node';
import type { ElementImpl } from '../dom/nodes/element';
import type { AttrImpl } from '../dom/nodes/attribute';
import type { DocumentImpl } from '../dom/nodes/document';
import type { DocumentFragmentImpl } from '../dom/nodes/document-fragment';
import { ShadowRootImpl } from '../dom/nodes/shadow-root';
import type { TextImpl } from '../dom/nodes/text';
import { HTMLElementImpl } from '../html/elements/html-element';

/** Selector and style access to Browlet implementations, preserving their identities. */
export const browletDOM: DOMOperations<
  NodeImpl, ElementImpl, AttrImpl, DocumentImpl, DocumentFragmentImpl, ShadowRootImpl
> = {
  isNode: (value): value is NodeImpl => NodeImpl.is(value),
  isElement: (node): node is ElementImpl => node.isElement(),
  isDocument: (node): node is DocumentImpl => node.isDocument(),
  isDocumentFragment: (node): node is DocumentFragmentImpl => node.isDocumentFragment(),
  isText: (node) => node.isText(),
  isShadowRoot: (node): node is ShadowRootImpl => ShadowRootImpl.is(node),
  isConnected: (node) => node.isConnected,
  isHTMLElement: (element) => HTMLElementImpl.is(element),
  isHTMLDocument: (document) => document.type === 'html',
  isQuirksMode: (document) => document.compatMode !== 'CSS1Compat',

  ownerDocument: (node) => node.ownerDocument,
  root: (node) => node.getRootNode(),
  parentNode: (node) => node.parentNode as ParentImpl | null,
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
  textData: (text) => (text as TextImpl).data,
  documentElement: (document) => document.documentElement,
  body: (document) => document.body,
  URL: (document) => document.URL,
  baseURI: (node) => node.baseURI,

  getId: (element) => element.getAttribute('id') ?? '',
  getClass: (element) => element.getAttribute('class') ?? '',
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
  inlineStyle: (element) => 'style' in element ? element.getInlineStyle() : null,

  getElementById: (root, id) => findElementById(root, id),
  getElementsByTagName: (root, name) => root.getElementsByTagName(name),
  getElementsByTagNameNS: (root, namespace, name) => root.getElementsByTagNameNS(namespace, name),
  getElementsByClassName: (root, names) => root.getElementsByClassName(names),
  hasDocumentAll: () => false,
  allNamedItem: () => unavailable('Document.all'),

  designMode: () => unavailable('document editing mode'),
  hasFocus: () => unavailable('document focus'),
  activeElement: () => unavailable('the active element'),
  isDefined: () => unavailable('custom element definitions'),
  hasCustomState: () => unavailable('custom element states'),
  listen(document, type, listener) {
    document.addEventListener(type, (event) => listener(NodeImpl.is(event.target) ? event.target : null), true);
  },

  // HTML control and media implementations are still pending in Browlet.
  controlType: () => unavailable('control type'),
  controlValue: () => unavailable('control value'),
  formOwner: () => unavailable('form association'),
  checked: () => unavailable('checkedness'),
  selected: () => unavailable('selectedness'),
  indeterminate: () => unavailable('indeterminate state'),
  supportsValidity: () => unavailable('constraint validation'),
  willValidate: () => unavailable('constraint validation'),
  checkValidity: () => unavailable('constraint validation'),
  rangeUnderflow: () => unavailable('constraint validation'),
  rangeOverflow: () => unavailable('constraint validation'),
  isMediaElement: () => unavailable('media elements'),
  currentTime: () => unavailable('media playback'),
  paused: () => unavailable('media playback'),
  ended: () => unavailable('media playback'),
  readyState: () => unavailable('media playback'),
  seeking: () => unavailable('media playback'),
  muted: () => unavailable('media playback'),
  describe: (node) => node.isElement() ? `<${node.localName}>` : `#node(${node.nodeType})`,
};

type ParentImpl = DocumentImpl | ElementImpl | DocumentFragmentImpl;

function unavailable(feature: string): never {
  throw new InternalError(`Browlet has not implemented ${feature}.`);
}
