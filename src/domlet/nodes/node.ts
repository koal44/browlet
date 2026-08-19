import { domExceptionName } from '../../shared/dom-exception';
import {
  eventTargetIDL, type EventTargetVirtuals, EventTargetImpl,
} from '../events/event-target';
import { asDocument } from '../stubs/interfaces';
import {
  TreeNode, type TreeNodeVirtuals,
} from '../tree/tree-node';
import {
  defineInterface, defineMixin, operation, readonlyAttribute,
} from '../../web-idl/binding';
import type { CommentImpl } from './comment';
import type { DocumentImpl } from './document';
import type { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import { HTMLCollectionImpl } from './collections';

export const parentNodeIDL = defineMixin({
  name: 'ParentNode',
  members: {
    children: readonlyAttribute(),
    firstElementChild: readonlyAttribute(),
    lastElementChild: readonlyAttribute(),
    childElementCount: readonlyAttribute(),
  },
});

export const documentOrShadowRootIDL = defineMixin({
  name: 'DocumentOrShadowRoot',
  members: {},
});

export const childNodeIDL = defineMixin({
  name: 'ChildNode',
  members: {
    remove: operation(),
  },
});

export const nonDocumentTypeChildNodeIDL = defineMixin({
  name: 'NonDocumentTypeChildNode',
  members: {
    previousElementSibling: readonlyAttribute(),
    nextElementSibling: readonlyAttribute(),
  },
});

export const nodeIDL = defineInterface({
  name: 'Node',
  parent: eventTargetIDL,
  exposed: ['Window'],
  members: {
    nodeType: readonlyAttribute(),
    baseURI: readonlyAttribute(),
    ownerDocument: readonlyAttribute(),
    parentNode: readonlyAttribute(),
    parentElement: readonlyAttribute(),
    firstChild: readonlyAttribute(),
    lastChild: readonlyAttribute(),
    previousSibling: readonlyAttribute(),
    nextSibling: readonlyAttribute(),
    isConnected: readonlyAttribute(),
    getRootNode: operation(),
    appendChild: operation(),
    insertBefore: operation(),
    contains: operation(),
    compareDocumentPosition: operation(),
  },
});

export abstract class NodeImpl
  extends TreeNode<NodeImpl>
{
  readonly #nodeType: NodeType;
  #document: DocumentImpl | null;
  readonly #baseURI: string | undefined;

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
    this.#document = ownerDocument;
    this.#baseURI = options.baseURI;
  }

  get nodeType(): NodeType {
    return this.#nodeType;
  }

  get baseURI(): string {
    return this.#baseURI ?? this.#document?.baseURI ?? 'about:blank';
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
    return options?.composed
      ? NodeImpl.getShadowIncludingRoot(this)
      : super.getRoot();
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

    if (!NodeImpl.is(child) || (child.parentNode as unknown) !== this) {
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
    return node.parentNode;
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
  readonly baseURI?: string;
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
