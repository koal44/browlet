import { WeakOrderedSet } from '../../../infra/collections';
import { InternalError } from '../../../infra/internal-error';
import {
  arg, atArg, ctor, defineInterface, idlType, impl, op, reference, roAttr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/index';

import type { CharacterDataImpl, DocumentImpl, NodeImpl, TextImpl } from '../nodes/index';
import type { DOMEnvironment } from '../environment';

import { AbstractRangeImpl } from './abstract-range';

/** Live boundary points registered weakly with their ordinary tree root. */
// https://dom.spec.whatwg.org/#interface-range
export class RangeImpl extends AbstractRangeImpl {
  /** Roots do not keep ranges alive; dead registrations are pruned during notification. */
  static #byRoot = new WeakMap<NodeImpl, WeakOrderedSet<RangeImpl>>();
  /** Stable registration token, reused when this range moves between root indexes. */
  #reference = new WeakRef(this);
  #root: NodeImpl;

  constructor(document: DocumentImpl, env: DOMEnvironment) {
    super(document, 0, document, 0, env);
    this.#root = document;
    this.#register();
  }

  get commonAncestorContainer(): NodeImpl {
    let container = this.startContainer;
    while (!container.contains(this.endContainer)) container = container.parentNode!;
    return container;
  }

  // https://dom.spec.whatwg.org/#concept-range-bp-set
  setStart(node: NodeImpl, offset: number): void {
    RangeImpl.#validateBoundaryPoint(node, offset);
    if (node.getRoot() !== this.#root ||
      RangeImpl.#compareBoundaryPoints(node, offset, this.endContainer, this.endOffset) === 1) {
      this.endContainer = node;
      this.endOffset = offset;
    }
    this.startContainer = node;
    this.startOffset = offset;
    this.#updateRoot();
  }

  setEnd(node: NodeImpl, offset: number): void {
    RangeImpl.#validateBoundaryPoint(node, offset);
    if (node.getRoot() !== this.#root ||
      RangeImpl.#compareBoundaryPoints(node, offset, this.startContainer, this.startOffset) === -1) {
      this.startContainer = node;
      this.startOffset = offset;
    }
    this.endContainer = node;
    this.endOffset = offset;
    this.#updateRoot();
  }

  // https://dom.spec.whatwg.org/#dom-range-setstartbefore
  setStartBefore(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setStart(node.parentNode, node.getIndex());
  }

  setStartAfter(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setStart(node.parentNode, node.getIndex() + 1);
  }

  setEndBefore(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setEnd(node.parentNode, node.getIndex());
  }

  setEndAfter(node: NodeImpl): void {
    if (node.parentNode === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.setEnd(node.parentNode, node.getIndex() + 1);
  }

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

  // https://dom.spec.whatwg.org/#concept-range-select
  selectNode(node: NodeImpl): void {
    const parent = node.parentNode;
    if (parent === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.startContainer = this.endContainer = parent;
    this.startOffset = node.getIndex();
    this.endOffset = this.startOffset + 1;
    this.#updateRoot();
  }

  // https://dom.spec.whatwg.org/#dom-range-selectnodecontents
  selectNodeContents(node: NodeImpl): void {
    if (node.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    this.startContainer = this.endContainer = node;
    this.startOffset = 0;
    this.endOffset = node.getLength();
    this.#updateRoot();
  }

  /** Compatibility operation; detaching does not stop mutation adjustment. */
  // https://dom.spec.whatwg.org/#dom-range-detach
  detach(): void {}

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

  /** Compare two boundary points in the same ordinary tree without allocating point objects. */
  // https://dom.spec.whatwg.org/#concept-range-bp-position
  static #compareBoundaryPoints(
    nodeA: NodeImpl, offsetA: number, nodeB: NodeImpl, offsetB: number,
  ): -1 | 0 | 1 {
    if (nodeA === nodeB) return offsetA === offsetB ? 0 : offsetA < offsetB ? -1 : 1;
    const position = nodeA.comparePosition(nodeB);
    if (position === null) throw new InternalError('Boundary-point comparison requires a shared root');
    if (position === 1) return RangeImpl.#compareBoundaryPoints(nodeB, offsetB, nodeA, offsetA) === -1 ? 1 : -1;
    if (nodeA.contains(nodeB)) {
      let child = nodeB;
      while (child.parentNode !== nodeA) child = child.parentNode!;
      if (child.getIndex() < offsetA) return 1;
    }
    return -1;
  }

  /** Check the node kind and offset before changing a live boundary point. */
  // https://dom.spec.whatwg.org/#concept-range-bp-set
  static #validateBoundaryPoint(node: NodeImpl, offset: number): void {
    if (node.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    if (offset > node.getLength()) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
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

// The selection surface supports structural mutation tests. Content operations,
// comparison methods, cloning, and stringification remain in ROADMAP.md.
export const rangeIDL = defineInterface<DOMEnvironment>({
  name: 'Range', inherits: 'AbstractRange', exposed: 'Window', implementation: impl(RangeImpl),
  members: [
    ctor(
      [],
      {
        constructWith: [
          atArg(0, (ctx) => ctx.realm.getAssociatedDocument()),
          atArg(1, (ctx) => ctx.getEnvironment()),
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
    op('detach', idlType.undefined),
  ],
});
