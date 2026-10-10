// Mutable tree cursors start at this node and then advance; they do not capture this for callbacks.
/* eslint @typescript-eslint/no-this-alias: ["error", { "allowedNames": ["node", "descendant"] }] */
import { InternalError } from '../../../infra/internal-error';
import {
  arg, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, nullable,
  op, reference, roAttr, xattr, DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/index';

import { EventTargetImpl, type EventImpl } from '../events/index';
import { RangeImpl } from '../ranges/index';
import { NodeIteratorImpl } from '../traversal/index';
import type { DOMEnvironment } from '../environment';

import type { CharacterDataImpl } from './character-data';
import type { AttrImpl } from './attribute';
import type { CommentImpl } from './comment';
import type { DocumentImpl } from './document';
import type { DocumentFragmentImpl } from './document-fragment';
import type { DocumentTypeImpl } from './document-type';
import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import type { ShadowRootImpl } from './shadow-root';
import type { RegisteredObserver } from './mutation-observer';
import type { CustomElementRegistryImpl } from './html/custom-elements/index';
import type { HTMLSlotElementImpl } from './html/index';

/** DOM node ownership, tree links, traversal, mutation, and event ancestry. */
// https://dom.spec.whatwg.org/#interface-node
export abstract class NodeImpl extends EventTargetImpl {
  /** Node kind used by the DOM's type-specific algorithms. */
  nodeType: NodeType;
  /** Associated document; a document node refers to itself. */
  // https://dom.spec.whatwg.org/#concept-node-document
  nodeDocument!: DocumentImpl;
  /** Observer associations, initially empty; observation is not implemented yet. */
  // https://dom.spec.whatwg.org/#registered-observer-list
  registeredObserverList: RegisteredObserver[] = [];

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

  /** Return the tree root, crossing shadow hosts when composed is true. */
  // https://dom.spec.whatwg.org/#dom-node-getrootnode
  getRootNode(options?: GetRootNodeOptionsRecord): NodeImpl {
    return options?.composed ? this.getShadowIncludingRoot() : this.getRoot();
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

  hasChildren(): boolean {
    return this.#firstChild !== null;
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

      if (this.isElement() && this.shadowRoot !== null && this.shadowRoot.slotAssignment === 'named' &&
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
          this.registeredObserverList.push({
            observer: registered.observer, options: registered.options, source: registered,
          });
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
    if (this.isElement() && this.shadowRoot !== null && this.shadowRoot.slotAssignment === 'named' &&
      (node.isElement() || node.isText())) node.assignSlot();
    if (this.getRoot().isShadowRoot() && this.isSlot() && this.assignedNodesList.length === 0) {
      this.signalSlotChange();
    }
    node.getRoot().assignSlottablesForTree();
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
    _addedNodes: NodeImpl[], _removedNodes: NodeImpl[],
    _previousSibling: NodeImpl | null, _nextSibling: NodeImpl | null,
  ): void {
    // PROVISIONAL(DOM mutation observers): no observer can be constructed or registered yet.
    // The interested-observer collection is empty; implement delivery before enabling observe().
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
