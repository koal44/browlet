import { WeakOrderedSet } from '../../../infra/index';
import {
  arg, atArg, constant, ctor, defineInterface, idlType, impl, integer, op, reference, roAttr, stringifier, xattr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/core/index';

import type { CharacterDataImpl, DocumentFragmentImpl, DocumentImpl, NodeImpl, TextImpl } from '../nodes/index';
import type { DOMEnvironment } from '../environment';

import { AbstractRangeImpl } from './abstract-range';

/** Live boundary points registered weakly with their ordinary tree root. */
// https://dom.spec.whatwg.org/#interface-range
export class RangeImpl extends AbstractRangeImpl {
  /** Roots do not keep ranges alive; dead registrations are pruned during notification. */
  static #byRoot = new WeakMap<NodeImpl, WeakOrderedSet<RangeImpl>>();
  /** Stable registration token, reused when this range moves between root indexes. */
  #reference = new WeakRef(this);
  /** Ordinary tree root used by live mutation registration. */
  #root: NodeImpl;

  constructor(document: DocumentImpl, env: DOMEnvironment) {
    super(document, 0, document, 0, env);
    this.#root = document;
    this.#register();
  }

  /** Adjust boundaries strictly after the insertion point. */
  // https://dom.spec.whatwg.org/#concept-node-insert
  static adjustForInsertion(parent: NodeImpl, index: number, count: number): void {
    const ranges = this.#byRoot.get(parent.getRoot());
    if (!ranges) return;
    for (const range of ranges.values()) {
      if (range.startContainer === parent && range.startOffset > index) range.startOffset += count;
      if (range.endContainer === parent && range.endOffset > index) range.endOffset += count;
    }
  }

  /** Move ordinary-tree boundaries out of the removed subtree before unlinking it. */
  // https://dom.spec.whatwg.org/#live-range-pre-remove-steps
  static preRemove(node: NodeImpl): void {
    const ranges = this.#byRoot.get(node.getRoot());
    if (!ranges) return;
    const parent = node.parentNode!;
    const index = node.getIndex();
    for (const range of ranges.values()) {
      if (node.contains(range.startContainer)) {
        range.startContainer = parent;
        range.startOffset = index;
      } else if (range.startContainer === parent && range.startOffset > index) {
        range.startOffset--;
      }
      if (node.contains(range.endContainer)) {
        range.endContainer = parent;
        range.endOffset = index;
      } else if (range.endContainer === parent && range.endOffset > index) {
        range.endOffset--;
      }
    }
  }

  /** Clamp replaced boundaries and shift later offsets by the replacement's length change. */
  // https://dom.spec.whatwg.org/#concept-cd-replace
  static adjustForReplaceData(node: CharacterDataImpl, offset: number, count: number, dataLength: number): void {
    const ranges = this.#byRoot.get(node.getRoot());
    if (!ranges) return;
    const end = offset + count;
    for (const range of ranges.values()) {
      if (range.startContainer === node && range.startOffset > offset) {
        range.startOffset = range.startOffset <= end ? offset : range.startOffset + dataLength - count;
      }
      if (range.endContainer === node && range.endOffset > offset) {
        range.endOffset = range.endOffset <= end ? offset : range.endOffset + dataLength - count;
      }
    }
  }

  /** After insertion, move split-off boundaries and advance points immediately after the old Text. */
  // https://dom.spec.whatwg.org/#concept-text-split
  static adjustForSplitText(node: TextImpl, newNode: TextImpl, offset: number): void {
    const ranges = this.#byRoot.get(node.getRoot());
    if (!ranges) return;
    const parent = node.parentNode!;
    const index = node.getIndex() + 1;
    for (const range of ranges.values()) {
      if (range.startContainer === node && range.startOffset > offset) {
        range.startContainer = newNode;
        range.startOffset -= offset;
      } else if (range.startContainer === parent && range.startOffset === index) {
        range.startOffset++;
      }
      if (range.endContainer === node && range.endOffset > offset) {
        range.endContainer = newNode;
        range.endOffset -= offset;
      } else if (range.endContainer === parent && range.endOffset === index) {
        range.endOffset++;
      }
    }
  }

  /** Retarget a merged Text run's boundaries before any of its old nodes are removed. */
  // https://dom.spec.whatwg.org/#dom-node-normalize
  static adjustForNormalization(node: TextImpl, length: number): void {
    const ranges = this.#byRoot.get(node.getRoot());
    if (!ranges) return;
    const parent = node.parentNode!;
    let index = node.getIndex() + 1;
    for (let current = node.nextSibling; current?.isExclusiveText(); current = current.nextSibling) {
      for (const range of ranges.values()) {
        if (range.startContainer === current) {
          range.startContainer = node;
          range.startOffset += length;
        } else if (range.startContainer === parent && range.startOffset === index) {
          range.startContainer = node;
          range.startOffset = length;
        }
        if (range.endContainer === current) {
          range.endContainer = node;
          range.endOffset += length;
        } else if (range.endContainer === parent && range.endOffset === index) {
          range.endContainer = node;
          range.endOffset = length;
        }
      }
      length += current.length;
      index++;
    }
  }

  /** A detached root was inserted: retain its boundaries and notify them through the new root. */
  static rootInserted(node: NodeImpl): void {
    const ranges = this.#byRoot.get(node);
    if (!ranges) return;
    for (const range of ranges.values()) range.#updateRoot();
    this.#byRoot.delete(node);
  }

  /** Check the node kind and offset before changing a live boundary point. */
  // https://dom.spec.whatwg.org/#concept-range-bp-set
  static #validateBoundaryPoint(node: NodeImpl, offset: number): void {
    if (node.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    if (offset > node.getLength()) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
  }

  /** Closest inclusive ancestor shared by both boundary nodes. */
  // https://dom.spec.whatwg.org/#get-the-common-ancestor
  get commonAncestorContainer(): NodeImpl {
    let container = this.startContainer;
    while (!container.contains(this.endContainer)) container = container.parentNode!;
    return container;
  }

  /** Set the start, moving the end too if necessary to keep an ordered range in one tree. */
  // https://dom.spec.whatwg.org/#concept-range-bp-set
  setStart(node: NodeImpl, offset: number): void {
    RangeImpl.#validateBoundaryPoint(node, offset);
    if (node.getRoot() !== this.#root ||
      AbstractRangeImpl.compareBoundaryPoints(node, offset, this.endContainer, this.endOffset) === 1) {
      this.endContainer = node;
      this.endOffset = offset;
    }
    this.startContainer = node;
    this.startOffset = offset;
    this.#updateRoot();
  }

  /** Set the end, moving the start too if necessary to keep an ordered range in one tree. */
  // https://dom.spec.whatwg.org/#concept-range-bp-set
  setEnd(node: NodeImpl, offset: number): void {
    RangeImpl.#validateBoundaryPoint(node, offset);
    if (node.getRoot() !== this.#root ||
      AbstractRangeImpl.compareBoundaryPoints(node, offset, this.startContainer, this.startOffset) === -1) {
      this.startContainer = node;
      this.startOffset = offset;
    }
    this.endContainer = node;
    this.endOffset = offset;
    this.#updateRoot();
  }

  /** Set the start immediately before a node with a parent. */
  // https://dom.spec.whatwg.org/#dom-range-setstartbefore
  setStartBefore(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setStart(node.parentNode, node.getIndex());
  }

  /** Set the start immediately after a node with a parent. */
  // https://dom.spec.whatwg.org/#dom-range-setstartafter
  setStartAfter(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setStart(node.parentNode, node.getIndex() + 1);
  }

  /** Set the end immediately before a node with a parent. */
  // https://dom.spec.whatwg.org/#dom-range-setendbefore
  setEndBefore(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setEnd(node.parentNode, node.getIndex());
  }

  /** Set the end immediately after a node with a parent. */
  // https://dom.spec.whatwg.org/#dom-range-setendafter
  setEndAfter(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setEnd(node.parentNode, node.getIndex() + 1);
  }

  /** Collapse to the chosen endpoint without modifying the tree. */
  // https://dom.spec.whatwg.org/#dom-range-collapse
  collapse(toStart: boolean): void {
    if (toStart) {
      this.endContainer = this.startContainer;
      this.endOffset = this.startOffset;
    } else {
      this.startContainer = this.endContainer;
      this.startOffset = this.endOffset;
    }
  }

  /** Select a node using positions in its parent. */
  // https://dom.spec.whatwg.org/#concept-range-select
  selectNode(node: NodeImpl): void {
    const parent = node.parentNode;
    if (parent === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.startContainer = this.endContainer = parent;
    this.startOffset = node.getIndex();
    this.endOffset = this.startOffset + 1;
    this.#updateRoot();
  }

  /** Select all child nodes or UTF-16 data within a node. */
  // https://dom.spec.whatwg.org/#dom-range-selectnodecontents
  selectNodeContents(node: NodeImpl): void {
    if (node.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.startContainer = this.endContainer = node;
    this.startOffset = 0;
    this.endOffset = node.getLength();
    this.#updateRoot();
  }

  /** Compare the endpoints selected by a Range comparison constant. */
  // https://dom.spec.whatwg.org/#dom-range-compareboundarypoints
  compareBoundaryPoints(how: number, sourceRange: RangeImpl): -1 | 0 | 1 {
    if (how !== 0 && how !== 1 && how !== 2 && how !== 3) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    }
    if (this.#root !== sourceRange.#root) throw new DOMExceptionImpl('', DOMExceptionNames.wrongDocument);
    // START_TO_END compares this end to the source start; the constant names are historical.
    const thisStart = how === 0 || how === 3;
    const sourceStart = how === 0 || how === 1;
    return AbstractRangeImpl.compareBoundaryPoints(
      thisStart ? this.startContainer : this.endContainer, thisStart ? this.startOffset : this.endOffset,
      sourceStart ? sourceRange.startContainer : sourceRange.endContainer,
      sourceStart ? sourceRange.startOffset : sourceRange.endOffset,
    );
  }

  /** Remove selected nodes and data, collapsing before mutations adjust the resulting position. */
  // https://dom.spec.whatwg.org/#dom-range-deletecontents
  deleteContents(): void {
    if (this.collapsed) return;
    const { startContainer: start, startOffset, endContainer: end, endOffset } = this;
    if (start === end && start.isCharacterData()) {
      // SPEC_CLASH(range-processing-instruction-collapse): DOM/Chromium/Firefox preserve the
      // deletion's start offset for ProcessingInstruction; WebKit resets it to zero. Follow DOM.
      start.replaceData(startOffset, endOffset - startOffset, '');
      return;
    }

    const commonAncestor = this.commonAncestorContainer;
    const nodesToRemove: NodeImpl[] = [];
    for (let node = commonAncestor.firstChild; node !== null;) {
      if (!this.containsNode(node)) {
        node = node.nextDescendant(commonAncestor);
        continue;
      }
      nodesToRemove.push(node);
      // Once a whole subtree is selected, its descendants need no separate removal.
      while (node !== commonAncestor && node.nextSibling === null) node = node.parentNode!;
      node = node === commonAncestor ? null : node.nextSibling;
    }

    let newNode = start;
    let newOffset = startOffset;
    if (start !== commonAncestor) {
      let reference = start;
      while (reference.parentNode !== commonAncestor) reference = reference.parentNode!;
      newNode = commonAncestor;
      newOffset = reference.getIndex() + 1;
    }
    this.startContainer = this.endContainer = newNode;
    this.startOffset = this.endOffset = newOffset;
    if (start.isCharacterData()) start.replaceData(startOffset, start.length - startOffset, '');
    for (const node of nodesToRemove) node.removeNode();
    if (end.isCharacterData()) end.replaceData(0, endOffset, '');
  }

  /** Move fully selected nodes into a new fragment and clone partially selected ancestors. */
  // https://dom.spec.whatwg.org/#concept-range-extract
  extractContents(): DocumentFragmentImpl {
    return this.#copyContents(true);
  }

  /** Copy selected nodes and data into a new fragment, leaving this range and its tree unchanged. */
  // https://dom.spec.whatwg.org/#concept-range-clone
  cloneContents(): DocumentFragmentImpl {
    return this.#copyContents(false);
  }

  /** Insert at the start, splitting Text when needed and extending a collapsed range over the insertion. */
  // https://dom.spec.whatwg.org/#concept-range-insert
  insertNode(node: NodeImpl): void {
    const start = this.startContainer;
    if (start.isProcessingInstruction() || start.isComment() ||
      (start.isText() && start.parentNode === null) || start === node) {
      throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    }
    let reference: NodeImpl | null = start;
    if (!start.isText()) {
      reference = start.firstChild;
      for (let index = 0; index < this.startOffset; index++) reference = reference!.nextSibling;
    }
    const parent: NodeImpl = reference === null ? start : reference.parentNode!;
    parent.ensurePreInsertValidity(node, reference);
    if (start.isText()) reference = start.splitText(this.startOffset);
    if (node === reference) reference = node.nextSibling;
    if (node.parentNode !== null) node.removeNode();
    const newOffset = (reference === null ? parent.getLength() : reference.getIndex()) +
      (node.isDocumentFragment() ? node.getLength() : 1);
    parent.insertBefore(node, reference);
    if (this.collapsed) {
      this.endContainer = parent;
      this.endOffset = newOffset;
    }
  }

  /** Extract the selection, insert its new parent, and select that parent after filling it. */
  // https://dom.spec.whatwg.org/#dom-range-surroundcontents
  surroundContents(newParent: NodeImpl): void {
    const commonAncestor = this.commonAncestorContainer;
    for (let node = this.startContainer; node !== commonAncestor; node = node.parentNode!) {
      if (!node.isText()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    }
    for (let node = this.endContainer; node !== commonAncestor; node = node.parentNode!) {
      if (!node.isText()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    }
    if (newParent.isDocument() || newParent.isDocumentType() || newParent.isDocumentFragment()) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    }
    const fragment = this.extractContents();
    if (newParent.hasChildren()) newParent.replaceAll(null);
    this.insertNode(newParent);
    newParent.appendChild(fragment);
    this.selectNode(newParent);
  }

  /** Create an independently live range with the same endpoints and owning environment. */
  // https://dom.spec.whatwg.org/#dom-range-clonerange
  cloneRange(): RangeImpl {
    const copy = new RangeImpl(this.startContainer.nodeDocument, this.env);
    copy.startContainer = this.startContainer;
    copy.startOffset = this.startOffset;
    copy.endContainer = this.endContainer;
    copy.endOffset = this.endOffset;
    copy.#updateRoot();
    return copy;
  }

  /** Compatibility operation; detaching does not stop mutation adjustment. */
  // https://dom.spec.whatwg.org/#dom-range-detach
  detach(): void {}

  /** Include both endpoints, returning false for a different tree before validating its point. */
  // https://dom.spec.whatwg.org/#dom-range-ispointinrange
  isPointInRange(node: NodeImpl, offset: number): boolean {
    if (node.getRoot() !== this.#root) return false;
    RangeImpl.#validateBoundaryPoint(node, offset);
    return AbstractRangeImpl.compareBoundaryPoints(node, offset, this.startContainer, this.startOffset) !== -1 &&
      AbstractRangeImpl.compareBoundaryPoints(node, offset, this.endContainer, this.endOffset) !== 1;
  }

  /** Return -1 before the range, 0 within its endpoints, or 1 after it. */
  // https://dom.spec.whatwg.org/#dom-range-comparepoint
  comparePoint(node: NodeImpl, offset: number): -1 | 0 | 1 {
    if (node.getRoot() !== this.#root) throw new DOMExceptionImpl('', DOMExceptionNames.wrongDocument);
    RangeImpl.#validateBoundaryPoint(node, offset);
    if (AbstractRangeImpl.compareBoundaryPoints(node, offset, this.startContainer, this.startOffset) === -1) return -1;
    if (AbstractRangeImpl.compareBoundaryPoints(node, offset, this.endContainer, this.endOffset) === 1) return 1;
    return 0;
  }

  /** Whether the node overlaps the range; merely touching its outside edge does not intersect. */
  // https://dom.spec.whatwg.org/#dom-range-intersectsnode
  intersectsNode(node: NodeImpl): boolean {
    if (node.getRoot() !== this.#root) return false;
    const parent = node.parentNode;
    if (parent === null) return true;
    const offset = node.getIndex();
    return AbstractRangeImpl.compareBoundaryPoints(parent, offset, this.endContainer, this.endOffset) === -1 &&
      AbstractRangeImpl.compareBoundaryPoints(parent, offset + 1, this.startContainer, this.startOffset) === 1;
  }

  /** Concatenate selected Text data in ordinary tree order, including CDATA but excluding comments. */
  // https://dom.spec.whatwg.org/#dom-range-stringifier
  toString(): string {
    const { startContainer: start, startOffset, endContainer: end, endOffset } = this;
    if (start === end && start.isText()) return start.data.slice(startOffset, endOffset);
    let result = start.isText() ? start.data.slice(startOffset) : '';
    const root = this.commonAncestorContainer;
    for (let node = root.firstChild; node !== null; node = node.nextDescendant(root)) {
      if (node.isText() && this.containsNode(node)) result += node.data;
    }
    if (end.isText()) result += end.data.slice(0, endOffset);
    return result;
  }

  /** Whether a whole node lies strictly between the boundary points, in the same ordinary tree. */
  // https://dom.spec.whatwg.org/#contained
  containsNode(node: NodeImpl): boolean {
    return node.getRoot() === this.#root &&
      AbstractRangeImpl.compareBoundaryPoints(node, 0, this.startContainer, this.startOffset) === 1 &&
      AbstractRangeImpl.compareBoundaryPoints(node, node.getLength(), this.endContainer, this.endOffset) === -1;
  }

  /** Share the partial-ancestor copying steps; extraction additionally moves nodes and removes data. */
  // https://dom.spec.whatwg.org/#concept-range-extract
  // https://dom.spec.whatwg.org/#concept-range-clone
  #copyContents(extract: boolean): DocumentFragmentImpl {
    const fragment = this.startContainer.nodeDocument.createDocumentFragment();
    if (this.collapsed) return fragment;
    const { startContainer: start, startOffset, endContainer: end, endOffset } = this;
    if (start === end && start.isCharacterData()) {
      const clone = start.clone() as CharacterDataImpl;
      clone.data = start.substringData(startOffset, endOffset - startOffset);
      fragment.appendChild(clone);
      // SPEC_CLASH(range-processing-instruction-collapse): use targeted replacement for
      // ProcessingInstruction too, preserving the start offset as DOM/Chromium/Firefox do.
      if (extract) start.replaceData(startOffset, endOffset - startOffset, '');
      return fragment;
    }

    const commonAncestor = this.commonAncestorContainer;
    let firstPartial: NodeImpl | null = null;
    if (start !== commonAncestor) {
      firstPartial = start;
      while (firstPartial.parentNode !== commonAncestor) firstPartial = firstPartial.parentNode!;
    }
    let lastPartial: NodeImpl | null = null;
    if (end !== commonAncestor) {
      lastPartial = end;
      while (lastPartial.parentNode !== commonAncestor) lastPartial = lastPartial.parentNode!;
    }
    const containedChildren: NodeImpl[] = [];
    for (let child = commonAncestor.firstChild; child !== null; child = child.nextSibling) {
      if (!this.containsNode(child)) continue;
      if (child.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
      containedChildren.push(child);
    }

    if (extract) {
      // Collapse before mutation; later removals adjust this point through the ordinary live hooks.
      this.startContainer = this.endContainer = commonAncestor;
      this.startOffset = this.endOffset = firstPartial === null ? startOffset : firstPartial.getIndex() + 1;
    }
    if (firstPartial?.isCharacterData()) {
      const clone = firstPartial.clone() as CharacterDataImpl;
      clone.data = firstPartial.substringData(startOffset, firstPartial.length - startOffset);
      fragment.appendChild(clone);
      if (extract) firstPartial.replaceData(startOffset, firstPartial.length - startOffset, '');
    } else if (firstPartial !== null) {
      const clone = fragment.appendChild(firstPartial.clone());
      const subrange = new RangeImpl(start.nodeDocument, this.env);
      subrange.setStart(start, startOffset);
      subrange.setEnd(firstPartial, firstPartial.getLength());
      clone.appendChild(subrange.#copyContents(extract));
    }
    for (const child of containedChildren) {
      fragment.appendChild(extract ? child : child.clone(child.nodeDocument, true));
    }
    if (lastPartial?.isCharacterData()) {
      const clone = lastPartial.clone() as CharacterDataImpl;
      clone.data = lastPartial.substringData(0, endOffset);
      fragment.appendChild(clone);
      if (extract) lastPartial.replaceData(0, endOffset, '');
    } else if (lastPartial !== null) {
      const clone = fragment.appendChild(lastPartial.clone());
      const subrange = new RangeImpl(end.nodeDocument, this.env);
      subrange.setStart(lastPartial, 0);
      subrange.setEnd(end, endOffset);
      clone.appendChild(subrange.#copyContents(extract));
    }
    return fragment;
  }

  #updateRoot(): void {
    const root = this.startContainer.getRoot();
    if (root === this.#root) return;
    RangeImpl.#byRoot.get(this.#root)!.delete(this.#reference);
    this.#root = root;
    this.#register();
  }

  #register(): void {
    let ranges = RangeImpl.#byRoot.get(this.#root);
    if (!ranges) RangeImpl.#byRoot.set(this.#root, ranges = new WeakOrderedSet());
    ranges.add(this.#reference);
  }
}

/*
 * [Exposed=Window]
 * interface Range : AbstractRange {
 *   constructor();
 *   readonly attribute Node commonAncestorContainer;
 *   undefined setStart(Node node, unsigned long offset);
 *   undefined setEnd(Node node, unsigned long offset);
 *   undefined setStartBefore(Node node);
 *   undefined setStartAfter(Node node);
 *   undefined setEndBefore(Node node);
 *   undefined setEndAfter(Node node);
 *   undefined collapse(optional boolean toStart = false);
 *   undefined selectNode(Node node);
 *   undefined selectNodeContents(Node node);
 *   const unsigned short START_TO_START = 0;
 *   const unsigned short START_TO_END = 1;
 *   const unsigned short END_TO_END = 2;
 *   const unsigned short END_TO_START = 3;
 *   short compareBoundaryPoints(unsigned short how, Range sourceRange);
 *   [CEReactions] undefined deleteContents();
 *   [CEReactions, NewObject] DocumentFragment extractContents();
 *   [CEReactions, NewObject] DocumentFragment cloneContents();
 *   [CEReactions] undefined insertNode(Node node);
 *   [CEReactions] undefined surroundContents(Node newParent);
 *   [NewObject] Range cloneRange();
 *   undefined detach();
 *   boolean isPointInRange(Node node, unsigned long offset);
 *   short comparePoint(Node node, unsigned long offset);
 *   boolean intersectsNode(Node node);
 *   stringifier;
 * };
 */
export const rangeIDL = defineInterface<DOMEnvironment>({
  name: 'Range', inherits: 'AbstractRange', exposed: 'Window', implementation: impl(RangeImpl),
  members: [
    ctor(
      [],
      {
        constructWith: [
          atArg(0, (env) => env.realm.getAssociatedDocument()),
          atArg(1, (env) => env),
        ],
      },
    ),
    roAttr('commonAncestorContainer', reference('Node')),
    op('setStart', idlType.undefined, [arg('node', reference('Node')), arg('offset', idlType.unsignedLong)]),
    op('setEnd', idlType.undefined, [arg('node', reference('Node')), arg('offset', idlType.unsignedLong)]),
    op('setStartBefore', idlType.undefined, [arg('node', reference('Node'))]),
    op('setStartAfter', idlType.undefined, [arg('node', reference('Node'))]),
    op('setEndBefore', idlType.undefined, [arg('node', reference('Node'))]),
    op('setEndAfter', idlType.undefined, [arg('node', reference('Node'))]),
    op('collapse', idlType.undefined, [arg('toStart', idlType.boolean, { default: false, optional: true })]),
    op('selectNode', idlType.undefined, [arg('node', reference('Node'))]),
    op('selectNodeContents', idlType.undefined, [arg('node', reference('Node'))]),
    constant('START_TO_START', idlType.unsignedShort, integer(0)),
    constant('START_TO_END', idlType.unsignedShort, integer(1)),
    constant('END_TO_END', idlType.unsignedShort, integer(2)),
    constant('END_TO_START', idlType.unsignedShort, integer(3)),
    op('compareBoundaryPoints', idlType.short,
      [arg('how', idlType.unsignedShort), arg('sourceRange', reference('Range'))],
    ),
    op('deleteContents', idlType.undefined, [], xattr('CEReactions')),
    op('extractContents', reference('DocumentFragment'), [], xattr('CEReactions', 'NewObject')),
    op('cloneContents', reference('DocumentFragment'), [], xattr('CEReactions', 'NewObject')),
    op('insertNode', idlType.undefined,
      [arg('node', reference('Node'))],
      xattr('CEReactions'),
    ),
    op('surroundContents', idlType.undefined,
      [arg('newParent', reference('Node'))],
      xattr('CEReactions'),
    ),
    op('cloneRange', reference('Range'), [], xattr('NewObject')),
    op('detach', idlType.undefined),
    op('isPointInRange', idlType.boolean, [arg('node', reference('Node')), arg('offset', idlType.unsignedLong)]),
    op('comparePoint', idlType.short, [arg('node', reference('Node')), arg('offset', idlType.unsignedLong)]),
    op('intersectsNode', idlType.boolean, [arg('node', reference('Node'))]),
    stringifier(),
  ],
});
