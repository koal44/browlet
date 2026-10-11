import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('TreeWalker traversal', () => {
  it('starts at its root, exposes its configuration, and has no public constructor', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createDocumentFragment();
      const walker = document.createTreeWalker(root);
      let error: unknown;
      try { Reflect.construct(TreeWalker, []); } catch (caught) { error = caught; }
      return [walker instanceof TreeWalker, walker.root === root, walker.currentNode === root,
        walker.whatToShow, walker.filter, walker !== document.createTreeWalker(root),
        Object.prototype.toString.call(walker), error instanceof TypeError];
    })).toEqual([true, true, true, 0xffffffff, null, true, '[object TreeWalker]', true]);
  });

  it('walks parents, children, siblings, and tree order without crossing the root', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const outside = document.createElement('outside');
      const root = outside.appendChild(document.createElement('root'));
      outside.appendChild(document.createElement('beyond'));
      const a = root.appendChild(document.createElement('a'));
      const text = a.appendChild(document.createTextNode('text'));
      const b = root.appendChild(document.createElement('b'));
      const walker = document.createTreeWalker(root);
      const boundaries = [walker.parentNode(), walker.previousSibling(), walker.nextSibling(), walker.previousNode()];
      const forward = [a, text, b, null].map((node) => walker.nextNode() === node);
      const backward = [text, a, root, null].map((node) => walker.previousNode() === node);
      const relatives = [walker.firstChild() === a, walker.nextSibling() === b,
        walker.previousSibling() === a, walker.firstChild() === text, walker.parentNode() === a,
        walker.parentNode() === root, walker.lastChild() === b, walker.lastChild() === null,
        walker.currentNode === b];
      return [boundaries, forward, backward, relatives];
    })).toEqual([[null, null, null, null], [true, true, true, true], [true, true, true, true], Array(9).fill(true)]);
  });

  it('skips nodes but prunes rejected subtrees in both traversal directions', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const skip = root.appendChild(document.createElement('skip'));
      const a = skip.appendChild(document.createElement('a'));
      const reject = skip.appendChild(document.createElement('reject'));
      reject.appendChild(document.createElement('hidden'));
      const b = skip.appendChild(document.createElement('skip')).appendChild(document.createElement('b'));
      root.appendChild(document.createElement('reject')).appendChild(document.createElement('hidden'));
      const c = root.appendChild(document.createElement('c'));
      const d = c.appendChild(document.createElement('d'));
      const calls: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) => {
        const name = (node as Element).localName;
        calls.push(name);
        return name === 'skip' ? NodeFilter.FILTER_SKIP : name === 'reject' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      });
      const forward = [a, b, c, d, null].map((node) => walker.nextNode() === node);
      const backward = [c, b, a, root, null].map((node) => walker.previousNode() === node);
      return [forward, backward, calls.includes('hidden')];
    })).toEqual([Array(5).fill(true), Array(5).fill(true), false]);
  });

  it('uses the filtered hierarchy for children and siblings, stopping at accepted parents', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const skip = root.appendChild(document.createElement('skip'));
      skip.appendChild(document.createElement('reject')).appendChild(document.createElement('hidden'));
      const a = skip.appendChild(document.createElement('a'));
      const b = skip.appendChild(document.createElement('skip')).appendChild(document.createElement('b'));
      const c = root.appendChild(document.createElement('c'));
      const child = c.appendChild(document.createElement('child'));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) => {
        const name = (node as Element).localName;
        return name === 'skip' ? NodeFilter.FILTER_SKIP : name === 'reject' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      });
      const siblings = [walker.firstChild() === a, walker.previousSibling() === null,
        walker.nextSibling() === b, walker.nextSibling() === c, walker.nextSibling() === null,
        walker.previousSibling() === b, walker.previousSibling() === a];
      walker.currentNode = root;
      const last = walker.lastChild() === c;
      walker.currentNode = skip;
      const skippedLast = walker.lastChild() === b;
      walker.currentNode = child;
      return [siblings, last, skippedLast, walker.previousSibling(), walker.nextSibling(),
        walker.currentNode === child, walker.parentNode() === c];
    })).toEqual([Array(7).fill(true), true, true, null, null, true, true]);
  });

  it('ascends through skipped and rejected ancestors, but never above the root', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const outer = document.createElement('outer');
      const root = outer.appendChild(document.createElement('root'));
      const child = root.appendChild(document.createElement('reject')).appendChild(document.createElement('skip'));
      const leaf = child.appendChild(document.createElement('leaf'));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) =>
        node === root ? NodeFilter.FILTER_ACCEPT : node === child ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT);
      walker.currentNode = leaf;
      return [walker.parentNode() === root, walker.parentNode(), walker.currentNode === root];
    })).toEqual([true, null, true]);
  });

  it('allows currentNode outside the root and in another document without filtering it', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const other = new Document();
      const outside = other.appendChild(other.createElement('outside'));
      const child = outside.appendChild(other.createElement('child'));
      let calls = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, () => { calls++; return NodeFilter.FILTER_ACCEPT; });
      walker.currentNode = outside;
      const before = calls;
      const moved = walker.nextNode() === child;
      return [before, moved, walker.parentNode() === outside, walker.parentNode() === other,
        walker.root === root, walker.currentNode === other];
    })).toEqual([0, true, true, true, true, true]);
  });

  it('does not cross into shadow trees or traverse an element\'s attributes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('title', 'attribute');
      const light = host.appendChild(document.createTextNode('light'));
      const shadow = host.attachShadow({ mode: 'open' });
      const slot = shadow.appendChild(document.createElement('slot'));
      const walker = document.createTreeWalker(host);
      const shadowWalker = document.createTreeWalker(shadow);
      const attrWalker = document.createTreeWalker(host.getAttributeNode('title')!);
      return [walker.nextNode() === light, walker.nextNode(), shadowWalker.nextNode() === slot,
        shadowWalker.nextNode(), shadowWalker.parentNode() === shadow, shadowWalker.parentNode(),
        attrWalker.nextNode(), attrWalker.parentNode()];
    })).toEqual([true, null, true, null, true, null, null, null]);
  });
});

