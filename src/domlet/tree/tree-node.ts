export abstract class TreeNode {
  #parent: TreeNode | null = null;
  #firstChild: TreeNode | null = null;
  #lastChild: TreeNode | null = null;
  #previousSibling: TreeNode | null = null;
  #nextSibling: TreeNode | null = null;

  get parent(): TreeNode | null {
    return this.#parent;
  }

  get firstChild(): TreeNode | null {
    return this.#firstChild;
  }

  get lastChild(): TreeNode | null {
    return this.#lastChild;
  }

  get previousSibling(): TreeNode | null {
    return this.#previousSibling;
  }

  get nextSibling(): TreeNode | null {
    return this.#nextSibling;
  }

  getRoot(): TreeNode {
    if (!this.#parent) return this;

    let root = this.#parent;
    while (root.#parent) root = root.#parent;
    return root;
  }

  hasChildren(): boolean {
    return this.#firstChild !== null;
  }

  contains(other: TreeNode | null): boolean {
    if (!other) return false;
    if (other === this) return true;

    for (let ancestor = other.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === this) return true;
    }

    return false;
  }

  comparePosition(other: TreeNode): -1 | 0 | 1 | null {
    if (other === this) return 0;

    const thisChain: TreeNode[] = [this];
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

  insertBefore(node: TreeNode): void {
    const parent = this.#parent;
    if (!parent) throw new Error('Cannot insert before a detached node');

    parent.#insertChild(node, this);
  }

  insertAfter(node: TreeNode): void {
    const parent = this.#parent;
    if (!parent) throw new Error('Cannot insert after a detached node');

    parent.#insertChild(node, this.#nextSibling);
  }

  prependChild(node: TreeNode): void {
    this.#insertChild(node, this.#firstChild);
  }

  appendChild(node: TreeNode): void {
    this.#insertChild(node, null);
  }

  remove(): void {
    if (!this.#parent) return;

    this.#detach();
  }

  #insertChild(node: TreeNode, reference: TreeNode | null): void {
    if (node === this) {
      throw new Error('Cannot insert a node into itself or its descendant');
    }

    for (let ancestor = this.#parent; ancestor; ancestor = ancestor.#parent) {
      if (ancestor === node) {
        throw new Error('Cannot insert a node into itself or its descendant');
      }
    }

    if (
      reference === node ||
      (node.#parent === this && node.#nextSibling === reference)
    ) {
      return;
    }

    node.#detach();

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
  }
}
