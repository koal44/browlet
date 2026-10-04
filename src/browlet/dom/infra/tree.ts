import { EventTargetImpl } from '../events/event-target';
import { InternalError } from '../../../infra/internal-error';

/** Tree links and raw storage operations. */
// https://dom.spec.whatwg.org/#trees
export abstract class TreeNode<TNode extends TreeNode<TNode>>
  extends EventTargetImpl
{
  // Mutations update both ends of each link and notify affected nodes together.
  // Keep storage private so individual assignments cannot bypass those steps.
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
    if (!this.#parent) return this.#asNode();

    let root = this.#parent;
    while (root.#parent) root = root.#parent;
    return root;
  }

  hasChildren(): boolean {
    return this.#firstChild !== null;
  }

  // https://dom.spec.whatwg.org/#concept-tree-inclusive-descendant
  contains(other: TNode | null): boolean {
    if (!other) return false;
    if (other === this.#asNode()) return true;

    for (let ancestor = other.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === this.#asNode()) return true;
    }

    return false;
  }

  // https://dom.spec.whatwg.org/#concept-tree-order
  comparePosition(other: TNode): -1 | 0 | 1 | null {
    if (other === this.#asNode()) return 0;

    const thisChain: TNode[] = [this.#asNode()];
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

  insertTreeSiblingBefore(node: TNode): void {
    const parent = this.#parent;
    if (!parent) throw new InternalError('Cannot insert before a detached node');

    parent.#insertChild(node, this.#asNode());
  }

  insertTreeSiblingAfter(node: TNode): void {
    const parent = this.#parent;
    if (!parent) throw new InternalError('Cannot insert after a detached node');

    parent.#insertChild(node, this.#nextSibling);
  }

  prependChild(node: TNode): void {
    this.#insertChild(node, this.#firstChild);
  }

  appendTreeChild(node: TNode): void {
    this.#insertChild(node, null);
  }

  removeFromTree(): void {
    const parent = this.#parent;
    if (!parent) return;

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

    this.#notifyRemovedSubtree(parent);
    parent.childrenChanged();
  }

  notifyParentChildrenChanged(): void {
    const parent = this.#parent;
    parent?.childrenChanged();
  }

  protected insertedInto(_parent: TNode): void {}

  protected removedFrom(_parent: TNode): void {}

  protected childrenChanged(): void {}

  // -- Private ----------------------------------------------------------

  #insertChild(node: TNode, reference: TNode | null): void {
    if (node === this.#asNode()) {
      throw new InternalError('Cannot insert a node into itself or its descendant');
    }

    for (let ancestor = this.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === node) {
        throw new InternalError('Cannot insert a node into itself or its descendant');
      }
    }

    if (
      reference === node ||
      (node.#parent === this.#asNode() && node.#nextSibling === reference)
    ) {
      return;
    }

    node.removeFromTree();

    const previous = reference ? reference.#previousSibling : this.#lastChild;

    node.#parent = this.#asNode();
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

    node.#notifyInsertedSubtree(this.#asNode());
    this.childrenChanged();
  }

  #notifyInsertedSubtree(parent: TNode): void {
    this.insertedInto(parent);

    for (let child = this.#firstChild; child; child = child.#nextSibling) {
      child.#notifyInsertedSubtree(this.#asNode());
    }
  }

  #notifyRemovedSubtree(parent: TNode): void {
    this.removedFrom(parent);

    for (let child = this.#firstChild; child; child = child.#nextSibling) {
      child.#notifyRemovedSubtree(this.#asNode());
    }
  }

  // TypeScript cannot express that an F-bounded base instance is its node type.
  #asNode(): TNode {
    return this as unknown as TNode;
  }
}