describe('TreeWalker filters and mutation', () => {
  it.each([0, 4])('preserves each traversal algorithm\'s treatment of filter result %s', async (result) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((result) => {
      const root = document.createElement('root');
      const before = root.appendChild(document.createElement('before'));
      const branch = root.appendChild(document.createElement('branch'));
      const child = branch.appendChild(document.createElement('child'));
      const after = root.appendChild(document.createElement('after'));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) =>
        node === branch ? result : node === before || node === after ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT);
      const next = walker.nextNode() === child;
      walker.currentNode = after;
      const previous = walker.previousNode() === child;
      walker.currentNode = before;
      const sibling = walker.nextSibling() === child;
      walker.currentNode = root;
      return [next, previous, sibling, walker.firstChild(), walker.lastChild(), walker.currentNode === root];
    }, result)).toEqual([true, true, true, null, null, true]);
  });

  it('masks node kinds before filtering and treats masked parents as skipped', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      root.appendChild(document.createComment('hidden'));
      const text = root.appendChild(document.createElement('a')).appendChild(document.createTextNode('shown'));
      const calls: number[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, (node) => {
        calls.push(node.nodeType);
        return NodeFilter.FILTER_ACCEPT;
      });
      return [walker.firstChild() === text, walker.parentNode(), walker.currentNode === text,
        walker.nextNode(), calls];
    })).toEqual([true, null, true, null, [3]]);
  });

  it('retains object-filter identity and looks up acceptNode on each invocation', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      let receiver = false;
      const filter = { acceptNode(): number { receiver = this === filter; return NodeFilter.FILTER_ACCEPT; } };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, filter);
      const moved = walker.nextNode() === child;
      filter.acceptNode = () => NodeFilter.FILTER_REJECT;
      return [walker.filter === filter, receiver, moved, walker.parentNode(), walker.currentNode === child];
    })).toEqual([true, true, true, null, true]);
  });

  it('clears the active flag after a callback throws and keeps the current node', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      const failure = new Error('filter failure');
      let fail = true;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, () => {
        if (fail) throw failure;
        return NodeFilter.FILTER_ACCEPT;
      });
      let error: unknown;
      try { walker.nextNode(); } catch (caught) { error = caught; }
      const unchanged = walker.currentNode === root;
      fail = false;
      return [error === failure, unchanged, walker.nextNode() === child];
    })).toEqual([true, true, true]);
  });

  it.each([true, false])('rejects recursive filtering with a caught exception: %s', async (catchInside) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((catchInside) => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      let recurse = true;
      let error: unknown;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, () => {
        if (recurse) {
          if (!catchInside) walker.nextNode();
          else try { walker.nextNode(); } catch (caught) { error = caught; }
        }
        return NodeFilter.FILTER_ACCEPT;
      });
      let returned: Node | null = null;
      try { returned = walker.nextNode(); } catch (caught) { error = caught; }
      const position = walker.currentNode === (catchInside ? child : root);
      recurse = false;
      walker.currentNode = root;
      return [error instanceof DOMException && error.name, returned === (catchInside ? child : null),
        position, walker.nextNode() === child];
    }, catchInside)).toEqual(['InvalidStateError', true, true, true]);
  });

  it('permits recursive calls which do not reach filtering and independent traversers', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      const other = document.createTreeWalker(root);
      const results: boolean[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, () => {
        results.push(walker.parentNode() === null, walker.previousNode() === null, other.nextNode() === child);
        return NodeFilter.FILTER_ACCEPT;
      });
      return [walker.nextNode() === child, results];
    })).toEqual([true, [true, true, true]]);
  });

  it('retains a removed current node and follows its new tree after adoption', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const current = root.appendChild(document.createElement('current'));
      const child = current.appendChild(document.createElement('child'));
      const walker = document.createTreeWalker(root);
      walker.currentNode = current;
      current.remove();
      const retained = walker.currentNode === current;
      const noParent = walker.parentNode() === null;
      const other = new Document();
      other.appendChild(current);
      return [retained, noParent, walker.nextNode() === child, walker.parentNode() === current,
        walker.parentNode() === other, walker.root === root];
    })).toEqual(Array(6).fill(true));
  });

  it.each([1, 3])('uses live links after a filter removes a candidate and returns %s', async (result) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((result) => {
      const root = document.createElement('root');
      const removed = root.appendChild(document.createElement('removed'));
      root.appendChild(document.createElement('next'));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, (node) => {
        if (node === removed) { removed.remove(); return result; }
        return NodeFilter.FILTER_ACCEPT;
      });
      return [walker.nextNode() === (result === 1 ? removed : null),
        walker.currentNode === (result === 1 ? removed : root), removed.parentNode];
    }, result)).toEqual([true, true, null]);
  });

  it('sees children inserted while filtering a skipped node', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const skipped = root.appendChild(document.createElement('skipped'));
      const inserted = document.createElement('inserted');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, (node) => {
        if (node === skipped) { skipped.appendChild(inserted); return NodeFilter.FILTER_SKIP; }
        return NodeFilter.FILTER_ACCEPT;
      });
      return [walker.nextNode() === inserted, walker.currentNode === inserted];
    })).toEqual([true, true]);
  });

  it('preserves an author change to currentNode when filtering finds no accepted node', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      root.appendChild(document.createElement('rejected'));
      const outside = document.createElement('outside');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, () => {
        walker.currentNode = outside;
        return NodeFilter.FILTER_REJECT;
      });
      return [walker.nextNode(), walker.currentNode === outside];
    })).toEqual([null, true]);
  });
});
