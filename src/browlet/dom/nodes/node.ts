// Mutable tree cursors start at this node and then advance; they do not capture this for callbacks.
/* eslint @typescript-eslint/no-this-alias: ["error", { "allowedNames": ["node", "descendant"] }] */
import { InternalError } from '../../../infra/internal-error';
import { XML_NAMESPACE, XMLNS_NAMESPACE } from '../../../infra/index';
import {
  arg, attr, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, nullable,
  constant, integer, op, reference, roAttr, xattr, DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/index';

import { EventTargetImpl, type EventImpl } from '../events/index';
import { RangeImpl } from '../ranges/index';
import { NodeIteratorImpl } from '../traversal/index';
import type { DOMEnvironment } from '../environment';

import type { CharacterDataImpl } from './character-data';
import { NodeListImpl } from './collections';
import type { AttrImpl } from './attribute';
import type { CommentImpl } from './comment';
import type { DocumentImpl } from './document';
import type { DocumentFragmentImpl } from './document-fragment';
import type { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import type { ProcessingInstructionImpl } from './processing-instruction';
import type { ShadowRootImpl } from './shadow-root';
import type { MutationObserverImpl, RegisteredObserver } from './mutation-observer';
import { MutationRecordImpl, type MutationType } from './mutation-record';
import type { CustomElementRegistryImpl } from './html/custom-elements/index';
import type { HTMLSlotElementImpl } from './html/index';

/** DOM node ownership, tree links, traversal, mutation, and event ancestry. */
// https://dom.spec.whatwg.org/#interface-node
export abstract class NodeImpl extends EventTargetImpl {
  /** Assign a stable ordering only to nodes used in disconnected comparisons. */
  static #nextDisconnectedOrder = 0;

  /** Node kind used by the DOM's type-specific algorithms. */
  nodeType: NodeType;
  /** Associated document; a document node refers to itself. */
  // https://dom.spec.whatwg.org/#concept-node-document
  nodeDocument!: DocumentImpl;
  /** Persistent and transient observer associations for this node. */
  // https://dom.spec.whatwg.org/#registered-observer-list
  registeredObserverList: RegisteredObserver[] = [];

  /** Lazily assigned implementation-specific position among disconnected nodes. */
  #disconnectedOrder: number | undefined;

  /** Stable live view, allocated only when childNodes is requested. */
  #childNodes: NodeListImpl | undefined;

  // Only the private storage operations below write these tree links.
  // Preserve node-link types when checking the emitted JavaScript.
  /** @type {NodeImpl | null} */
  #parent: NodeImpl | null = null;
  /** @type {NodeImpl | null} */
  #firstChild: NodeImpl | null = null;
  /** @type {NodeImpl | null} */
  #lastChild: NodeImpl | null = null;
  /** @type {NodeImpl | null} */
  #previousSibling: NodeImpl | null = null;
  /** @type {NodeImpl | null} */
  #nextSibling: NodeImpl | null = null;

  constructor(
    nodeType: NodeType,
    ownerDoc: DocumentImpl | null,
    env: DOMEnvironment,
  ) {
    super(env);
    this.nodeType = nodeType;
    // Document assigns itself immediately after super(); every other node has an owner.
    if (ownerDoc !== null) this.nodeDocument = ownerDoc;
  }

  static is(value: unknown): value is NodeImpl {
    return value instanceof NodeImpl;
  }

  /** Node-kind name, with HTML casing applied only to HTML elements in HTML documents. */
  // https://dom.spec.whatwg.org/#dom-node-nodename
  get nodeName(): string {
    if (this.isElement()) return this.tagName;
    if (this.isAttribute()) return this.name;
    if (this.isProcessingInstruction()) return this.target;
    if (this.isDocumentType()) return this.name;
    switch (this.nodeType) {
      case NodeType.Text: return '#text';
      case NodeType.CDATASection: return '#cdata-section';
      case NodeType.Comment: return '#comment';
      case NodeType.Document: return '#document';
      case NodeType.DocumentFragment: return '#document-fragment';
      default: throw new InternalError('Unknown node kind');
    }
  }

  /** Serialized base URL used to resolve relative URLs for this node. */
  // https://dom.spec.whatwg.org/#dom-node-baseuri
  get baseURI(): string {
    return this.nodeDocument.baseURI;
  }

  /** Whether the node belongs to a document, including through shadow hosts. */
  // https://dom.spec.whatwg.org/#dom-node-isconnected
  get isConnected(): boolean {
    return this.getShadowIncludingRoot().isDocument();
  }

  /** Owning document exposed to JavaScript; null for document nodes. */
  // https://dom.spec.whatwg.org/#dom-node-ownerdocument
  get ownerDocument(): DocumentImpl | null {
    return this.isDocument() ? null : this.nodeDocument;
  }

  // https://dom.spec.whatwg.org/#dom-node-parentnode
  get parentNode(): NodeImpl | null {
    return this.#parent;
  }

  /** Immediate parent when it is an element; does not search ancestors. */
  // https://dom.spec.whatwg.org/#dom-node-parentelement
  get parentElement(): ElementImpl | null {
    const parent = this.#parent;
    return parent?.isElement() ? parent : null;
  }

  // https://dom.spec.whatwg.org/#dom-node-childnodes
  get childNodes(): NodeListImpl {
    return this.#childNodes ??= new NodeListImpl(this);
  }

  get firstChild(): NodeImpl | null {
    return this.#firstChild;
  }

  get lastChild(): NodeImpl | null {
    return this.#lastChild;
  }

  get previousSibling(): NodeImpl | null {
    return this.#previousSibling;
  }

  get nextSibling(): NodeImpl | null {
    return this.#nextSibling;
  }

  /** Attribute or character data, and null for node kinds without a node value. */
  // https://dom.spec.whatwg.org/#dom-node-nodevalue
  get nodeValue(): string | null {
    if (this.isAttribute()) return this.value;
    if (this.isCharacterData()) return this.data;
    return null;
  }

  set nodeValue(value: string | null) {
    value ??= '';
    if (this.isAttribute()) this.value = value;
    else if (this.isCharacterData()) this.replaceData(0, this.length, value);
  }

  /** Descendant text for containers, or the value of an attribute or character-data node. */
  // https://dom.spec.whatwg.org/#dom-node-textcontent
  get textContent(): string | null {
    if (this.isElement() || this.isDocumentFragment()) return this.getDescendantTextContent();
    return this.nodeValue;
  }

  set textContent(value: string | null) {
    if (this.isElement() || this.isDocumentFragment()) this.stringReplaceAll(value ?? '');
    else this.nodeValue = value;
  }

  /** Return the tree root, crossing shadow hosts when composed is true. */
  // https://dom.spec.whatwg.org/#dom-node-getrootnode
  getRootNode(options?: GetRootNodeOptionsRecord): NodeImpl {
    return options?.composed ? this.getShadowIncludingRoot() : this.getRoot();
  }

  /** Remove empty exclusive Text descendants and merge adjacent ones, preserving live ranges. */
  // https://dom.spec.whatwg.org/#dom-node-normalize
  normalize(): void {
    let node = this.firstChild;
    while (node !== null) {
      if (!node.isExclusiveText()) {
        node = node.nextDescendant(this);
        continue;
      }
      const length = node.length;
      if (length === 0) {
        const next = node.nextDescendant(this);
        node.removeNode();
        node = next;
        continue;
      }
      let data = '';
      for (let sibling = node.nextSibling; sibling?.isExclusiveText(); sibling = sibling.nextSibling) {
        data += sibling.data;
      }
      node.replaceData(length, 0, data);
      RangeImpl.adjustForNormalization(node, length);
      while (node.nextSibling?.isExclusiveText()) node.nextSibling.removeNode();
      node = node.nextDescendant(this);
    }
  }

  hasChildren(): boolean {
    return this.#firstChild !== null;
  }

  /** Whether the ordinary tree contains any immediate children. */
  // https://dom.spec.whatwg.org/#dom-node-haschildnodes
  hasChildNodes(): boolean {
    return this.hasChildren();
  }

  /** Clone this node and optionally its descendants, rejecting standalone shadow roots. */
  // https://dom.spec.whatwg.org/#dom-node-clonenode
  cloneNode(subtree: boolean): NodeImpl {
    if (this.isShadowRoot()) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    return this.clone(this.nodeDocument, subtree);
  }

  /** Copy into a document, with an optional parent and fallback custom-element registry. */
  // https://dom.spec.whatwg.org/#concept-node-clone
  clone(
    document: DocumentImpl = this.nodeDocument,
    subtree = false,
    parent: NodeImpl | null = null,
    fallbackRegistry: CustomElementRegistryImpl | null = null,
  ): NodeImpl {
    const copy = this.cloneSingleNode(document, fallbackRegistry);
    this.cloningSteps(copy, subtree);
    if (parent !== null) parent.appendChild(copy);
    if (subtree) {
      for (let child = this.firstChild; child !== null; child = child.nextSibling) {
        child.clone(document, true, copy, fallbackRegistry);
      }
    }
    if (this.isElement() && copy.isElement() && this.shadowRoot?.clonable) {
      const shadow = this.shadowRoot;
      let registry = shadow.customElementRegistry;
      if (registry !== null && !registry.isScoped) registry = document.customElementRegistry;
      copy.attachShadowRoot(
        shadow.mode, shadow.delegatesFocus, shadow.serializable, shadow.slotAssignment, true, registry,
      );
      const shadowCopy = copy.shadowRoot!;
      shadowCopy.declarative = shadow.declarative;
      shadowCopy.keepCustomElementRegistryNull = shadow.keepCustomElementRegistryNull;
      for (let child = shadow.firstChild; child !== null; child = child.nextSibling) {
        child.clone(document, true, shadowCopy);
      }
    }
    return copy;
  }

  /** Copy this node's own data; tree copying and specification extension hooks run separately. */
  // https://dom.spec.whatwg.org/#concept-node-clone-single
  cloneSingleNode(document: DocumentImpl, fallbackRegistry: CustomElementRegistryImpl | null): NodeImpl {
    if (this.isElement()) {
      let registry = this.customElementRegistry ?? fallbackRegistry;
      if (registry !== null && !registry.isScoped) registry = document.customElementRegistry;
      const copy = document.createElementNode(this.localName, this.namespaceURI, this.prefix, this.isValue, registry);
      for (const attribute of this.attributeList) {
        copy.appendAttribute(document.createAttributeNode(
          attribute.localName, attribute.value, attribute.namespaceURI, attribute.prefix,
        ));
      }
      return copy;
    }
    if (this.isDocument()) return this.cloneDocument(document);
    if (this.isDocumentType()) return document.createDocumentType(this.name, this.publicId, this.systemId);
    if (this.isAttribute()) {
      return document.createAttributeNode(this.localName, this.value, this.namespaceURI, this.prefix);
    }
    if (this.isExclusiveText()) return document.createTextNode(this.data);
    if (this.isText()) return document.createCDATASectionNode(this.data);
    if (this.isComment()) return document.createComment(this.data);
    if (this.isProcessingInstruction()) return document.createProcessingInstructionNode(this.target, this.data);
    if (this.isDocumentFragment()) return document.createDocumentFragment();
    throw new InternalError('Unknown node kind');
  }

  /** Compare node data and ordinary descendants; listeners and shadow trees do not participate. */
  // https://dom.spec.whatwg.org/#concept-node-equals
  isEqualNode(other: NodeImpl | null): boolean {
    if (other === this) return true;
    if (other === null || this.nodeType !== other.nodeType) return false;
    // SPEC_CLASH(document-xml-document-equality): Browsers compare Document and XMLDocument alike,
    // although DOM requires the same interfaces. Preserve the interface check for other node kinds.
    if (!this.isDocument() && this.constructor !== other.constructor) return false;
    if (this.isDocumentType() && other.isDocumentType()) {
      if (this.name !== other.name || this.publicId !== other.publicId || this.systemId !== other.systemId) return false;
    } else if (this.isElement() && other.isElement()) {
      if (this.namespaceURI !== other.namespaceURI || this.prefix !== other.prefix ||
        this.localName !== other.localName || this.attributeList.length !== other.attributeList.length) return false;
      for (const attribute of this.attributeList) {
        if (!attribute.isEqualNode(other.getAttributeNodeNS(attribute.namespaceURI, attribute.localName))) return false;
      }
    } else if (this.isAttribute() && other.isAttribute()) {
      if (this.namespaceURI !== other.namespaceURI || this.localName !== other.localName ||
        this.value !== other.value) return false;
    } else if (this.isCharacterData() && other.isCharacterData()) {
      if (this.data !== other.data) return false;
      if (this.isProcessingInstruction() && other.isProcessingInstruction() && this.target !== other.target) return false;
    }
    let child = this.firstChild;
    let otherChild = other.firstChild;
    while (child !== null && otherChild !== null) {
      if (!child.isEqualNode(otherChild)) return false;
      child = child.nextSibling;
      otherChild = otherChild.nextSibling;
    }
    return child === null && otherChild === null;
  }

  /** Legacy identity test, equivalent to comparing the two platform objects. */
  // https://dom.spec.whatwg.org/#dom-node-issamenode
  isSameNode(other: NodeImpl | null): boolean {
    return this === other;
  }

  /** Locate a non-default prefix through this node's element context. */
  // https://dom.spec.whatwg.org/#dom-node-lookupprefix
  lookupPrefix(namespace: string | null): string | null {
    if (namespace === null || namespace === '') return null;
    if (this.isElement()) {
      if (this.namespaceURI === namespace && this.prefix !== null) return this.prefix;
      for (const attribute of this.attributeList) {
        if (attribute.prefix === 'xmlns' && attribute.value === namespace) return attribute.localName;
      }
      return this.parentElement?.lookupPrefix(namespace) ?? null;
    }
    if (this.isDocument()) return this.documentElement?.lookupPrefix(namespace) ?? null;
    if (this.isAttribute()) return this.ownerElement?.lookupPrefix(namespace) ?? null;
    return this.parentElement?.lookupPrefix(namespace) ?? null;
  }

  /** Resolve a prefix from element names and namespace declarations, without crossing shadow roots. */
  // https://dom.spec.whatwg.org/#locate-a-namespace
  lookupNamespaceURI(prefix: string | null): string | null {
    if (prefix === '') prefix = null;
    if (this.isElement()) {
      if (prefix === 'xml') return XML_NAMESPACE;
      if (prefix === 'xmlns') return XMLNS_NAMESPACE;
      if (this.namespaceURI !== '' && this.prefix === prefix) return this.namespaceURI;
      for (const attribute of this.attributeList) {
        if (attribute.namespaceURI === XMLNS_NAMESPACE &&
          ((attribute.prefix === 'xmlns' && attribute.localName === prefix) ||
            (attribute.prefix === null && attribute.localName === 'xmlns' && prefix === null))) {
          return attribute.value || null;
        }
      }
      return this.parentElement?.lookupNamespaceURI(prefix) ?? null;
    }
    if (this.isDocument()) return this.documentElement?.lookupNamespaceURI(prefix) ?? null;
    if (this.isAttribute()) return this.ownerElement?.lookupNamespaceURI(prefix) ?? null;
    return this.parentElement?.lookupNamespaceURI(prefix) ?? null;
  }

  /** Whether namespace is the default namespace in this node's element context. */
  // https://dom.spec.whatwg.org/#dom-node-isdefaultnamespace
  isDefaultNamespace(namespace: string | null): boolean {
    return this.lookupNamespaceURI(null) === (namespace || null);
  }

  // https://dom.spec.whatwg.org/#concept-tree-root
  getRoot(): NodeImpl {
    if (!this.#parent) return this;

    let root = this.#parent;
    while (root.#parent) root = root.#parent;
    return root;
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

  /** Number of preceding siblings in this node's current tree. */
  // https://dom.spec.whatwg.org/#concept-tree-index
  getIndex(): number {
    let index = 0;
    for (let sibling = this.#previousSibling; sibling; sibling = sibling.#previousSibling) index++;
    return index;
  }

  /** DOM node length: UTF-16 units for character data, otherwise child count (zero for Attr/doctype). */
  // https://dom.spec.whatwg.org/#concept-node-length
  getLength(): number {
    if (this.isCharacterData()) return this.data.length;
    let length = 0;
    for (let child = this.firstChild; child; child = child.nextSibling) length++;
    return length;
  }

  /** Concatenate direct Text children in tree order, excluding nested descendants. */
  // https://dom.spec.whatwg.org/#concept-child-text-content
  getChildTextContent(): string {
    let content = '';
    for (let child = this.firstChild; child; child = child.nextSibling) {
      if (child.isText()) content += child.data;
    }
    return content;
  }

  /** Concatenate descendant Text data in ordinary tree order, without crossing shadow roots. */
  // https://dom.spec.whatwg.org/#concept-descendant-text-content
  getDescendantTextContent(): string {
    let content = '';
    for (let node = this.firstChild; node; node = node.nextDescendant(this)) {
      if (node.isText()) content += node.data;
    }
    return content;
  }

  // https://dom.spec.whatwg.org/#concept-tree-inclusive-descendant
  contains(other: NodeImpl | null): boolean {
    if (!other) return false;
    if (other === this) return true;

    for (let ancestor = other.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === this) return true;
    }

    return false;
  }

  // https://dom.spec.whatwg.org/#concept-tree-order
  comparePosition(other: NodeImpl): -1 | 0 | 1 | null {
    if (other === this) return 0;

    const thisChain: NodeImpl[] = [this];
    for (let ancestor = this.#parent; ancestor; ancestor = ancestor.#parent) {
      thisChain.push(ancestor);
    }

    const otherChain = [other];
    for (let ancestor = other.#parent; ancestor; ancestor = ancestor.#parent) {
      otherChain.push(ancestor);
    }

    if (thisChain.at(-1) !== otherChain.at(-1)) {
      return null;
    }

    let thisIndex = thisChain.length - 1;
    let otherIndex = otherChain.length - 1;

    while (thisChain[thisIndex] === otherChain[otherIndex]) {
      thisIndex--;
      otherIndex--;
    }

    if (thisIndex < 0) {
      return -1;
    }

    if (otherIndex < 0) {
      return 1;
    }

    const thisChild = thisChain[thisIndex]!;
    const otherChild = otherChain[otherIndex]!;

    for (let sibling = thisChild.#nextSibling; sibling; sibling = sibling.#nextSibling) {
      if (sibling === otherChild) return -1;
    }

    return 1;
  }

  /** Describe the other node's position relative to this node as DOM flags. */
  // https://dom.spec.whatwg.org/#dom-node-comparedocumentposition
  compareDocumentPosition(other: NodeImpl): number {
    if (other === this) return 0;
    const attr1 = other.isAttribute() ? other : null;
    const attr2 = this.isAttribute() ? this : null;
    const node1 = attr1 === null ? other : attr1.ownerElement;
    const node2 = attr2 === null ? this : attr2.ownerElement;
    if (attr1 !== null && attr2 !== null && node1 !== null && node1 === node2) {
      for (const attribute of attr1.ownerElement!.attributeList) {
        if (attribute === attr1) return DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | DOCUMENT_POSITION_PRECEDING;
        if (attribute === attr2) return DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | DOCUMENT_POSITION_FOLLOWING;
      }
    }
    if (node1 === null || node2 === null || node1.getRoot() !== node2.getRoot()) {
      this.#disconnectedOrder ??= NodeImpl.#nextDisconnectedOrder++;
      other.#disconnectedOrder ??= NodeImpl.#nextDisconnectedOrder++;
      return DOCUMENT_POSITION_DISCONNECTED | DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC |
        (other.#disconnectedOrder < this.#disconnectedOrder ? DOCUMENT_POSITION_PRECEDING : DOCUMENT_POSITION_FOLLOWING);
    }
    if ((node1 !== node2 && node1.contains(node2) && attr1 === null) || (node1 === node2 && attr2 !== null)) {
      return DOCUMENT_POSITION_PRECEDING | DOCUMENT_POSITION_CONTAINS;
    }
    if ((node1 !== node2 && node2.contains(node1) && attr2 === null) || (node1 === node2 && attr1 !== null)) {
      return DOCUMENT_POSITION_FOLLOWING | DOCUMENT_POSITION_CONTAINED_BY;
    }
    return node1.comparePosition(node2) === -1 ? DOCUMENT_POSITION_PRECEDING : DOCUMENT_POSITION_FOLLOWING;
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

  /** Test ancestry through tree parents and both shadow-root and template-content hosts. */
  // https://dom.spec.whatwg.org/#concept-tree-host-including-inclusive-ancestor
  isHostIncludingInclusiveAncestor(node: NodeImpl): boolean {
    let current: NodeImpl | null = node;
    while (current !== null) {
      if (current === this) return true;
      current = current.parentNode ?? (current.isDocumentFragment() ? current.host : null);
    }
    return false;
  }

  /** Advance in tree order within root's subtree; this node must be root or its descendant. */
  nextDescendant(root: NodeImpl): NodeImpl | null {
    if (this.firstChild !== null) return this.firstChild;
    for (let node: NodeImpl = this; node !== root; node = node.parentNode!) {
      if (node.nextSibling !== null) return node.nextSibling;
    }
    return null;
  }

  /** Advance within root, visiting each host's shadow tree before its light children. */
  // This node must be root or its shadow-including descendant.
  // https://dom.spec.whatwg.org/#concept-shadow-including-tree-order
  nextShadowIncludingDescendant(root: NodeImpl): NodeImpl | null {
    if (this.isElement() && this.shadowRoot !== null) return this.shadowRoot;
    if (this.firstChild !== null) return this.firstChild;
    let node: NodeImpl = this;
    while (node !== root) {
      if (node.nextSibling !== null) return node.nextSibling;
      if (node.isShadowRoot()) {
        const host = node.host;
        if (host.firstChild !== null) return host.firstChild;
        node = host;
      } else {
        node = node.parentNode!;
      }
    }
    return null;
  }

  // https://dom.spec.whatwg.org/#dom-node-insertbefore
  insertBefore<T extends NodeImpl>(node: T, child: NodeImpl | null): T {
    this.ensurePreInsertValidity(node, child);
    this.insert(node, child === node ? node.nextSibling : child);
    return node;
  }

  // https://dom.spec.whatwg.org/#dom-node-appendchild
  appendChild<T extends NodeImpl>(node: T): T {
    return this.insertBefore(node, null);
  }

  /** Replace a child after checking the complete operation, including document constraints. */
  // https://dom.spec.whatwg.org/#concept-node-replace
  replaceChild<T extends NodeImpl>(node: NodeImpl, child: T): T {
    this.ensurePreInsertValidity(node, child, [child]);
    const reference = child.nextSibling === node ? node.nextSibling : child.nextSibling;
    const previous = child.previousSibling;
    const removed: NodeImpl[] = [];
    node.adoptInto(this.nodeDocument);
    if (child.parentNode !== null) {
      removed.push(child);
      child.removeNode(true);
    }
    const added: NodeImpl[] = [];
    if (node.isDocumentFragment()) {
      for (let current = node.firstChild; current; current = current.nextSibling) added.push(current);
    } else {
      added.push(node);
    }
    this.insert(node, reference, true);
    this.queueTreeMutationRecord(added, removed, previous, reference);
    return child;
  }

  /** Remove this parent's child, rejecting a foreign child before mutation. */
  // https://dom.spec.whatwg.org/#concept-node-pre-remove
  removeChild<T extends NodeImpl>(child: T): T {
    if (child.parentNode !== this) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    }
    child.removeNode();
    return child;
  }

  /** Validate insertion into this parent before either tree changes. */
  // https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
  ensurePreInsertValidity(
    node: NodeImpl,
    child: NodeImpl | null,
    childrenToExclude: readonly NodeImpl[] = noChildrenToExclude,
  ): asserts this is InsertionParent {
    if (!this.isDocument() && !this.isDocumentFragment() && !this.isElement()) {
      throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    }
    if (node.isHostIncludingInclusiveAncestor(this)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    }
    if (child !== null && child.parentNode !== this) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    }
    if (!node.isDocumentFragment() && !node.isDocumentType() && !node.isElement() && !node.isCharacterData()) {
      throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    }

    if (!this.isDocument()) {
      if (node.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
      return;
    }
    if (node.isText()) throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    if (node.isCharacterData()) return;

    if (node.isDocumentFragment()) {
      let elements = 0;
      for (let current = node.firstChild; current; current = current.nextSibling) {
        if (current.isElement()) elements++;
        if (elements > 1 || current.isText()) throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
      }
      if (elements === 0) return;
    }

    if (node.isDocumentFragment() || node.isElement()) {
      for (let current = this.firstChild; current; current = current.nextSibling) {
        if (current.isElement() && !childrenToExclude.includes(current)) {
          throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
        }
      }
      for (let current = child; current; current = current.nextSibling) {
        if (current.isDocumentType() && (current !== child || !childrenToExclude.includes(current))) {
          throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
        }
      }
      return;
    }

    for (let current = this.firstChild; current; current = current.nextSibling) {
      if (current.isDocumentType() && !childrenToExclude.includes(current)) {
        throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
      }
    }
    for (let current = this.firstChild; current && current !== child; current = current.nextSibling) {
      if (current.isElement() && (child !== null || !childrenToExclude.includes(current))) {
        throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
      }
    }
  }

  /** Insert into this parent after validation, including parser insertions. */
  // https://dom.spec.whatwg.org/#concept-node-insert
  insert(node: NodeImpl, child: NodeImpl | null, suppressObservers = false): void {
    const nodes: NodeImpl[] = [];
    if (node.isDocumentFragment()) {
      for (let current = node.firstChild; current; current = current.nextSibling) nodes.push(current);
    } else {
      nodes.push(node);
    }
    const count = nodes.length;
    if (count === 0) return;

    if (node.isDocumentFragment()) {
      for (const current of nodes) current.removeNode(true);
      // A fragment's own record is required even when the parent's record is suppressed.
      node.queueTreeMutationRecord([], nodes, null, null);
    }

    if (child !== null) {
      RangeImpl.adjustForInsertion(this, child.getIndex(), count);
    }
    const previousSibling = child === null ? this.lastChild : child.previousSibling;

    for (const current of nodes) {
      current.adoptInto(this.nodeDocument);
      this.#insertTreeChild(current, child);
      RangeImpl.rootInserted(current);

      // SPEC_CLASH(manual-slot-insertion): browsers refresh manual assignments too; DOM limits this step to named roots.
      if (this.isElement() && this.shadowRoot !== null &&
        (current.isElement() || current.isText())) {
        current.assignSlot();
      }
      if (this.getRoot().isShadowRoot() && this.isSlot() && this.assignedNodesList.length === 0) {
        this.signalSlotChange();
      }
      current.getRoot().assignSlottablesForTree();

      for (let descendant: NodeImpl | null = current; descendant;
        descendant = descendant.nextShadowIncludingDescendant(current)) {
        descendant.insertionSteps();
        if (!descendant.isConnected) continue;

        if (descendant.isElement() && descendant.customElementRegistry !== null) {
          const registry = descendant.customElementRegistry;
          if (registry.isScoped) registry.scopedDocumentSet.add(descendant.nodeDocument);
          if (descendant.customElementState === 'custom') {
            descendant.enqueueCustomElementCallbackReaction('connectedCallback', []);
          } else {
            descendant.tryToUpgrade();
          }
        } else if (descendant.isShadowRoot() && descendant.customElementRegistry !== null &&
          descendant.customElementRegistry.isScoped) {
          descendant.customElementRegistry.scopedDocumentSet.add(descendant.nodeDocument);
        }
      }
    }

    if (!suppressObservers) this.queueTreeMutationRecord(nodes, [], previousSibling, child);
    this.childrenChanged();

    // Post-connection steps can run script and change the tree. Collect before calling any.
    const connectedCandidates: NodeImpl[] = [];
    for (const current of nodes) {
      for (let descendant: NodeImpl | null = current; descendant;
        descendant = descendant.nextShadowIncludingDescendant(current)) connectedCandidates.push(descendant);
    }
    for (const current of connectedCandidates) {
      if (current.isConnected) current.postConnectionSteps();
    }
  }

  /** Remove an attached node while preserving the ordering of mutation participants. */
  // https://dom.spec.whatwg.org/#concept-node-remove
  removeNode(suppressObservers = false): void {
    const parent = this.parentNode;
    if (parent === null) throw new InternalError('DOM removal requires an attached node');

    RangeImpl.preRemove(this);
    NodeIteratorImpl.preRemove(this);
    const previousSibling = this.previousSibling;
    const nextSibling = this.nextSibling;
    this.#removeTreeNode();

    const slottable: ElementImpl | TextImpl | null = this.isElement() || this.isText() ? this : null;
    const slot = slottable?.getAssignedSlot() ?? null;
    if (slot !== null) slot.assignSlottables();
    if (parent.getRoot().isShadowRoot() && parent.isSlot() && parent.assignedNodesList.length === 0) {
      parent.signalSlotChange();
    }
    for (let descendant: NodeImpl | null = this; descendant; descendant = descendant.nextDescendant(this)) {
      if (descendant.isSlot()) {
        parent.getRoot().assignSlottablesForTree();
        this.assignSlottablesForTree();
        break;
      }
    }

    this.removingSteps(true, parent);
    const isParentConnected = parent.isConnected;
    if (this.isElement() && this.customElementState === 'custom' && isParentConnected) {
      this.enqueueCustomElementCallbackReaction('disconnectedCallback', []);
    }
    for (let descendant = this.nextShadowIncludingDescendant(this); descendant;
      descendant = descendant.nextShadowIncludingDescendant(this)) {
      descendant.removingSteps(false, parent);
      if (descendant.isElement() && descendant.customElementState === 'custom' && isParentConnected) {
        descendant.enqueueCustomElementCallbackReaction('disconnectedCallback', []);
      }
    }

    for (let ancestor: NodeImpl | null = parent; ancestor; ancestor = ancestor.parentNode) {
      for (const registered of ancestor.registeredObserverList) {
        if (registered.options.subtree) {
          registered.observer.addTransientRegistration(this, registered);
        }
      }
    }
    if (!suppressObservers) parent.queueTreeMutationRecord([], [this], previousSibling, nextSibling);
    parent.childrenChanged();
  }

  /** Replace all children; callers must first establish that the resulting tree is valid. */
  // https://dom.spec.whatwg.org/#concept-node-replace-all
  replaceAll(node: NodeImpl | null): void {
    const removed: NodeImpl[] = [];
    for (let child = this.firstChild; child; child = child.nextSibling) removed.push(child);
    const added: NodeImpl[] = [];
    if (node?.isDocumentFragment()) {
      for (let child = node.firstChild; child; child = child.nextSibling) added.push(child);
    } else if (node !== null) {
      added.push(node);
    }
    for (const child of removed) child.removeNode(true);
    if (node !== null) this.insert(node, null, true);
    if (added.length || removed.length) this.queueTreeMutationRecord(added, removed, null, null);
  }

  /** Replace all children with one Text node, or no children for an empty string. */
  // https://dom.spec.whatwg.org/#string-replace-all
  stringReplaceAll(value: string): void {
    this.replaceAll(value === '' ? null : this.nodeDocument.createTextNode(value));
  }

  /** Move within the same shadow-including tree, preserving state owned by moving hooks. */
  // https://dom.spec.whatwg.org/#move
  move(node: NodeImpl, child: NodeImpl | null): void {
    if (this.getShadowIncludingRoot() !== node.getShadowIncludingRoot() ||
      node.isHostIncludingInclusiveAncestor(this)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    }
    if (child !== null && child.parentNode !== this) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    }
    if (!node.isElement() && !node.isCharacterData()) {
      throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    }
    this.ensurePreInsertValidity(node, child);

    const oldParent = node.parentNode!;
    RangeImpl.preRemove(node);
    NodeIteratorImpl.preRemove(node);
    const oldPrevious = node.previousSibling;
    const oldNext = node.nextSibling;
    node.#removeTreeNode();
    if (node.isElement() || node.isText()) node.getAssignedSlot()?.assignSlottables();
    if (oldParent.getRoot().isShadowRoot() && oldParent.isSlot() && oldParent.assignedNodesList.length === 0) {
      oldParent.signalSlotChange();
    }
    for (let descendant: NodeImpl | null = node; descendant; descendant = descendant.nextDescendant(node)) {
      if (descendant.isSlot()) {
        oldParent.getRoot().assignSlottablesForTree();
        node.assignSlottablesForTree();
        break;
      }
    }

    if (child !== null) RangeImpl.adjustForInsertion(this, child.getIndex(), 1);
    const newPrevious = child === null ? this.lastChild : child.previousSibling;
    this.#insertTreeChild(node, child);
    // SPEC_CLASH(manual-slot-insertion): preserve the same assignment update for state-preserving moves.
    if (this.isElement() && this.shadowRoot !== null &&
      (node.isElement() || node.isText())) node.assignSlot();
    if (this.getRoot().isShadowRoot() && this.isSlot() && this.assignedNodesList.length === 0) {
      this.signalSlotChange();
    }
    node.getRoot().assignSlottablesForTree();
    oldParent.childrenMoved();
    // Validation narrows this to a parent union; access the protected hook through Node.
    if (this !== oldParent) (this as NodeImpl).childrenMoved();
    for (let descendant: NodeImpl | null = node; descendant;
      descendant = descendant.nextShadowIncludingDescendant(node)) {
      descendant.movingSteps(descendant === node, oldParent);
      if (descendant.isElement() && descendant.customElementState === 'custom' && this.isConnected) {
        descendant.enqueueCustomElementCallbackReaction('connectedMoveCallback', []);
      }
    }
    oldParent.queueTreeMutationRecord([], [node], oldPrevious, oldNext);
    this.queueTreeMutationRecord([node], [], newPrevious, child);
  }

  /** Detach and change document ownership without changing platform identity or realm. */
  // https://dom.spec.whatwg.org/#concept-node-adopt
  adoptInto(document: DocumentImpl): void {
    const oldDocument = this.nodeDocument;
    if (this.parentNode !== null) this.removeNode();
    if (document === oldDocument) return;

    for (let descendant: NodeImpl | null = this; descendant;
      descendant = descendant.nextShadowIncludingDescendant(this)) {
      descendant.nodeDocument = document;
      if (descendant.isShadowRoot()) {
        if ((descendant.customElementRegistry === null && !descendant.keepCustomElementRegistryNull) ||
          (descendant.customElementRegistry !== null && !descendant.customElementRegistry.isScoped)) {
          const registry = document.customElementRegistry;
          descendant.customElementRegistry = registry === null || registry.isScoped ? null : registry;
        }
      } else if (descendant.isElement()) {
        for (const attribute of descendant.attributeList) attribute.nodeDocument = document;
        if (descendant.customElementRegistry === null || !descendant.customElementRegistry.isScoped) {
          const parent = descendant.parentNode;
          const registry = descendant.customElementRegistry !== null || parent === null ||
            (parent.isDocumentFragment() && !parent.isShadowRoot())
            ? document.customElementRegistry : parent.lookupCustomElementRegistry();
          descendant.customElementRegistry = registry === null || registry.isScoped ? null : registry;
        }
        if (descendant.customElementState === 'custom') {
          descendant.enqueueCustomElementCallbackReaction('adoptedCallback', [oldDocument, document]);
        }
      }
      descendant.adoptingSteps(oldDocument);
    }
  }

  /** Reassign each slot in this subtree in ordinary tree order. */
  // https://dom.spec.whatwg.org/#assign-slotables-for-a-tree
  assignSlottablesForTree(): void {
    for (let node: NodeImpl | null = this; node; node = node.nextDescendant(this)) {
      if (node.isSlot()) node.assignSlottables();
    }
  }

  /** Queue a child-list record for observers interested in this target. */
  // https://dom.spec.whatwg.org/#queue-a-tree-mutation-record
  queueTreeMutationRecord(
    addedNodes: NodeImpl[], removedNodes: NodeImpl[],
    previousSibling: NodeImpl | null, nextSibling: NodeImpl | null,
  ): void {
    this.queueMutationRecord('childList', null, null, null, addedNodes, removedNodes, previousSibling, nextSibling);
  }

  /** Queue one record per interested observer, combining registrations' old-value requests. */
  // https://dom.spec.whatwg.org/#queue-a-mutation-record
  queueMutationRecord(
    type: MutationType, name: string | null, namespace: string | null, oldValue: string | null,
    addedNodes: NodeImpl[], removedNodes: NodeImpl[], previousSibling: NodeImpl | null, nextSibling: NodeImpl | null,
  ): void {
    const isAttributeMutation = type === 'attributes';
    const isCharacterDataMutation = type === 'characterData';
    const interestedObservers = new Map<MutationObserverImpl, string | null>();
    for (let node: NodeImpl | null = this; node; node = node.parentNode) {
      for (const { observer, options } of node.registeredObserverList) {
        if (node !== this && !options.subtree) continue;
        if (isAttributeMutation) {
          if (!options.attributes) continue;
          if (options.attributeFilter !== undefined &&
            (namespace !== null || !options.attributeFilter.includes(name!))) {
            continue;
          }
        } else if (isCharacterDataMutation) {
          if (!options.characterData) continue;
        } else if (!options.childList) {
          continue;
        }

        if (!interestedObservers.has(observer)) interestedObservers.set(observer, null);
        if ((isAttributeMutation && options.attributeOldValue) ||
          (isCharacterDataMutation && options.characterDataOldValue)) {
          interestedObservers.set(observer, oldValue);
        }
      }
    }

    if (interestedObservers.size === 0) return;

    const realm = this.env.realm;
    for (const [observer, mappedOldValue] of interestedObservers) {
      observer.enqueueRecord(new MutationRecordImpl(
        type, this, name, namespace, mappedOldValue, addedNodes, removedNodes, previousSibling, nextSibling,
      ));
      if (realm.isWindow()) realm.agent.pendingMutationObservers.add(observer);
    }
    if (realm.isWindow()) realm.agent.queueMutationObserverMicrotask();
  }

  /** Return the registry associated with this node, when its kind carries one. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#look-up-a-custom-element-registry
  lookupCustomElementRegistry(): CustomElementRegistryImpl | null {
    return this.isElement() || this.isShadowRoot() || this.isDocument() ? this.customElementRegistry : null;
  }

  /** Notify the parent's children-changed steps after a character-data change. */
  notifyParentChildrenChanged(): void {
    this.parentNode?.childrenChanged();
  }

  // Tag checks keep the base node module independent of its subclasses.
  isElement(): this is ElementImpl {
    return this.nodeType === NodeType.Element;
  }

  isAttribute(): this is AttrImpl {
    return this.nodeType === NodeType.Attribute;
  }

  isText(): this is TextImpl {
    return this.nodeType === NodeType.Text || this.nodeType === NodeType.CDATASection;
  }

  isExclusiveText(): this is TextImpl {
    return this.nodeType === NodeType.Text;
  }

  isCharacterData(): this is CharacterDataImpl {
    return this.isText() || this.isComment() || this.nodeType === NodeType.ProcessingInstruction;
  }

  isComment(): this is CommentImpl {
    return this.nodeType === NodeType.Comment;
  }

  isProcessingInstruction(): this is ProcessingInstructionImpl {
    return this.nodeType === NodeType.ProcessingInstruction;
  }

  isDocument(): this is DocumentImpl {
    return this.nodeType === NodeType.Document;
  }

  isDocumentFragment(): this is DocumentFragmentImpl {
    return this.nodeType === NodeType.DocumentFragment;
  }

  isShadowRoot(): this is ShadowRootImpl {
    return this.isDocumentFragment() && this.getShadowRootHost() !== null;
  }

  /** Only HTMLSlotElement overrides this; a generic node cannot be a slot. */
  isSlot(): this is HTMLSlotElementImpl {
    return false;
  }

  isDocumentType(): this is DocumentTypeImpl {
    return this.nodeType === NodeType.DocumentType;
  }

  /** Whether HTML content-model checks and document/element interpretation ignore this node. */
  // https://html.spec.whatwg.org/multipage/dom.html#content-models
  isIgnoredHTMLContent(): boolean {
    return this.isComment() || this.isProcessingInstruction() ||
      (this.isText() && this.isInterElementWhitespace());
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

  protected override isDefaultPassiveTarget(this: NodeImpl): boolean {
    const root = this.getRoot();
    const document = root.isDocument() ? root : this.nodeDocument;

    return (
      this === document ||
      this === document.documentElement ||
      this === document.body
    );
  }

  /** Run node-specific insertion steps; plain nodes have none. */
  // https://dom.spec.whatwg.org/#concept-node-insert-ext
  protected insertionSteps(): void {}

  /** Extension point for specifications that copy state beyond ordinary node data. */
  // https://dom.spec.whatwg.org/#concept-node-clone-ext
  // PROVISIONAL(HTML): template, script, and form-control cloning steps need their implementations.
  protected cloningSteps(_copy: NodeImpl, _subtree: boolean): void {}

  /** Specification extensions for a move, without removal or insertion side effects. */
  // https://dom.spec.whatwg.org/#concept-node-move-ext
  protected movingSteps(_isSubtreeRoot: boolean, _oldAncestor: NodeImpl): void {}

  /** Run node-specific removal steps with the former ancestor and subtree-root flag. */
  // https://dom.spec.whatwg.org/#concept-node-remove-ext
  protected removingSteps(_isSubtreeRoot: boolean, _oldAncestor: NodeImpl): void {}

  /** Run node-specific adoption steps after this node's document has changed. */
  // https://dom.spec.whatwg.org/#concept-node-adopt-ext
  protected adoptingSteps(_oldDocument: DocumentImpl): void {}

  /** Run node-specific connection work after the insertion batch is complete. */
  // https://dom.spec.whatwg.org/#concept-node-post-connection-ext
  protected postConnectionSteps(): void {}

  /** Run node-specific steps after child insertion, removal, or text changes. */
  // https://dom.spec.whatwg.org/#concept-node-children-changed-ext
  protected childrenChanged(): void {}

  /** Refresh parent state after a child moves in, out, or within this node. */
  // Internal notification: moves do not run the specification's children-changed steps.
  protected childrenMoved(): void {}

  /** Unlink an attached node after the DOM's pre-removal steps have run. */
  #removeTreeNode(): void {
    const parent = this.#parent;
    if (!parent) throw new InternalError('Tree removal requires an attached node');

    const previous = this.#previousSibling;
    const next = this.#nextSibling;

    if (previous) {
      previous.#nextSibling = next;
    } else {
      parent.#firstChild = next;
    }

    if (next) {
      next.#previousSibling = previous;
    } else {
      parent.#lastChild = previous;
    }

    this.#parent = null;
    this.#previousSibling = null;
    this.#nextSibling = null;
    this.nodeDocument.collectionVersion++;
    if (parent.isDocument() && this.isElement()) parent.updateDocumentElement();
  }

  /** Link an already-adopted, detached node without running DOM participants. */
  #insertTreeChild(node: NodeImpl, reference: NodeImpl | null): void {
    if (node.#parent !== null) {
      throw new InternalError('Tree insertion requires a detached node');
    }
    if (reference !== null && reference.#parent !== this) {
      throw new InternalError('Tree insertion reference must belong to the parent');
    }

    const previous = reference ? reference.#previousSibling : this.#lastChild;

    node.#parent = this;
    node.#previousSibling = previous;
    node.#nextSibling = reference;

    if (previous) {
      previous.#nextSibling = node;
    } else {
      this.#firstChild = node;
    }

    if (reference) {
      reference.#previousSibling = node;
    } else {
      this.#lastChild = node;
    }
    this.nodeDocument.collectionVersion++;
    if (this.isDocument() && node.isElement()) this.updateDocumentElement();
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
export const nodeIDL = defineInterface({
  name: 'Node',
  inherits: 'EventTarget',
  exposed: 'Window',
  implementation: impl(NodeImpl),
  members: [
    constant('ELEMENT_NODE', idlType.unsignedShort, integer(1)),
    constant('ATTRIBUTE_NODE', idlType.unsignedShort, integer(2)),
    constant('TEXT_NODE', idlType.unsignedShort, integer(3)),
    constant('CDATA_SECTION_NODE', idlType.unsignedShort, integer(4)),
    constant('ENTITY_REFERENCE_NODE', idlType.unsignedShort, integer(5)),
    constant('ENTITY_NODE', idlType.unsignedShort, integer(6)),
    constant('PROCESSING_INSTRUCTION_NODE', idlType.unsignedShort, integer(7)),
    constant('COMMENT_NODE', idlType.unsignedShort, integer(8)),
    constant('DOCUMENT_NODE', idlType.unsignedShort, integer(9)),
    constant('DOCUMENT_TYPE_NODE', idlType.unsignedShort, integer(10)),
    constant('DOCUMENT_FRAGMENT_NODE', idlType.unsignedShort, integer(11)),
    constant('NOTATION_NODE', idlType.unsignedShort, integer(12)),
    roAttr('nodeType', idlType.unsignedShort),
    roAttr('nodeName', idlType.DOMString),
    roAttr('baseURI', idlType.USVString),
    roAttr('isConnected', idlType.boolean),
    roAttr('ownerDocument', nullable(reference('Document'))),
    op('getRootNode', reference('Node'), [
      arg('options', reference('GetRootNodeOptions'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('parentNode', nullable(reference('Node'))),
    roAttr('parentElement', nullable(reference('Element'))),
    op('hasChildNodes', idlType.boolean, []),
    roAttr('childNodes', reference('NodeList'), xattr('SameObject')),
    roAttr('firstChild', nullable(reference('Node'))),
    roAttr('lastChild', nullable(reference('Node'))),
    roAttr('previousSibling', nullable(reference('Node'))),
    roAttr('nextSibling', nullable(reference('Node'))),
    attr('nodeValue', nullable(idlType.DOMString), xattr('CEReactions')),
    attr('textContent', nullable(idlType.DOMString), xattr('CEReactions')),
    op('normalize', idlType.undefined, [], xattr('CEReactions')),
    op('cloneNode', reference('Node'),
      [arg('subtree', idlType.boolean, { default: false, optional: true })],
      xattr('CEReactions', 'NewObject'),
    ),
    op('isEqualNode', idlType.boolean, [arg('otherNode', nullable(reference('Node')))]),
    op('isSameNode', idlType.boolean, [arg('otherNode', nullable(reference('Node')))]),
    constant('DOCUMENT_POSITION_DISCONNECTED', idlType.unsignedShort, integer(1)),
    constant('DOCUMENT_POSITION_PRECEDING', idlType.unsignedShort, integer(2)),
    constant('DOCUMENT_POSITION_FOLLOWING', idlType.unsignedShort, integer(4)),
    constant('DOCUMENT_POSITION_CONTAINS', idlType.unsignedShort, integer(8)),
    constant('DOCUMENT_POSITION_CONTAINED_BY', idlType.unsignedShort, integer(16)),
    constant('DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC', idlType.unsignedShort, integer(32)),
    op('compareDocumentPosition', idlType.unsignedShort, [arg('other', reference('Node'))]),
    op('contains', idlType.boolean, [arg('other', nullable(reference('Node')))]),
    op('lookupPrefix', nullable(idlType.DOMString), [arg('namespace', nullable(idlType.DOMString))]),
    op('lookupNamespaceURI', nullable(idlType.DOMString), [arg('prefix', nullable(idlType.DOMString))]),
    op('isDefaultNamespace', idlType.boolean, [arg('namespace', nullable(idlType.DOMString))]),
    op('insertBefore', reference('Node'),
      [arg('node', reference('Node')), arg('child', nullable(reference('Node')))],
      xattr('CEReactions'),
    ),
    op('appendChild', reference('Node'),
      [arg('node', reference('Node'))],
      xattr('CEReactions'),
    ),
    op('replaceChild', reference('Node'),
      [arg('node', reference('Node')), arg('child', reference('Node'))],
      xattr('CEReactions'),
    ),
    op('removeChild', reference('Node'),
      [arg('child', reference('Node'))],
      xattr('CEReactions'),
    ),
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

/** Node kinds allowed to receive children after pre-insert validation. */
export type InsertionParent = DocumentImpl | DocumentFragmentImpl | ElementImpl;

// The common insertion path excludes no children; share its immutable empty list.
const noChildrenToExclude: readonly NodeImpl[] = [];

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
