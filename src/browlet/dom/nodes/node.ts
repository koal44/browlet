import type { EventTargetImpl } from '../events/event-target';
import type { EventImpl } from '../events/event';
import type { DOMEnvironment } from '../environment';
import { TreeNode } from '../infra/tree';
import {
  arg, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, nullable,
  op, reference, roAttr,
} from '../../../web-idl/index';
import type { CharacterDataImpl } from './character-data';
import type { CommentImpl } from './comment';
import type { DocumentImpl } from './document';
import type { DocumentFragmentImpl } from './document-fragment';
import type { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import { ensurePreInsertValidity } from './mutation';

/** Base tree node with document ownership, navigation, and event ancestry. */
// https://dom.spec.whatwg.org/#interface-node
export abstract class NodeImpl extends TreeNode<NodeImpl> {
  /** Node kind used by the DOM's type-specific algorithms. */
  nodeType: NodeType;
  /** Associated document; a document node refers to itself. */
  // https://dom.spec.whatwg.org/#concept-node-document
  nodeDocument: DocumentImpl | null;

  constructor(
    nodeType: NodeType,
    ownerDoc: DocumentImpl | null,
    env: DOMEnvironment,
  ) {
    super(env);
    this.nodeType = nodeType;
    this.nodeDocument = ownerDoc;
  }

  static is(value: unknown): value is NodeImpl {
    return value instanceof NodeImpl;
  }

  /** Serialized base URL used to resolve relative URLs for this node. */
  // https://dom.spec.whatwg.org/#dom-node-baseuri
  get baseURI(): string {
    return this.nodeDocument?.baseURI ?? 'about:blank';
  }

  /** Owning document exposed to JavaScript; null for document nodes. */
  // https://dom.spec.whatwg.org/#dom-node-ownerdocument
  get ownerDocument(): DocumentImpl | null {
    if (this.isDocument()) return null;

    const root = super.getRoot();
    return root.isDocument() ? root : this.nodeDocument;
  }

  // https://dom.spec.whatwg.org/#dom-node-parentnode
  get parentNode(): NodeImpl | null {
    return super.parent;
  }

  /** Immediate parent when it is an element; does not search ancestors. */
  // https://dom.spec.whatwg.org/#dom-node-parentelement
  get parentElement(): ElementImpl | null {
    const parent = super.parent;
    return parent?.isElement() ? parent : null;
  }

  /** Whether the node belongs to a document, including through shadow hosts. */
  // https://dom.spec.whatwg.org/#dom-node-isconnected
  get isConnected(): boolean {
    return this.getShadowIncludingRoot().isDocument();
  }

  /** Return the tree root, crossing shadow hosts when composed is true. */
  // https://dom.spec.whatwg.org/#dom-node-getrootnode
  getRootNode(options?: GetRootNodeOptionsRecord): NodeImpl {
    return options?.composed ? this.getShadowIncludingRoot() : super.getRoot();
  }

  // https://dom.spec.whatwg.org/#dom-node-appendchild
  appendChild<T extends NodeImpl>(node: T): T {
    ensurePreInsertValidity(node, this, null, []);
    super.appendTreeChild(node);
    return node;
  }

  // https://dom.spec.whatwg.org/#dom-node-insertbefore
  insertBefore<T extends NodeImpl>(node: T, child: NodeImpl | null): T {
    ensurePreInsertValidity(node, this, child, []);
    if (child === null) {
      super.appendTreeChild(node);
      return node;
    }

    child.insertTreeSiblingBefore(node);
    return node;
  }

  /** Describe the other node's position relative to this node as DOM flags. */
  // https://dom.spec.whatwg.org/#dom-node-comparedocumentposition
  compareDocumentPosition(other: NodeImpl): number {
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

  // -- Internal ---------------------------------------------------------

  /** Concatenate direct Text children in tree order, excluding nested descendants. */
  // https://dom.spec.whatwg.org/#concept-child-text-content
  getChildTextContent(): string {
    let content = '';
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (child.isText()) content += child.data;
    }
    return content;
  }

  // Tag checks keep the base node module independent of its subclasses.
  isElement(): this is ElementImpl {
    return this.nodeType === NodeType.Element;
  }

  isText(): this is TextImpl {
    return this.nodeType === NodeType.Text || this.nodeType === NodeType.CDATASection;
  }

  isCharacterData(): this is CharacterDataImpl {
    return this.isText() || this.isComment() || this.nodeType === NodeType.ProcessingInstruction;
  }

  isComment(): this is CommentImpl {
    return this.nodeType === NodeType.Comment;
  }

  isDocument(): this is DocumentImpl {
    return this.nodeType === NodeType.Document;
  }

  isDocumentFragment(): this is DocumentFragmentImpl {
    return this.nodeType === NodeType.DocumentFragment;
  }

  isDocumentType(): this is DocumentTypeImpl {
    return this.nodeType === NodeType.DocumentType;
  }

  protected override isDefaultPassiveTarget(this: NodeImpl): boolean {
    const root = this.getRoot();
    const document = root.isDocument() ? root : this.nodeDocument;

    return document !== null && (
      this === document ||
      this === document.documentElement ||
      this === document.body
    );
  }

  override getEventParent(_event: EventImpl): EventTargetImpl | null {
    return this.parentNode;
  }

  override getTreeRoot(): NodeImpl {
    return this.getRoot();
  }

  override isNode(): boolean {
    return true;
  }

  override hasShadowIncludingInclusiveAncestor(ancestor: EventTargetImpl): boolean {
    return NodeImpl.is(ancestor) && ancestor.isShadowIncludingInclusiveAncestor(this);
  }

  /** Find the outermost tree root by following shadow hosts. */
  // https://dom.spec.whatwg.org/#concept-shadow-including-root
  getShadowIncludingRoot(): NodeImpl {
    let root = this.getRoot();
    let host = root.getShadowRootHost();

    while (NodeImpl.is(host)) {
      root = host.getRoot();
      host = root.getShadowRootHost();
    }

    return root;
  }

  /** Test ancestry including this node and any intervening shadow hosts. */
  // https://dom.spec.whatwg.org/#concept-shadow-including-inclusive-ancestor
  isShadowIncludingInclusiveAncestor(node: NodeImpl): boolean {
    let current = node;

    while (true) {
      if (this.contains(current)) return true;

      const host = current.getRoot().getShadowRootHost();
      if (!NodeImpl.is(host)) return false;
      current = host;
    }
  }
}

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
// PROVISIONAL: only a subset of the interface above is implemented and bound.
// Missing members, including textContent and nodeValue, follow ROADMAP.md's section 4 slices.
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
    op('getRootNode', reference('Node'), [
      arg('options', reference('GetRootNodeOptions'), {
        default: emptyDictionary, optional: true,
      }),
    ]),
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

/** Select whether root lookup crosses shadow hosts. */
export type GetRootNodeOptionsRecord = {
  composed?: boolean;
};

/*
 * dictionary GetRootNodeOptions {
 *   boolean composed = false;
 * };
 */
export const getRootNodeOptionsIDL = defineDictionary({
  name: 'GetRootNodeOptions',
  members: [dictMember('composed', idlType.boolean, { default: false })],
});

/** Numeric DOM node kinds used by implementation guards and platform constants. */
// https://dom.spec.whatwg.org/#dom-node-nodetype
export enum NodeType {
  Element = 1,
  Attribute = 2,
  Text = 3,
  CDATASection = 4,
  ProcessingInstruction = 7,
  Comment = 8,
  Document = 9,
  DocumentType = 10,
  DocumentFragment = 11,
}

const DOCUMENT_POSITION_DISCONNECTED = 0x01;
const DOCUMENT_POSITION_PRECEDING = 0x02;
const DOCUMENT_POSITION_FOLLOWING = 0x04;
const DOCUMENT_POSITION_CONTAINS = 0x08;
const DOCUMENT_POSITION_CONTAINED_BY = 0x10;
const DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 0x20;
