import { WeakOrderedSet } from '../../../infra/index';
import {
  defineInterface, idlType, impl, nullable, op, reference, roAttr, xattr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/core/index';

import type { NodeImpl } from '../nodes/index';
import type { DOMEnvironment } from '../environment';

import { FILTER_ACCEPT, getNodeFilterCallback, type NodeFilterCallback } from './node-filter';
import { NodeTraverser } from './node-traverser';

/** A filtered tree-order cursor which stays usable across subtree removal and adoption. */
// https://dom.spec.whatwg.org/#interface-nodeiterator
export class NodeIteratorImpl extends NodeTraverser {
  /** Register by fixed traversal root, so adoption needs no document-wide migration. */
  static #byRoot = new WeakMap<NodeImpl, WeakOrderedSet<NodeIteratorImpl>>();
  /** Committed position, updated only by acceptance or node removal. */
  #reference: NodePointer;
  /** In-flight position, also adjusted when an author filter removes nodes. */
  #candidate: NodePointer | null = null;

  constructor(root: NodeImpl, whatToShow: number, filter: NodeFilterCallback | null, env: DOMEnvironment) {
    super(root, whatToShow, filter, env);
    this.#reference = { node: root, before: true };
    let iterators = NodeIteratorImpl.#byRoot.get(root);
    if (!iterators) NodeIteratorImpl.#byRoot.set(root, iterators = new WeakOrderedSet());
    iterators.add(new WeakRef(this));
  }

  /** Notify only iterators rooted above the removal; roots inside it keep their own subtree. */
  // https://dom.spec.whatwg.org/#nodeiterator-pre-removing-steps
  static preRemove(node: NodeImpl): void {
    for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
      const iterators = this.#byRoot.get(ancestor);
      if (!iterators) continue;
      for (const iterator of iterators.values()) {
        iterator.#adjustPointer(iterator.#reference, node);
        if (iterator.#candidate !== null) iterator.#adjustPointer(iterator.#candidate, node);
      }
    }
  }

  get referenceNode(): NodeImpl {
    return this.#reference.node;
  }

  get pointerBeforeReferenceNode(): boolean {
    return this.#reference.before;
  }

  // https://dom.spec.whatwg.org/#dom-nodeiterator-nextnode
  nextNode(): NodeImpl | null {
    return this.#traverse(true);
  }

  // https://dom.spec.whatwg.org/#dom-nodeiterator-previousnode
  previousNode(): NodeImpl | null {
    return this.#traverse(false);
  }

  /** Compatibility operation; the iterator remains active. */
  // https://dom.spec.whatwg.org/#dom-nodeiterator-detach
  detach(): void {}

  // https://dom.spec.whatwg.org/#concept-nodeiterator-traverse
  #traverse(next: boolean): NodeImpl | null {
    // SPEC_CLASH(nodeiterator-reentrant-filter): DOM checks while filtering; Browlet follows Firefox's early traversal guard.
    // Reject before changing the outer candidate, even when this direction has no remaining nodes.
    if (this.active) throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    const candidate = { node: this.#reference.node, before: this.#reference.before };
    this.#candidate = candidate;
    try {
      while (true) {
        if (next) {
          if (!candidate.before) {
            const following = candidate.node.nextDescendant(this.root);
            if (following === null) return null;
            candidate.node = following;
          }
          candidate.before = false;
        } else {
          if (candidate.before) {
            if (candidate.node === this.root) return null;
            const previous = candidate.node.previousSibling;
            if (previous === null) {
              candidate.node = candidate.node.parentNode!;
            } else {
              candidate.node = previous;
              while (candidate.node.lastChild !== null) candidate.node = candidate.node.lastChild;
            }
          }
          candidate.before = true;
        }
        // A callback may remove this node and adjust the candidate; return the node
        // that was filtered, but commit the adjusted pointer for the next operation.
        const node = candidate.node;
        if (this.filterNode(node) === FILTER_ACCEPT) {
          this.#reference = candidate;
          return node;
        }
      }
    } finally {
      this.#candidate = null;
    }
  }

  // https://dom.spec.whatwg.org/#nodeiterator-adjust-a-node-pointer
  #adjustPointer(pointer: NodePointer, removed: NodeImpl): void {
    if (!removed.contains(pointer.node)) return;
    if (pointer.before) {
      for (let current = removed; current !== this.root; current = current.parentNode!) {
        if (current.nextSibling !== null) {
          pointer.node = current.nextSibling;
          return;
        }
      }
    }
    pointer.before = false;
    if (removed.previousSibling === null) {
      pointer.node = removed.parentNode!;
    } else {
      pointer.node = removed.previousSibling;
      while (pointer.node.lastChild !== null) pointer.node = pointer.node.lastChild;
    }
  }
}

/** Mutable cursor pair; candidate changes never alter the committed reference until acceptance. */
type NodePointer = { node: NodeImpl; before: boolean; };

export const nodeIteratorIDL = defineInterface({
  name: 'NodeIterator', exposed: 'Window', implementation: impl(NodeIteratorImpl),
  members: [
    roAttr('root', reference('Node'), xattr('SameObject')),
    roAttr('referenceNode', reference('Node')),
    roAttr('pointerBeforeReferenceNode', idlType.boolean),
    roAttr('whatToShow', idlType.unsignedLong),
    roAttr('filter', nullable(reference('NodeFilter')), {
      get() { return getNodeFilterCallback((this as NodeIteratorImpl).filter); },
    }),
    op('nextNode', nullable(reference('Node'))),
    op('previousNode', nullable(reference('Node'))),
    op('detach', idlType.undefined),
  ],
});
