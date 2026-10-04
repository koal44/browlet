import type {
  DOMOperations, DOMNode, DOMElement, DOMDocument, DOMDocumentFragment,
} from '../../src/infra/dom-operations';
import { standardDOM, type StandardProcessingInstruction } from '../../src/infra/dom-standard';
import { createSelectlet } from '../../src/selectlet/selectlet';

// Compile-only contracts. The functions are never executed.
export function opaqueNodeRoles(
  dom: DOMOperations, node: DOMNode, element: DOMElement,
  document: DOMDocument, fragment: DOMDocumentFragment,
): void {
  dom.getElementById(document, 'target');
  dom.getElementById(fragment, 'target');
  dom.getElementsByTagName(document, 'span');
  dom.getElementsByTagName(element, 'span');
  dom.firstElementChild(fragment);

  // @ts-expect-error ID lookup requires a document or fragment.
  dom.getElementById(element, 'target');
  // @ts-expect-error A fragment has no native tag-name collection lookup.
  dom.getElementsByTagName(fragment, 'span');
  // @ts-expect-error An arbitrary node is not known to be a document.
  dom.documentElement(node);
  // @ts-expect-error Documents are not elements.
  dom.getAttribute(document, 'id');
  // @ts-expect-error An ordinary fragment has no shadow host.
  dom.shadowHost(fragment);

  if (dom.isDocument(node)) dom.documentElement(node);
  if (dom.isDocumentFragment(node)) dom.getElementById(node, 'target');
  if (dom.isElement(node)) dom.getAttribute(node, 'id');
  if (dom.isShadowRoot(node)) dom.shadowHost(node);

  const query = createSelectlet(document, { dom });
  const result: DOMElement | null = query.first('span', fragment);
  void result;
  // @ts-expect-error Query roots must be documents, elements, or fragments.
  query.first('span', node);
}

type HostNode = { kind: 'document' | 'element' | 'fragment' | 'text'; };
type HostElement = HostNode & { kind: 'element'; elementState: string; };
type HostDocument = HostNode & { kind: 'document'; documentState: string; };
type HostFragment = HostNode & { kind: 'fragment'; fragmentState: string; };
type HostAttribute = { attributeState: string; };

export function customHostTypes(
  dom: DOMOperations<HostNode, HostElement, HostAttribute, HostDocument, HostFragment>,
  document: HostDocument, element: HostElement, fragment: HostFragment,
): void {
  const query = createSelectlet(document, { dom });
  const result: HostElement | null = query.first('span', fragment);
  const owner: HostDocument | null = dom.ownerDocument(element);
  void result;
  void owner;
  // @ts-expect-error Custom hosts retain their document/element distinction too.
  dom.getElementById(element, 'target');
  // @ts-expect-error A document cannot be used as the matches receiver.
  query.matches('span', document);
}

export function browserTypes(document: Document): void {
  const instruction: StandardProcessingInstruction = document.createProcessingInstruction('xml-stylesheet', 'href="style.css"');
  void instruction;
  standardDOM.getElementById(document, 'target');
  standardDOM.getElementById(document.createDocumentFragment(), 'target');
  // @ts-expect-error The standard adapter also rejects an element ID-lookup receiver.
  standardDOM.getElementById(document.createElement('div'), 'target');

  const query = createSelectlet(document);
  const result: Element | null = query.first('span');
  result?.querySelector('span');
  query.matches('circle', document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
  query.first('span', document.createDocumentFragment());
  // @ts-expect-error Text nodes cannot supply a query root.
  query.first('span', document.createTextNode('text'));
}
