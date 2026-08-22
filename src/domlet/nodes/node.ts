import { domExceptionName } from '../../shared/dom-exception';
import {
  type EventTargetVirtuals, EventTargetImpl,
} from '../events/event-target';
import { asDocument } from '../stubs/interfaces';
import {
  TreeNode, type TreeNodeVirtuals,
} from '../tree/tree-node';
import {
  defineDictionary, defineInterface, defineInterfaceMixin, emptyDictionary,
  idlType, nullable, reference,
} from '../../web-idl/definition';
import type { CommentImpl } from './comment';
import type { DocumentImpl } from './document';
import type { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import { HTMLCollectionImpl } from './collections';

/*
 * interface mixin ParentNode {
 *   [SameObject] readonly attribute HTMLCollection children;
 *   readonly attribute Element? firstElementChild;
 *   readonly attribute Element? lastElementChild;
 *   readonly attribute unsigned long childElementCount;
 *
 *   [CEReactions, Unscopable] undefined prepend((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined append((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined replaceChildren((Node or DOMString)... nodes);
 *
 *   [CEReactions] undefined moveBefore(Node node, Node? child);
 *
 *   Element? querySelector(DOMString selectors);
 *   [NewObject] NodeList querySelectorAll(DOMString selectors);
 * };
 * Document includes ParentNode;
 * DocumentFragment includes ParentNode;
 * Element includes ParentNode;
 */
export const parentNodeIDL = defineInterfaceMixin({
  members: [
    { kind: 'attribute', name: 'children', readonly: true, type: idlType.object },
    {
      kind: 'attribute', name: 'firstElementChild', readonly: true,
      type: nullable(reference('Element')),
    },
    {
      kind: 'attribute', name: 'lastElementChild', readonly: true,
      type: nullable(reference('Element')),
    },
    {
      kind: 'attribute', name: 'childElementCount', readonly: true,
      type: idlType.unsignedLong,
    },
  ],
  name: 'ParentNode',
});

/*
 * interface mixin DocumentOrShadowRoot {
 *   readonly attribute CustomElementRegistry? customElementRegistry;
 * };
 * Document includes DocumentOrShadowRoot;
 * ShadowRoot includes DocumentOrShadowRoot;
 */
export const documentOrShadowRootIDL = defineInterfaceMixin({
  members: [{
    kind: 'attribute', name: 'customElementRegistry', readonly: true,
    type: nullable(reference('CustomElementRegistry')),
  }],
  name: 'DocumentOrShadowRoot',
});

/*
 * interface mixin ChildNode {
 *   [CEReactions, Unscopable] undefined before((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined after((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined replaceWith((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined remove();
 * };
 * DocumentType includes ChildNode;
 * Element includes ChildNode;
 * CharacterData includes ChildNode;
 */
export const childNodeIDL = defineInterfaceMixin({
  members: [{
    arguments: [], kind: 'operation', name: 'remove',
    returns: idlType.undefined,
  }],
  name: 'ChildNode',
});

/*
 * interface mixin NonDocumentTypeChildNode {
 *   readonly attribute Element? previousElementSibling;
 *   readonly attribute Element? nextElementSibling;
 * };
 * Element includes NonDocumentTypeChildNode;
 * CharacterData includes NonDocumentTypeChildNode;
 */
export const nonDocumentTypeChildNodeIDL = defineInterfaceMixin({
  members: [
    {
      kind: 'attribute', name: 'previousElementSibling', readonly: true,
      type: nullable(reference('Element')),
    },
    {
      kind: 'attribute', name: 'nextElementSibling', readonly: true,
      type: nullable(reference('Element')),
    },
  ],
  name: 'NonDocumentTypeChildNode',
});

/*
 * dictionary GetRootNodeOptions {
 *   boolean composed = false;
 * };
 */
export const getRootNodeOptionsIDL = defineDictionary({
  members: [{ default: false, name: 'composed', type: idlType.boolean }],
  name: 'GetRootNodeOptions',
});

/*
 * [Exposed=Window]
 * interface Node : EventTarget {
 *   const unsigned short ELEMENT_NODE = 1;
 *   const unsigned short ATTRIBUTE_NODE = 2;
 *   const unsigned short TEXT_NODE = 3;
 *   const unsigned short CDATA_SECTION_NODE = 4;
 *   const unsigned short ENTITY_REFERENCE_NODE = 5; // legacy
 *   const unsigned short ENTITY_NODE = 6; // legacy
 *   const unsigned short PROCESSING_INSTRUCTION_NODE = 7;
 *   const unsigned short COMMENT_NODE = 8;
 *   const unsigned short DOCUMENT_NODE = 9;
 *   const unsigned short DOCUMENT_TYPE_NODE = 10;
 *   const unsigned short DOCUMENT_FRAGMENT_NODE = 11;
 *   const unsigned short NOTATION_NODE = 12; // legacy
 *   readonly attribute unsigned short nodeType;
 *   readonly attribute DOMString nodeName;
 *
 *   readonly attribute USVString baseURI;
 *
 *   readonly attribute boolean isConnected;
 *   readonly attribute Document? ownerDocument;
 *   Node getRootNode(optional GetRootNodeOptions options = {});
 *   readonly attribute Node? parentNode;
 *   readonly attribute Element? parentElement;
 *   boolean hasChildNodes();
 *   [SameObject] readonly attribute NodeList childNodes;
 *   readonly attribute Node? firstChild;
 *   readonly attribute Node? lastChild;
 *   readonly attribute Node? previousSibling;
 *   readonly attribute Node? nextSibling;
 *
 *   [CEReactions] attribute DOMString? nodeValue;
 *   [CEReactions] attribute DOMString? textContent;
 *   [CEReactions] undefined normalize();
 *
 *   [CEReactions, NewObject] Node cloneNode(optional boolean subtree = false);
 *   boolean isEqualNode(Node? otherNode);
 *   boolean isSameNode(Node? otherNode); // legacy alias of ===
 *
 *   const unsigned short DOCUMENT_POSITION_DISCONNECTED = 0x01;
 *   const unsigned short DOCUMENT_POSITION_PRECEDING = 0x02;
 *   const unsigned short DOCUMENT_POSITION_FOLLOWING = 0x04;
 *   const unsigned short DOCUMENT_POSITION_CONTAINS = 0x08;
 *   const unsigned short DOCUMENT_POSITION_CONTAINED_BY = 0x10;
 *   const unsigned short DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 0x20;
 *   unsigned short compareDocumentPosition(Node other);
 *   boolean contains(Node? other);
 *
 *   DOMString? lookupPrefix(DOMString? namespace);
 *   DOMString? lookupNamespaceURI(DOMString? prefix);
 *   boolean isDefaultNamespace(DOMString? namespace);
 *
 *   [CEReactions] Node insertBefore(Node node, Node? child);
 *   [CEReactions] Node appendChild(Node node);
 *   [CEReactions] Node replaceChild(Node node, Node child);
 *   [CEReactions] Node removeChild(Node child);
 * };
 */
export const nodeIDL = defineInterface({
  exposed: ['Window'],
  inherits: 'EventTarget',
  members: [
    { kind: 'attribute', name: 'nodeType', readonly: true, type: idlType.unsignedShort },
    { kind: 'attribute', name: 'baseURI', readonly: true, type: idlType.DOMString },
    {
      kind: 'attribute', name: 'ownerDocument', readonly: true,
      type: nullable(reference('Document')),
    },
    {
      kind: 'attribute', name: 'parentNode', readonly: true,
      type: nullable(reference('Node')),
    },
    {
      kind: 'attribute', name: 'parentElement', readonly: true,
      type: nullable(reference('Element')),
    },
    {
      kind: 'attribute', name: 'firstChild', readonly: true,
      type: nullable(reference('Node')),
    },
    {
      kind: 'attribute', name: 'lastChild', readonly: true,
      type: nullable(reference('Node')),
    },
    {
      kind: 'attribute', name: 'previousSibling', readonly: true,
      type: nullable(reference('Node')),
    },
    {
      kind: 'attribute', name: 'nextSibling', readonly: true,
      type: nullable(reference('Node')),
    },
    { kind: 'attribute', name: 'isConnected', readonly: true, type: idlType.boolean },
    {
      arguments: [{
        default: emptyDictionary,
        name: 'options',
        optional: true,
        type: reference('GetRootNodeOptions'),
      }],
      kind: 'operation',
      name: 'getRootNode',
      returns: reference('Node'),
    },
    {
      arguments: [{ name: 'node', type: reference('Node') }],
      kind: 'operation', name: 'appendChild', returns: reference('Node'),
    },
    {
      arguments: [
        { name: 'node', type: reference('Node') },
        { name: 'child', type: nullable(reference('Node')) },
      ],
      kind: 'operation', name: 'insertBefore', returns: reference('Node'),
    },
    {
      arguments: [{ name: 'other', type: nullable(reference('Node')) }],
      kind: 'operation', name: 'contains', returns: idlType.boolean,
    },
    {
      arguments: [{ name: 'other', type: reference('Node') }],
      kind: 'operation', name: 'compareDocumentPosition',
      returns: idlType.unsignedShort,
    },
  ],
  name: 'Node',
});

// ---------------------------------------------------------------------------------------

export abstract class NodeImpl
  extends TreeNode<NodeImpl>
{
  readonly #nodeType: NodeType;
  readonly #virtuals: NodeVirtuals;
  #document: DocumentImpl | null;

  constructor(
    nodeType: NodeType,
    ownerDocument: DocumentImpl | null = null,
    options: NodeOptions = {},
  ) {
    super(
      options.eventTargetVirtuals ?? nodeEventTargetVirtuals,
      options.treeVirtuals,
    );
    this.#nodeType = nodeType;
    this.#virtuals = options.virtuals ?? {};
    this.#document = ownerDocument;
  }

  get nodeType(): NodeType {
    return this.#nodeType;
  }

  get baseURI(): string {
    if (this.#virtuals.getBaseURI) {
      return this.#virtuals.getBaseURI(this);
    }

    return this.#document?.baseURI ?? 'about:blank';
  }

  get ownerDocument(): Document | null {
    if (isDocument(this)) return null;

    const root = super.getRoot();
    const document = isDocument(root) ? root : this.#document;
    return document ? asDocument(document) : null;
  }

  get parentNode(): NodeImpl | null {
    return super.parent;
  }

  get parentElement(): ElementImpl | null {
    const parent = super.parent;
    return isElement(parent) ? parent : null;
  }

  get firstElementChild(): ElementImpl | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (isElement(child)) return child;
    }

    return null;
  }

  get lastElementChild(): ElementImpl | null {
    for (let child = this.lastChild; child; child = child.previousSibling) {
      if (isElement(child)) return child;
    }

    return null;
  }

  get previousElementSibling(): ElementImpl | null {
    for (
      let sibling = this.previousSibling;
      sibling;
      sibling = sibling.previousSibling
    ) {
      if (isElement(sibling)) return sibling;
    }

    return null;
  }

  get nextElementSibling(): ElementImpl | null {
    for (
      let sibling = this.nextSibling;
      sibling;
      sibling = sibling.nextSibling
    ) {
      if (isElement(sibling)) return sibling;
    }

    return null;
  }

  get childElementCount(): number {
    let count = 0;

    for (let child = this.firstElementChild; child; child = child.nextElementSibling) {
      count++;
    }

    return count;
  }

  get children(): HTMLCollectionOf<Element> {
    const children = new HTMLCollectionImpl();

    for (let child = this.firstElementChild; child; child = child.nextElementSibling) {
      children.push(child);
    }

    return children;
  }

  get isConnected(): boolean {
    return isDocument(NodeImpl.getShadowIncludingRoot(this));
  }

  getRootNode(options?: GetRootNodeOptions): NodeImpl {
    return NodeImpl.getRootNode(this, options?.composed);
  }

  appendChild<T extends Node>(node: T): T {
    if (!NodeImpl.is(node)) {
      throw new DOMException('', domExceptionName.hierarchyRequest);
    }

    super.appendTreeChild(node);
    return node;
  }

  insertBefore<T extends Node>(node: T, child: Node | null): T {
    if (!NodeImpl.is(node)) {
      throw new DOMException('', domExceptionName.hierarchyRequest);
    }

    if (child === null) {
      super.appendTreeChild(node);
      return node;
    }

    if (!NodeImpl.is(child) || NodeImpl.getParentNode(child) !== this) {
      throw new DOMException('', domExceptionName.notFound);
    }

    TreeNode.insertSiblingBefore<NodeImpl>(
      child,
      node,
    );
    return node;
  }

  compareDocumentPosition(other: Node): number {
    if (!NodeImpl.is(other)) {
      return DOCUMENT_POSITION_DISCONNECTED |
        DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
    }

    const position = super.comparePosition(other);

    if (position === null) {
      return DOCUMENT_POSITION_DISCONNECTED |
        DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
    }

    if (position === 0) return 0;

    if (position < 0) {
      return this.contains(other)
        ? DOCUMENT_POSITION_FOLLOWING | DOCUMENT_POSITION_CONTAINED_BY
        : DOCUMENT_POSITION_FOLLOWING;
    }

    return other.contains(this)
      ? DOCUMENT_POSITION_PRECEDING | DOCUMENT_POSITION_CONTAINS
      : DOCUMENT_POSITION_PRECEDING;
  }

  // -- Friends ----------------------------------------------------------

  static is(value: unknown): value is NodeImpl {
    return typeof value === 'object' &&
      value !== null &&
      #document in value;
  }

  static isDefaultPassiveTarget(node: NodeImpl): boolean {
    const root = node.getRoot();
    const document = isDocument(root) ? root : node.#document;

    return document !== null && (
      node === document ||
      node === document.documentElement ||
      node === document.body
    );
  }

  static getEventParent(
    node: NodeImpl,
    _event: Event,
  ): EventTargetImpl | null {
    return NodeImpl.getParentNode(node);
  }

  static getParentNode(node: NodeImpl): NodeImpl | null {
    return TreeNode.getParent(node);
  }

  static getRootNode(node: NodeImpl, composed = false): NodeImpl {
    return composed
      ? NodeImpl.getShadowIncludingRoot(node)
      : TreeNode.getRoot(node);
  }

  static createEventTargetVirtuals(
    overrides: EventTargetVirtuals,
  ): EventTargetVirtuals {
    return { ...nodeEventTargetVirtuals, ...overrides };
  }

  static getNodeDocument(node: NodeImpl): DocumentImpl | null {
    return node.#document;
  }

  static setNodeDocument(
    node: NodeImpl,
    document: DocumentImpl,
  ): void {
    node.#document = document;
  }

  static getShadowIncludingRoot(node: NodeImpl): NodeImpl {
    let root = TreeNode.getRoot(node);
    let host = EventTargetImpl.getShadowRootHost(root);

    while (NodeImpl.is(host)) {
      root = TreeNode.getRoot(host);
      host = EventTargetImpl.getShadowRootHost(root);
    }

    return root;
  }

  static isShadowIncludingInclusiveAncestor(
    ancestor: NodeImpl,
    node: NodeImpl,
  ): boolean {
    let current = node;

    while (true) {
      if (ancestor.contains(current)) return true;

      const host = EventTargetImpl.getShadowRootHost(
        TreeNode.getRoot(current),
      );
      if (!NodeImpl.is(host)) return false;
      current = host;
    }
  }
}

