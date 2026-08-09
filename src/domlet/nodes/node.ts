import { TreeNode } from '../tree/tree-node';
import type { Comment } from './comment';
import type { Document } from './document';
import type { DocumentType } from './document-type';
import type { Element } from './element';
import type { Text } from './text';

export abstract class Node extends TreeNode {
  readonly #document: Document | null;

  abstract readonly nodeType: NodeType;

  constructor(ownerDocument: Document | null = null) {
    super();
    this.#document = ownerDocument;
  }

  get ownerDocument(): Document | null {
    if (isDocument(this)) return null;

    const root = this.getRoot();
    return isDocument(root) ? root : this.#document;
  }

  get parentNode(): Node | null {
    return isNode(this.parent) ? this.parent : null;
  }

  get parentElement(): Element | null {
    return isElement(this.parent) ? this.parent : null;
  }

  get firstElementChild(): Element | null {
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (isElement(child)) return child;
    }

    return null;
  }

  get lastElementChild(): Element | null {
    for (let child = this.lastChild; child; child = child.previousSibling) {
      if (isElement(child)) return child;
    }

    return null;
  }

  get previousElementSibling(): Element | null {
    for (
      let sibling = this.previousSibling;
      sibling;
      sibling = sibling.previousSibling
    ) {
      if (isElement(sibling)) return sibling;
    }

    return null;
  }

  get nextElementSibling(): Element | null {
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

  get children(): Element[] {
    const children: Element[] = [];

    for (let child = this.firstElementChild; child; child = child.nextElementSibling) {
      children.push(child);
    }

    return children;
  }

  get isConnected(): boolean {
    return isDocument(this.getRoot());
  }

  getRootNode(): Node {
    const root = this.getRoot();
    if (!isNode(root)) throw new Error('Domlet node has a non-node tree root');
    return root;
  }

  compareDocumentPosition(other: Node): number {
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

export function isNode(node: TreeNode | null): node is Node {
  return node !== null && 'nodeType' in node;
}

export function isElement(node: TreeNode | null): node is Element {
  return isNode(node) && node.nodeType === NodeType.Element;
}

export function isText(node: TreeNode | null): node is Text {
  return isNode(node) && node.nodeType === NodeType.Text;
}

export function isComment(node: TreeNode | null): node is Comment {
  return isNode(node) && node.nodeType === NodeType.Comment;
}

export function isDocument(node: TreeNode | null): node is Document {
  return isNode(node) && node.nodeType === NodeType.Document;
}

export function isDocumentType(node: TreeNode | null): node is DocumentType {
  return isNode(node) && node.nodeType === NodeType.DocumentType;
}

const DOCUMENT_POSITION_DISCONNECTED = 0x01;
const DOCUMENT_POSITION_PRECEDING = 0x02;
const DOCUMENT_POSITION_FOLLOWING = 0x04;
const DOCUMENT_POSITION_CONTAINS = 0x08;
const DOCUMENT_POSITION_CONTAINED_BY = 0x10;
const DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 0x20;
