import { attr, defineInterface, idlType, impl, nullable, op, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { NodeImpl } from '../nodes/index';
import type { DOMEnvironment } from '../environment';

import { FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP, getNodeFilterCallback, type NodeFilterCallback } from './node-filter';
import { NodeTraverser } from './node-traverser';

/** A cursor over a filtered view of a live tree; rejected nodes prune their subtrees. */
// https://dom.spec.whatwg.org/#interface-treewalker
export class TreeWalkerImpl extends NodeTraverser {
  /** Current position; removal leaves it in place and authors may select nodes outside the root. */
  currentNode: NodeImpl;

  constructor(root: NodeImpl, whatToShow: number, filter: NodeFilterCallback | null, env: DOMEnvironment) {
    super(root, whatToShow, filter, env);
    this.currentNode = root;
  }

  /** Move to the first accepted ancestor, considering the root but never crossing it. */
  // https://dom.spec.whatwg.org/#dom-treewalker-parentnode
  parentNode(): NodeImpl | null {
    let node: NodeImpl | null = this.currentNode;
    while (node !== null && node !== this.root) {
      node = node.parentNode;
      if (node !== null && this.filterNode(node) === FILTER_ACCEPT) return this.currentNode = node;
    }
    return null;
  }

  /** Move to the first child in the filtered view, descending through skipped nodes. */
  // https://dom.spec.whatwg.org/#dom-treewalker-firstchild
  firstChild(): NodeImpl | null {
    return this.#traverseChildren('first');
  }

  /** Move to the last child in the filtered view, descending through skipped nodes. */
  // https://dom.spec.whatwg.org/#dom-treewalker-lastchild
  lastChild(): NodeImpl | null {
    return this.#traverseChildren('last');
  }

  /** Move to the preceding sibling in the filtered view. */
  // https://dom.spec.whatwg.org/#dom-treewalker-previoussibling
  previousSibling(): NodeImpl | null {
    return this.#traverseSiblings('previous');
  }

  /** Move to the following sibling in the filtered view. */
  // https://dom.spec.whatwg.org/#dom-treewalker-nextsibling
  nextSibling(): NodeImpl | null {
    return this.#traverseSiblings('next');
  }

  /** Move backward in tree order, pruning rejected subtrees. */
  // https://dom.spec.whatwg.org/#dom-treewalker-previousnode
  previousNode(): NodeImpl | null {
    let node = this.currentNode;
    while (node !== this.root) {
      let sibling = node.previousSibling;
      while (sibling !== null) {
        node = sibling;
        let result = this.filterNode(node);
        while (result !== FILTER_REJECT && node.lastChild !== null) {
          node = node.lastChild;
          result = this.filterNode(node);
        }
        if (result === FILTER_ACCEPT) return this.currentNode = node;
        sibling = node.previousSibling;
      }
      if (node === this.root || node.parentNode === null) return null;
      node = node.parentNode;
      if (this.filterNode(node) === FILTER_ACCEPT) return this.currentNode = node;
    }
    return null;
  }

  /** Move forward in tree order, pruning rejected subtrees. */
  // https://dom.spec.whatwg.org/#dom-treewalker-nextnode
  nextNode(): NodeImpl | null {
    let node = this.currentNode;
    let result = FILTER_ACCEPT;
    // SPEC_CLASH(treewalker-unrecognized-filter-result): DOM/Firefox descend for any non-reject result; Chromium/WebKit require skip after a sibling step.
    // Follow DOM and Firefox for unrecognized callback results.
    while (true) {
      while (result !== FILTER_REJECT && node.firstChild !== null) {
        node = node.firstChild;
        result = this.filterNode(node);
        if (result === FILTER_ACCEPT) return this.currentNode = node;
      }
      let sibling: NodeImpl | null = null;
      let temporary: NodeImpl | null = node;
      while (temporary !== null) {
        if (temporary === this.root) return null;
        sibling = temporary.nextSibling;
        if (sibling !== null) break;
        temporary = temporary.parentNode;
      }
      if (sibling === null) return null;
      node = sibling;
      result = this.filterNode(node);
      if (result === FILTER_ACCEPT) return this.currentNode = node;
    }
  }

  // https://dom.spec.whatwg.org/#concept-traverse-children
  #traverseChildren(type: 'first' | 'last'): NodeImpl | null {
    const first = type === 'first';
    let node = first ? this.currentNode.firstChild : this.currentNode.lastChild;
    while (node !== null) {
      const result = this.filterNode(node);
      if (result === FILTER_ACCEPT) return this.currentNode = node;
      if (result === FILTER_SKIP) {
        const child = first ? node.firstChild : node.lastChild;
        if (child !== null) {
          node = child;
          continue;
        }
      }
      while (true) {
        const sibling = first ? node.nextSibling : node.previousSibling;
        if (sibling !== null) {
          node = sibling;
          break;
        }
        const parent: NodeImpl | null = node.parentNode;
        if (parent === null || parent === this.root || parent === this.currentNode) return null;
        node = parent;
      }
    }
    return null;
  }

  // https://dom.spec.whatwg.org/#concept-traverse-siblings
  #traverseSiblings(type: 'next' | 'previous'): NodeImpl | null {
    const next = type === 'next';
    let node = this.currentNode;
    if (node === this.root) return null;
    while (true) {
      let sibling = next ? node.nextSibling : node.previousSibling;
      while (sibling !== null) {
        node = sibling;
        const result = this.filterNode(node);
        if (result === FILTER_ACCEPT) return this.currentNode = node;
        sibling = next ? node.firstChild : node.lastChild;
        if (result === FILTER_REJECT || sibling === null) {
          sibling = next ? node.nextSibling : node.previousSibling;
        }
      }
      const parent: NodeImpl | null = node.parentNode;
      if (parent === null || parent === this.root) return null;
      node = parent;
      if (this.filterNode(node) === FILTER_ACCEPT) return null;
    }
  }
}

/*
 * [Exposed=Window]
 * interface TreeWalker {
 *   [SameObject] readonly attribute Node root;
 *   readonly attribute unsigned long whatToShow;
 *   readonly attribute NodeFilter? filter;
 *   attribute Node currentNode;
 *
 *   Node? parentNode();
 *   Node? firstChild();
 *   Node? lastChild();
 *   Node? previousSibling();
 *   Node? nextSibling();
 *   Node? previousNode();
 *   Node? nextNode();
 * };
 */
export const treeWalkerIDL = defineInterface({
  name: 'TreeWalker', exposed: 'Window', implementation: impl(TreeWalkerImpl),
  members: [
    roAttr('root', reference('Node'), xattr('SameObject')),
    roAttr('whatToShow', idlType.unsignedLong),
    roAttr('filter', nullable(reference('NodeFilter')), {
      get() { return getNodeFilterCallback((this as TreeWalkerImpl).filter); },
    }),
    attr('currentNode', reference('Node')),
    op('parentNode', nullable(reference('Node'))),
    op('firstChild', nullable(reference('Node'))),
    op('lastChild', nullable(reference('Node'))),
    op('previousSibling', nullable(reference('Node'))),
    op('nextSibling', nullable(reference('Node'))),
    op('previousNode', nullable(reference('Node'))),
    op('nextNode', nullable(reference('Node'))),
  ],
});
