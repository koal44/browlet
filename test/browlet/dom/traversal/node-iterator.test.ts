import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('NodeIterator traversal', () => {
  it('walks in both directions including its root, and detach is a no-op', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const a = root.appendChild(document.createElement('a'));
      const text = a.appendChild(document.createTextNode('text'));
      const b = root.appendChild(document.createElement('b'));
      const iterator = document.createNodeIterator(root);
      const initial = [iterator.root === root, iterator.referenceNode === root, iterator.pointerBeforeReferenceNode,
        iterator.whatToShow === 0xffffffff, iterator.filter === null, iterator.previousNode() === null];
      const forward = [root, a, text, b, null].map((node) => iterator.nextNode() === node);
      iterator.detach();
      const backward = [b, text, a, root, null].map((node) => iterator.previousNode() === node);
      return [initial, forward, backward];
    })).toEqual([[true, true, true, true, true, true], [true, true, true, true, true], [true, true, true, true, true]]);
  });

  it('applies whatToShow first and treats FILTER_REJECT like FILTER_SKIP', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const skipped = root.appendChild(document.createElement('skipped'));
      const selected = skipped.appendChild(document.createElement('selected'));
      selected.appendChild(document.createTextNode('hidden'));
      const calls: string[] = [];
      const filter = (node: Node) => {
        calls.push((node as Element).localName);
        return node === selected ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      };
      const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, filter);
      return [iterator.filter === filter, iterator.nextNode() === selected, iterator.nextNode() === null, calls];
    })).toEqual([true, true, true, ['root', 'skipped', 'selected']]);
  });

  it('preserves object-filter identity and dynamic operation lookup', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      const receivers: boolean[] = [];
      const filter = {
        acceptNode(node: Node): number {
          receivers.push(this === filter);
          return node === root ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
        },
      };
      const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ALL, filter);
      const first = iterator.nextNode() === child;
      filter.acceptNode = function() { receivers.push(this === filter); return NodeFilter.FILTER_REJECT; };
      return [iterator.filter === filter, first, iterator.previousNode() === null, receivers];
    })).toEqual([true, true, true, [true, true, true, true]]);
  });

  it('clears the active flag after a callback throws without committing the candidate', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const failure = new Error('filter failure');
      let shouldThrow = true;
      const iterator = document.createNodeIterator(root, 0xffffffff, () => {
        if (shouldThrow) throw failure;
        return 1;
      });
      let caught: unknown;
      try { iterator.nextNode(); } catch (error) { caught = error; }
      const unchanged = iterator.referenceNode === root && iterator.pointerBeforeReferenceNode;
      shouldThrow = false;
      return [caught === failure, unchanged, iterator.nextNode() === root];
    })).toEqual([true, true, true]);
  });

  it.each(['nextNode', 'previousNode'] as const)('rejects uncaught recursive %s and remains usable afterward', async (direction) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((direction) => {
      const root = document.createElement('root');
      let recurse = true;
      const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ALL, () => {
        if (recurse) iterator[direction]();
        return NodeFilter.FILTER_ACCEPT;
      });
      let caught: unknown;
      try { iterator.nextNode(); } catch (error) { caught = error; }
      const unchanged = iterator.referenceNode === root && iterator.pointerBeforeReferenceNode;
      recurse = false;
      return [caught instanceof DOMException && caught.name, unchanged, iterator.nextNode() === root];
    }, direction)).toEqual(['InvalidStateError', true, true]);
  });

  it.each(['nextNode', 'previousNode'] as const)('preserves traversal when the filter catches recursive %s', async (direction) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((direction) => {
      const root = document.createElement('root');
      let recurse = true;
      let caught: unknown;
      let calls = 0;
      const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ALL, () => {
        calls++;
        if (recurse) {
          recurse = false;
          try { iterator[direction](); } catch (error) { caught = error; }
        }
        return NodeFilter.FILTER_ACCEPT;
      });
      const returnedRoot = iterator.nextNode() === root;
      const afterRoot = iterator.referenceNode === root && !iterator.pointerBeforeReferenceNode;
      const atEnd = iterator.nextNode() === null;
      const returnedBackwards = iterator.previousNode() === root;
      const beforeRoot = iterator.referenceNode === root && iterator.pointerBeforeReferenceNode;
      return {
        error: caught instanceof DOMException && caught.name, returnedRoot, afterRoot,
        atEnd, returnedBackwards, beforeRoot, atStart: iterator.previousNode() === null, calls,
      };
    }, direction)).toEqual({
      error: 'InvalidStateError', returnedRoot: true, afterRoot: true,
      atEnd: true, returnedBackwards: true, beforeRoot: true, atStart: true, calls: 2,
    });
  });

  it('exposes the complete filtering constants including legacy node kinds', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => [
      NodeFilter.FILTER_ACCEPT, NodeFilter.FILTER_REJECT, NodeFilter.FILTER_SKIP,
      NodeFilter.SHOW_ALL, NodeFilter.SHOW_ENTITY_REFERENCE, NodeFilter.SHOW_ENTITY, NodeFilter.SHOW_NOTATION,
    ])).toEqual([1, 2, 3, 0xffffffff, 0x10, 0x20, 0x800]);
  });
});

