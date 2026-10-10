import { describe, expect, it } from 'vitest';
import { createSandboxEnvironment } from '../../../../src/browlet/bindings';

import { TreeNode } from '../../../../src/browlet/dom/nodes/tree';

class TestNode extends TreeNode<TestNode> {
  constructor(public name: string) {
    super(createSandboxEnvironment());
  }

  insert(node: TestNode, reference: TestNode | null = null): void {
    super.insertTreeChild(node, reference);
  }

  detach(): void {
    super.removeTreeNode();
  }
}

describe('TreeNode', () => {
  it('starts detached', () => {
    const node = new TestNode('node');

    expect(node.parent).toBeNull();
    expect(node.firstChild).toBeNull();
    expect(node.lastChild).toBeNull();
    expect(node.previousSibling).toBeNull();
    expect(node.nextSibling).toBeNull();
  });

  it('inserts children before a reference or at the end', () => {
    const parent = new TestNode('parent');
    const first = new TestNode('first');
    const middle = new TestNode('middle');
    const last = new TestNode('last');

    parent.insert(first);
    parent.insert(last);
    parent.insert(middle, last);

    expect(parent.firstChild).toBe(first);
    expect(parent.lastChild).toBe(last);
    expect(first.parent).toBe(parent);
    expect(first.previousSibling).toBeNull();
    expect(first.nextSibling).toBe(middle);
    expect(middle.parent).toBe(parent);
    expect(middle.previousSibling).toBe(first);
    expect(middle.nextSibling).toBe(last);
    expect(last.parent).toBe(parent);
    expect(last.previousSibling).toBe(middle);
    expect(last.nextSibling).toBeNull();
  });

  it('moves and removes an existing node', () => {
    const firstParent = new TestNode('first parent');
    const secondParent = new TestNode('second parent');
    const before = new TestNode('before');
    const moved = new TestNode('moved');

    firstParent.insert(moved);
    secondParent.insert(before);
    moved.detach();
    secondParent.insert(moved, before);

    expect(firstParent.firstChild).toBeNull();
    expect(firstParent.lastChild).toBeNull();
    expect(secondParent.firstChild).toBe(moved);
    expect(moved.parent).toBe(secondParent);
    expect(moved.nextSibling).toBe(before);
    expect(before.previousSibling).toBe(moved);

    before.detach();
    secondParent.insert(before, moved);

    expect(secondParent.firstChild).toBe(before);
    expect(secondParent.lastChild).toBe(moved);
    expect(before.previousSibling).toBeNull();
    expect(before.nextSibling).toBe(moved);
    expect(moved.previousSibling).toBe(before);
    expect(moved.nextSibling).toBeNull();

    moved.detach();

    expect(moved.parent).toBeNull();
    expect(moved.previousSibling).toBeNull();
    expect(moved.nextSibling).toBeNull();
    expect(secondParent.firstChild).toBe(before);
    expect(before.previousSibling).toBeNull();
  });

  it('rejects attached insertions and foreign reference children without changing links', () => {
    const root = new TestNode('root');
    const child = new TestNode('child');
    const other = new TestNode('other');

    root.insert(child);

    expect(() => other.insert(child)).toThrow('Tree insertion requires a detached node');
    expect(() => other.insert(new TestNode('new'), child))
      .toThrow('Tree insertion reference must belong to the parent');
    expect(child.parent).toBe(root);
    expect(root.firstChild).toBe(child);
    expect(other.firstChild).toBeNull();
  });

  it('finds roots and tests inclusive containment', () => {
    const root = new TestNode('root');
    const parent = new TestNode('parent');
    const child = new TestNode('child');
    const other = new TestNode('other');

    root.insert(parent);
    parent.insert(child);

    expect(root.getRoot()).toBe(root);
    expect(child.getRoot()).toBe(root);
    expect(root.hasChildren()).toBe(true);
    expect(child.hasChildren()).toBe(false);
    expect(root.contains(root)).toBe(true);
    expect(root.contains(child)).toBe(true);
    expect(child.contains(root)).toBe(false);
    expect(root.contains(other)).toBe(false);
    expect(root.contains(null)).toBe(false);
  });

  it('compares connected nodes in tree order', () => {
    const root = new TestNode('root');
    const first = new TestNode('first');
    const descendant = new TestNode('descendant');
    const last = new TestNode('last');

    root.insert(first);
    root.insert(last);
    first.insert(descendant);

    expect(first.comparePosition(first)).toBe(0);
    expect(first.comparePosition(last)).toBe(-1);
    expect(last.comparePosition(first)).toBe(1);
    expect(root.comparePosition(descendant)).toBe(-1);
    expect(descendant.comparePosition(root)).toBe(1);
  });

  it('returns null for disconnected nodes', () => {
    const first = new TestNode('first');
    const second = new TestNode('second');

    expect(first.comparePosition(second)).toBeNull();
    expect(second.comparePosition(first)).toBeNull();
  });

});
