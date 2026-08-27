import {
  domExceptionName, throwDOMException,
} from '../../../shared/dom-exception';
import {
  type EventTargetVirtuals, EventTargetImpl,
} from '../events/event-target';
import {
  TreeNode, type TreeNodeVirtuals,
} from '../infra/tree';
import {
  arg, defineDictionary, defineInterface, dictMember, emptyDictionary,
  idlType, nullable, op, roAttr, reference,
} from '../../../web-idl/declaration/index';
import { impl } from '../../../web-idl/index';
import type { CommentImpl } from './comment';
import type { DocumentImpl } from './document';
import type { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import type { TextImpl } from './text';

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

  get ownerDocument(): DocumentImpl | null {
    if (isDocument(this)) return null;

    const root = super.getRoot();
    return isDocument(root) ? root : this.#document;
  }

  get parentNode(): NodeImpl | null {
    return super.parent;
  }

  get parentElement(): ElementImpl | null {
    const parent = super.parent;
    return isElement(parent) ? parent : null;
  }

  get isConnected(): boolean {
    return isDocument(NodeImpl.getShadowIncludingRoot(this));
  }

  getRootNode(options?: GetRootNodeOptions): NodeImpl {
    return NodeImpl.getRootNode(this, options?.composed);
  }

  appendChild<T extends Node>(node: T): T {
    if (!NodeImpl.is(node)) {
      throwDOMException(domExceptionName.hierarchyRequest);
    }

    super.appendTreeChild(node);
    return node;
  }

  insertBefore<T extends Node>(node: T, child: Node | null): T {
    if (!NodeImpl.is(node)) {
      throwDOMException(domExceptionName.hierarchyRequest);
    }

    if (child === null) {
      super.appendTreeChild(node);
      return node;
    }

    if (!NodeImpl.is(child) || NodeImpl.getParentNode(child) !== this) {
      throwDOMException(domExceptionName.notFound);
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
  name: 'Node',
  inherits: 'EventTarget',
  exposed: 'Window',
  implementation: impl(NodeImpl),
  members: [
    roAttr('nodeType', idlType.unsignedShort),
    roAttr('baseURI', idlType.DOMString),
    roAttr('ownerDocument', nullable(reference('Document'))),
    roAttr('parentNode', nullable(reference('Node'))),
    roAttr('parentElement', nullable(reference('Element'))),
    roAttr('firstChild', nullable(reference('Node'))),
    roAttr('lastChild', nullable(reference('Node'))),
    roAttr('previousSibling', nullable(reference('Node'))),
    roAttr('nextSibling', nullable(reference('Node'))),
    roAttr('isConnected', idlType.boolean),
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
});

export const getRootNodeOptionsIDL = defineDictionary({
  name: 'GetRootNodeOptions',
  members: [dictMember('composed', idlType.boolean, { default: false })],
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