describe('NodeIterator pre-removal', () => {
  it.each([true, false])('adjusts a pointer before a removed subtree, with a following sibling: %s', async (hasFollowing) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((hasFollowing) => {
      const root = document.createElement('root');
      const previous = root.appendChild(document.createElement('previous'));
      const last = previous.appendChild(document.createTextNode('last'));
      const removed = root.appendChild(document.createElement('removed'));
      const selected = removed.appendChild(document.createTextNode('selected'));
      const next = hasFollowing ? root.appendChild(document.createElement('next')) : null;
      const iterator = document.createNodeIterator(root);
      while (iterator.nextNode() !== selected) { /* reach the descendant */ }
      iterator.previousNode();
      root.removeChild(removed);
      return [iterator.referenceNode === (next ?? last), iterator.pointerBeforeReferenceNode, iterator.nextNode() === next];
    }, hasFollowing)).toEqual([true, hasFollowing, true]);
  });

  it('leaves an iterator rooted inside a removed subtree intact across adoption', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const root = parent.appendChild(document.createElement('root'));
      const a = root.appendChild(document.createElement('a'));
      const b = root.appendChild(document.createElement('b'));
      const iterator = document.createNodeIterator(root);
      iterator.nextNode();
      iterator.nextNode();
      new Document().adoptNode(root);
      const retained = iterator.referenceNode === a;
      root.removeChild(a);
      return [retained, iterator.referenceNode === root, iterator.nextNode() === b];
    })).toEqual([true, true, true]);
  });

  it.each([1, 3])('adjusts the candidate when its filter removes it and returns %s', async (result) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((result) => {
      const root = document.createElement('root');
      const removed = root.appendChild(document.createElement('removed'));
      const next = root.appendChild(document.createElement('next'));
      const iterator = document.createNodeIterator(root, 0xffffffff, (node) => {
        if (node === root) return 3;
        if (node === removed) { root.removeChild(removed); return result; }
        return 1;
      });
      const returned = iterator.nextNode();
      return [returned === (result === 1 ? removed : next),
        iterator.referenceNode === (result === 1 ? root : next),
        iterator.nextNode() === (result === 1 ? next : null)];
    }, result)).toEqual([true, true, true]);
  });

  it.each(['nextNode', 'previousNode'] as const)('retains removal adjustment after catching recursive %s', async (direction) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((direction) => {
      const root = document.createElement('root');
      const removed = root.appendChild(document.createElement('removed'));
      const next = root.appendChild(document.createElement('next'));
      let recurse = true;
      let caught: unknown;
      const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ALL, (node) => {
        if (node === root) return NodeFilter.FILTER_SKIP;
        if (node === removed && recurse) {
          recurse = false;
          try { iterator[direction](); } catch (error) { caught = error; }
          root.removeChild(removed);
        }
        return NodeFilter.FILTER_ACCEPT;
      });
      const returnedRemoved = iterator.nextNode() === removed;
      const adjusted = iterator.referenceNode === root && !iterator.pointerBeforeReferenceNode;
      return {
        error: caught instanceof DOMException && caught.name, returnedRemoved, adjusted,
        nextNode: iterator.nextNode() === next, atEnd: iterator.nextNode() === null,
      };
    }, direction)).toEqual({
      error: 'InvalidStateError', returnedRemoved: true, adjusted: true,
      nextNode: true, atEnd: true,
    });
  });

  it('adjusts committed and candidate pointers when a filter removes their ancestor', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const removed = root.appendChild(document.createElement('removed'));
      const child = removed.appendChild(document.createElement('child'));
      const next = root.appendChild(document.createElement('next'));
      const iterator = document.createNodeIterator(root, 0xffffffff, (node) => {
        if (node === child) { root.removeChild(removed); return 3; }
        return 1;
      });
      iterator.nextNode();
      iterator.nextNode();
      return [iterator.nextNode() === next, iterator.referenceNode === next, removed.parentNode === null];
    })).toEqual([true, true, true]);
  });

  it('adjusts a backward candidate without skipping the preceding sibling', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const before = root.appendChild(document.createElement('before'));
      const removed = root.appendChild(document.createElement('removed'));
      const after = root.appendChild(document.createElement('after'));
      let remove = false;
      const iterator = document.createNodeIterator(root, 0xffffffff, (node) => {
        if (remove && node === removed) root.removeChild(removed);
        return 1;
      });
      while (iterator.nextNode() !== after) { /* position after the last node */ }
      iterator.previousNode();
      remove = true;
      return [iterator.previousNode() === removed, iterator.referenceNode === after,
        iterator.pointerBeforeReferenceNode, iterator.previousNode() === before];
    })).toEqual([true, true, true, true]);
  });
});
