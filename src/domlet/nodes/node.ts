import { domExceptionName } from '../../shared/dom-exception';
import { asDocument } from '../stubs/interfaces';
import { TreeNode } from '../tree/tree-node';
import type { CommentImpl } from './comment';
import type { DocumentImpl } from './document';
import type { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import { HTMLCollectionImpl } from './collections';

export abstract class NodeImpl
  extends TreeNode<NodeImpl>
{
  readonly #document: DocumentImpl | null;

  abstract readonly nodeType: NodeType;

  constructor(ownerDocument: DocumentImpl | null = null) {
    super();
    this.#document = ownerDocument;
  }

  get ownerDocument(): Document | null {
    const root = this.getRoot();
    const document = isDocument(root) ? root : this.#document;
    return document ? asDocument(document) : null;
  }

  get parentNode(): NodeImpl | null {
    return this.parent;
  }

  get parentElement(): ElementImpl | null {
    return isElement(this.parent) ? this.parent : null;
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
    return isDocument(this.getRoot());
  }

  protected override get isDefaultPassiveTarget(): boolean {
    const root = this.getRoot();
    const document = isDocument(root) ? root : this.#document;

    return document?.__isDefaultPassiveEventTarget(this) ?? false;
  }

  getRootNode(_options?: GetRootNodeOptions): NodeImpl {
    return this.getRoot();
  }

  appendChild<T extends Node>(node: T): T {
    if (!(node instanceof NodeImpl)) {
      throw new DOMException('', domExceptionName.hierarchyRequest);
    }

    super.appendTreeChild(node);
    return node;
  }

  insertBefore<T extends Node>(node: T, child: Node | null): T {
    if (!(node instanceof NodeImpl)) {
      throw new DOMException('', domExceptionName.hierarchyRequest);
    }

    if (child === null) {
      super.appendTreeChild(node);
      return node;
    }

    if (!(child instanceof NodeImpl) || child.parent !== this) {
      throw new DOMException('', domExceptionName.notFound);
    }

    child.insertTreeSiblingBefore(node);
    return node;
  }

  compareDocumentPosition(other: Node): number {
    if (!(other instanceof NodeImpl)) {
      return DOCUMENT_POSITION_DISCONNECTED |
        DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
    }

    const position = this.comparePosition(other);

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
}

export enum NodeType {
  Element = 1,
  Text = 3,
  Comment = 8,
  Document = 9,
  DocumentType = 10,
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
