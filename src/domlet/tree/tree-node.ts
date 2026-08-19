import {
  EventTargetImpl, type EventTargetVirtuals,
} from '../events/event-target';

export abstract class TreeNode<TNode extends TreeNode<TNode>>
  extends EventTargetImpl
{
  #parent: TNode | null = null;
  #firstChild: TNode | null = null;
  #lastChild: TNode | null = null;
  #previousSibling: TNode | null = null;
  #nextSibling: TNode | null = null;
  readonly #virtuals: TreeNodeVirtuals<TNode>;

  constructor(
    eventTargetVirtuals: EventTargetVirtuals = {},
    virtuals: TreeNodeVirtuals<TNode> = {},
  ) {
    super(eventTargetVirtuals);
    this.#virtuals = virtuals;
  }

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

  getRoot(): TNode {
    if (!this.#parent) return this.#asNode();

    let root = this.#parent;
    while (root.#parent) root = root.#parent;
    return root;
  }

  hasChildren(): boolean {
    return this.#firstChild !== null;
  }

  contains(other: TNode | null): boolean {
    if (!other) return false;
    if (other === this.#asNode()) return true;

    for (let ancestor = other.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === this.#asNode()) return true;
    }

    return false;
  }

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
    TreeNode.insertSiblingBefore(this.#asNode(), node);
  }

  insertTreeSiblingAfter(node: TNode): void {
    const parent = this.#parent;
    if (!parent) throw new Error('Cannot insert after a detached node');

    parent.#insertChild(node, this.#nextSibling);
  }

  prependChild(node: TNode): void {
    this.#insertChild(node, this.#firstChild);
  }

  appendTreeChild(node: TNode): void {
    this.#insertChild(node, null);
  }

  remove(): void {
    if (!this.#parent) return;

    this.#detach();
  }

  // -- Friends ----------------------------------------------------------

  static insertSiblingBefore<TNode extends TreeNode<TNode>>(
    reference: TreeNode<TNode>,
    node: TNode,
  ): void {
    const parent = reference.#parent;
    if (!parent) throw new Error('Cannot insert before a detached node');

    parent.#insertChild(node, reference.#asNode());
  }

  static notifyParentChildrenChanged<TNode extends TreeNode<TNode>>(
    node: TreeNode<TNode>,
  ): void {
    const parent = node.#parent;
    if (parent) parent.#virtuals.childrenChanged?.(parent);
  }

  static appendChild<TNode extends TreeNode<TNode>>(
    parent: TreeNode<TNode>,
    node: TNode,
  ): void {
    parent.#insertChild(node, null);
  }

  static getRoot<TNode extends TreeNode<TNode>>(
    node: TreeNode<TNode>,
  ): TNode {
    let root = node.#asNode();
    while (root.#parent) root = root.#parent;
    return root;
  }

  // -- Private ----------------------------------------------------------

  #insertChild(node: TNode, reference: TNode | null): void {
    if (node === this.#asNode()) {
      throw new Error('Cannot insert a node into itself or its descendant');
    }

    for (let ancestor = this.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === node) {
        throw new Error('Cannot insert a node into itself or its descendant');
      }
    }

    if (
      reference === node ||
      (node.#parent === this.#asNode() && node.#nextSibling === reference)
    ) {
      return;
    }

    node.#detach();

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
    this.#virtuals.childrenChanged?.(this.#asNode());
  }

  #detach(): void {
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
    parent.#virtuals.childrenChanged?.(parent);
  }

  #notifyInsertedSubtree(parent: TNode): void {
    this.#virtuals.insertedInto?.(this.#asNode(), parent);

    for (let child = this.#firstChild; child; child = child.#nextSibling) {
      child.#notifyInsertedSubtree(this.#asNode());
    }
  }

  #notifyRemovedSubtree(parent: TNode): void {
    this.#virtuals.removedFrom?.(this.#asNode(), parent);

    for (let child = this.#firstChild; child; child = child.#nextSibling) {
      child.#notifyRemovedSubtree(this.#asNode());
    }
  }

  // TypeScript cannot express that an F-bounded base instance is its node type.
  #asNode(): TNode {
    return this as unknown as TNode;
  }
}

export type TreeNodeVirtuals<TNode> = {
  readonly insertedInto?: (node: TNode, parent: TNode) => void;
  readonly removedFrom?: (node: TNode, parent: TNode) => void;
  readonly childrenChanged?: (node: TNode) => void;
};
