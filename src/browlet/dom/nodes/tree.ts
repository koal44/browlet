import { InternalError } from '../../../infra/internal-error';

import { EventTargetImpl } from '../events/index';

/** Tree links and raw storage operations shared by DOM nodes. */
// https://dom.spec.whatwg.org/#trees
export abstract class TreeNode<TNode extends TreeNode<TNode>>
  extends EventTargetImpl
{
  // DOM algorithms own adoption and notifications; these primitives only update links.
  // Preserve node-link types when checking the emitted JavaScript.
  /** @type {TreeNode | null} */
  #parent: TNode | null = null;
  /** @type {TreeNode | null} */
  #firstChild: TNode | null = null;
  /** @type {TreeNode | null} */
  #lastChild: TNode | null = null;
  /** @type {TreeNode | null} */
  #previousSibling: TNode | null = null;
  /** @type {TreeNode | null} */
  #nextSibling: TNode | null = null;

  get parent(): TNode | null {
    return this.#parent;
  }

  get firstChild(): TNode | null {
    return this.#firstChild;
  }

  get lastChild(): TNode | null {
    return this.#lastChild;
  }

  get previousSibling(): TNode | null {
    return this.#previousSibling;
  }

  get nextSibling(): TNode | null {
    return this.#nextSibling;
  }

  // https://dom.spec.whatwg.org/#concept-tree-root
  getRoot(): TNode {
    if (!this.#parent) return this as unknown as TNode;

    let root = this.#parent;
    while (root.#parent) root = root.#parent;
    return root;
  }

  hasChildren(): boolean {
    return this.#firstChild !== null;
  }

  /** Number of preceding siblings in this node's current tree. */
  // https://dom.spec.whatwg.org/#concept-tree-index
  getIndex(): number {
    let index = 0;
    for (let sibling = this.#previousSibling; sibling; sibling = sibling.#previousSibling) index++;
    return index;
  }

  // https://dom.spec.whatwg.org/#concept-tree-inclusive-descendant
  contains(other: TNode | null): boolean {
    if (!other) return false;
    if (other === (this as unknown as TNode)) return true;

    for (let ancestor = other.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === (this as unknown as TNode)) return true;
    }

    return false;
  }

  // https://dom.spec.whatwg.org/#concept-tree-order
  comparePosition(other: TNode): -1 | 0 | 1 | null {
    if (other === (this as unknown as TNode)) return 0;

    const thisChain: TNode[] = [this as unknown as TNode];
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

  /** Unlink an attached node after the DOM's pre-removal steps have run. */
  protected removeTreeNode(): void {
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
  protected insertTreeChild(node: TNode, reference: TNode | null): void {
    if (node.#parent !== null) {
      throw new InternalError('Tree insertion requires a detached node');
    }
    if (reference !== null && reference.#parent !== (this as unknown as TNode)) {
      throw new InternalError('Tree insertion reference must belong to the parent');
    }

    const previous = reference ? reference.#previousSibling : this.#lastChild;

    node.#parent = this as unknown as TNode;
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
