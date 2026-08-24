import { domExceptionName } from '../../shared/dom-exception';
import {
  type EventTargetVirtuals, EventTargetImpl,
} from '../events/event-target';
import { asDocument } from '../stubs/interfaces';
import {
  TreeNode, type TreeNodeVirtuals,
} from '../tree/tree-node';
import {
  arg, defineDictionary, defineInterface, defineInterfaceMixin, dictMember,
  emptyDictionary, idlType, nullable, op, readonlyAttr, reference,
} from '../../web-idl/adapter/definition';
import { bind } from '../../web-idl/adapter/projection';
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
    readonlyAttr('children', idlType.object),
    readonlyAttr('firstElementChild', nullable(reference('Element'))),
    readonlyAttr('lastElementChild', nullable(reference('Element'))),
    readonlyAttr('childElementCount', idlType.unsignedLong),
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
  members: [readonlyAttr(
    'customElementRegistry',
    nullable(reference('CustomElementRegistry')),
  )],
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
  members: [op('remove', idlType.undefined)],
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
    readonlyAttr(
      'previousElementSibling',
      nullable(reference('Element')),
    ),
    readonlyAttr('nextElementSibling', nullable(reference('Element'))),
  ],
  name: 'NonDocumentTypeChildNode',
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
 *
 * dictionary GetRootNodeOptions {
 *   boolean composed = false;
 * };
 */
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

// -- Web IDL ------------------------------------------------------------

export const nodeIDL = defineInterface({
  binding: bind(NodeImpl),
  exposed: 'Window',
  inherits: 'EventTarget',
  members: [
    readonlyAttr('nodeType', idlType.unsignedShort),
    readonlyAttr('baseURI', idlType.DOMString),
    readonlyAttr('ownerDocument', nullable(reference('Document'))),
    readonlyAttr('parentNode', nullable(reference('Node'))),
    readonlyAttr('parentElement', nullable(reference('Element'))),
    readonlyAttr('firstChild', nullable(reference('Node'))),
    readonlyAttr('lastChild', nullable(reference('Node'))),
    readonlyAttr('previousSibling', nullable(reference('Node'))),
    readonlyAttr('nextSibling', nullable(reference('Node'))),
    readonlyAttr('isConnected', idlType.boolean),
    op('getRootNode', reference('Node'), [arg(
      'options',
      reference('GetRootNodeOptions'),
      {
        default: emptyDictionary,
        optional: true,
      },
    )]),
    op('appendChild', reference('Node'), [
      arg('node', reference('Node')),
    ]),
    op('insertBefore', reference('Node'), [
      arg('node', reference('Node')),
      arg('child', nullable(reference('Node'))),
    ]),
    op('contains', idlType.boolean, [
      arg('other', nullable(reference('Node'))),
    ]),
    op('compareDocumentPosition', idlType.unsignedShort, [
      arg('other', reference('Node')),
    ]),
  ],
  name: 'Node',
});

export const getRootNodeOptionsIDL = defineDictionary({
  members: [dictMember('composed', idlType.boolean, { default: false })],
  name: 'GetRootNodeOptions',
});

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
  Attribute = 2,
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
