import { describe, expect, it } from 'vitest';

import { TreeNode } from '../../../../src/domlet/tree/tree-node';

class TestNode extends TreeNode<TestNode> {
  constructor(readonly name: string) {
    super();
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

    parent.appendTreeChild(first);
    parent.appendTreeChild(last);
    last.insertTreeSiblingBefore(middle);

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

    firstParent.appendTreeChild(moved);
    secondParent.appendTreeChild(before);
    before.insertTreeSiblingBefore(moved);

    expect(firstParent.firstChild).toBeNull();
    expect(firstParent.lastChild).toBeNull();
    expect(secondParent.firstChild).toBe(moved);
    expect(moved.parent).toBe(secondParent);
    expect(moved.nextSibling).toBe(before);
    expect(before.previousSibling).toBe(moved);

    moved.insertTreeSiblingBefore(before);

    expect(secondParent.firstChild).toBe(before);
    expect(secondParent.lastChild).toBe(moved);
    expect(before.previousSibling).toBeNull();
    expect(before.nextSibling).toBe(moved);
    expect(moved.previousSibling).toBe(before);
    expect(moved.nextSibling).toBeNull();

    moved.remove();

    expect(moved.parent).toBeNull();
    expect(moved.previousSibling).toBeNull();
    expect(moved.nextSibling).toBeNull();
    expect(secondParent.firstChild).toBe(before);
    expect(before.previousSibling).toBeNull();
  });

  it('rejects detached references and cycles', () => {
    const root = new TestNode('root');
    const child = new TestNode('child');
    const other = new TestNode('other');

    root.appendTreeChild(child);

    expect(() => other.insertTreeSiblingBefore(new TestNode('new')))
      .toThrow('Cannot insert before a detached node');
    expect(() => child.appendTreeChild(root))
      .toThrow('Cannot insert a node into itself or its descendant');
  });

  it('finds roots and tests inclusive containment', () => {
    const root = new TestNode('root');
    const parent = new TestNode('parent');
    const child = new TestNode('child');
    const other = new TestNode('other');

    root.appendTreeChild(parent);
    parent.appendTreeChild(child);

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

    root.appendTreeChild(first);
    root.appendTreeChild(last);
    first.appendTreeChild(descendant);

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