// -- Virtual ------------------------------------------------------------
const nodeEventTargetVirtuals: EventTargetVirtuals = {
  isNode: (target) => NodeImpl.is(target),
  getTreeRoot: (target) => NodeImpl.is(target)
    ? TreeNode.getRoot(target)
    : null,
  isShadowIncludingInclusiveAncestor: (ancestor, target) =>
    NodeImpl.is(ancestor) &&
    NodeImpl.is(target) &&
    NodeImpl.isShadowIncludingInclusiveAncestor(ancestor, target),
  getParent: (target, event) =>
    NodeImpl.is(target) ? NodeImpl.getEventParent(target, event) : null,
  isDefaultPassiveTarget: (target) =>
    NodeImpl.is(target) && NodeImpl.isDefaultPassiveTarget(target),
};

export type NodeOptions = {
  readonly treeVirtuals?: TreeNodeVirtuals<NodeImpl>;
  readonly eventTargetVirtuals?: EventTargetVirtuals;
  readonly virtuals?: NodeVirtuals;
};

export type NodeVirtuals = {
  getBaseURI?(node: NodeImpl): string;
};

export enum NodeType {
  Element = 1,
  Text = 3,
  Comment = 8,
  Document = 9,
  DocumentType = 10,
  DocumentFragment = 11,
}

export function isElement(node: NodeImpl | null): node is ElementImpl {
  return node?.nodeType === NodeType.Element;
}

export function isText(node: NodeImpl | null): node is TextImpl {
  return node?.nodeType === NodeType.Text;
}

export function isComment(node: NodeImpl | null): node is CommentImpl {
  return node?.nodeType === NodeType.Comment;
}

export function isDocument(node: NodeImpl | null): node is DocumentImpl {
  return node?.nodeType === NodeType.Document;
}

export function isDocumentType(
  node: NodeImpl | null,
): node is DocumentTypeImpl {
  return node?.nodeType === NodeType.DocumentType;
}

const DOCUMENT_POSITION_DISCONNECTED = 0x01;
const DOCUMENT_POSITION_PRECEDING = 0x02;
const DOCUMENT_POSITION_FOLLOWING = 0x04;
const DOCUMENT_POSITION_CONTAINS = 0x08;
const DOCUMENT_POSITION_CONTAINED_BY = 0x10;
const DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 0x20;
