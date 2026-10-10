import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createTestDocument } from '../../../support/dom';

describe('DOM structural mutation', () => {
  it('replaces a document element without rejecting the outgoing element', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const target = new Document();
      const oldRoot = target.createElement('old');
      const newRoot = document.createElement('new');
      target.appendChild(oldRoot);
      return [
        target.replaceChild(newRoot, oldRoot) === oldRoot,
        oldRoot.parentNode === null,
        target.documentElement === newRoot,
        newRoot.ownerDocument === target,
      ];
    })).toEqual([true, true, true, true]);
  });

  it('updates live range boundaries while removing their subtree', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const child = parent.appendChild(document.createElement('child'));
      const text = child.appendChild(document.createTextNode('text'));
      const range = document.createRange();
      range.setStart(text, 1);
      range.setEnd(text, 3);
      parent.removeChild(child);
      return [range.startContainer === parent, range.startOffset, range.endContainer === parent, range.endOffset];
    })).toEqual([true, 0, true, 0]);
  });

  it('updates the iterator reference before removing its current node', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const first = parent.appendChild(document.createElement('first'));
      const second = parent.appendChild(document.createElement('second'));
      const iterator = document.createNodeIterator(parent);
      iterator.nextNode();
      iterator.nextNode();
      parent.removeChild(first);
      return [iterator.referenceNode === parent, iterator.pointerBeforeReferenceNode, iterator.nextNode() === second];
    })).toEqual([true, false, true]);
  });

  it('moves a node between parents in the same tree', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const source = root.appendChild(document.createElement('source'));
      const target = root.appendChild(document.createElement('target'));
      const child = source.appendChild(document.createElement('child'));
      target.moveBefore(child, null);
      return [source.firstChild === null, target.firstChild === child, child.parentNode === target];
    })).toEqual([true, true, true]);
  });

  it.each(['self', 'previous', 'next', 'descendant', 'fragment', 'empty fragment'] as const)(
    'replaces a child with its %s candidate', async (kind) => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate((kind) => {
        const parent = document.createElement('parent');
        const a = parent.appendChild(document.createElement('a'));
        const b = parent.appendChild(document.createElement('b'));
        const c = parent.appendChild(document.createElement('c'));
        let replacement: Node;
        if (kind === 'self') { replacement = b; }
        else if (kind === 'previous') { replacement = a; }
        else if (kind === 'next') { replacement = c; }
        else if (kind === 'descendant') { replacement = b.appendChild(document.createElement('inside')); }
        else {
          replacement = new DocumentFragment();
          if (kind === 'fragment') {
            replacement.appendChild(document.createElement('x'));
            replacement.appendChild(document.createElement('y'));
          }
        }
        const returned = parent.replaceChild(replacement, b);
        const names: string[] = [];
        for (let node = parent.firstChild; node; node = node.nextSibling) names.push((node as Element).localName);
        return [returned === b, b.parentNode === (kind === 'self' ? parent : null), names];
      }, kind)).toEqual([true, true, {
        self: ['a', 'b', 'c'], previous: ['a', 'c'], next: ['a', 'c'],
        descendant: ['a', 'inside', 'c'], fragment: ['a', 'x', 'y', 'c'], 'empty fragment': ['a', 'c'],
      }[kind]]);
    },
  );

  it('rejects an invalid document replacement before removing or adopting fragment children', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const target = new Document();
      const existing = target.appendChild(target.createElement('existing'));
      const fragment = new DocumentFragment();
      const a = fragment.appendChild(document.createElement('a'));
      const b = fragment.appendChild(document.createElement('b'));
      let error: unknown;
      try { target.replaceChild(fragment, existing); } catch (caught) { error = caught; }
      return [error instanceof DOMException && error.name, target.documentElement === existing,
        fragment.firstChild === a, fragment.lastChild === b, a.ownerDocument === document];
    })).toEqual(['HierarchyRequestError', true, true, true, true]);
  });

  it('rejects a foreign replacement child before detaching the replacement', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const source = document.createElement('source');
      const candidate = source.appendChild(document.createElement('candidate'));
      let error: unknown;
      try { parent.replaceChild(candidate, document.createElement('foreign')); } catch (caught) { error = caught; }
      return [error instanceof DOMException && error.name, candidate.parentNode === source, parent.firstChild === null];
    })).toEqual(['NotFoundError', true, true]);
  });

  it.each(['self', 'next', 'end'] as const)('moves an existing child before %s', async (position) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((position) => {
      const root = document.createElement('root');
      const a = root.appendChild(document.createElement('a'));
      const b = root.appendChild(document.createElement('b'));
      root.moveBefore(a, position === 'self' ? a : position === 'next' ? b : null);
      return [root.firstChild === (position === 'end' ? b : a), root.lastChild === (position === 'end' ? a : b)];
    }, position)).toEqual([true, true]);
  });

  it.each(['different tree', 'foreign child', 'ancestor', 'fragment', 'document text'] as const)(
    'rejects a move involving %s before changing either tree', async (kind) => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate((kind) => {
        const root = new DocumentFragment();
        const parent = root.appendChild(document.createElement('parent'));
        const child = parent.appendChild(document.createElement('child'));
        const target = root.appendChild(document.createElement('target'));
        let error: unknown;
        try {
          if (kind === 'different tree') { document.createElement('detached').moveBefore(child, null); }
          else if (kind === 'foreign child') { target.moveBefore(child, document.createElement('foreign')); }
          else if (kind === 'ancestor') { child.moveBefore(parent, null); }
          else if (kind === 'fragment') { target.moveBefore(root, null); }
          else {
            const other = new Document();
            const element = other.appendChild(other.createElement('root'));
            const text = element.appendChild(other.createTextNode('text'));
            try { other.moveBefore(text, null); }
            catch (caught) {
              if (text.parentNode !== element) throw new Error('text was detached');
              throw caught;
            }
          }
        } catch (caught) { error = caught; }
        return [error instanceof DOMException && error.name, parent.parentNode === root, child.parentNode === parent];
      }, kind)).toEqual([kind === 'foreign child' ? 'NotFoundError' : 'HierarchyRequestError', true, true]);
    },
  );

  it('updates the first base element when moving it ahead of another base', async () => {
    const browlet = new Browlet({ route: () => '<!doctype html><base href="/a/"><base href="/b/">' });
    await browlet.navigate('https://example.test/');
    expect(await browlet.evaluate(() => {
      const head = document.head;
      const first = head.firstChild!;
      const second = first.nextSibling!;
      head.moveBefore(second, first);
      return document.baseURI;
    })).toBe('https://example.test/b/');
  });
});

describe('DOM replace-all primitive', () => {
  // Convenience author APIs which use replace-all follow in 4E and 4F.
  it.each(['node', 'fragment', 'null'] as const)('replaces all with %s and adjusts live consumers', (kind) => {
    const document = createTestDocument();
    const parent = document.createElement('parent');
    const first = parent.appendChild(document.createElement('first'));
    const last = parent.appendChild(document.createElement('last'));
    const range = document.createRange();
    range.selectNodeContents(parent);
    const iterator = document.createNodeIterator(parent, 0xffffffff, null);
    iterator.nextNode();
    iterator.nextNode();
    const replacement = kind === 'null' ? null : kind === 'node'
      ? document.createElement('new') : document.createDocumentFragment();
    if (replacement?.isDocumentFragment()) replacement.appendChild(document.createElement('new'));
    parent.replaceAll(replacement);
    expect(first.parentNode).toBeNull();
    expect(last.parentNode).toBeNull();
    expect(parent.firstChild?.isElement() ? parent.firstChild.localName : null).toBe(kind === 'null' ? null : 'new');
    expect([range.startOffset, range.endOffset]).toEqual([0, 0]);
    expect(iterator.referenceNode).toBe(parent);
    expect(iterator.nextNode()).toBe(parent.firstChild);
  });

  it('can retain one of the old children as the replacement', () => {
    const document = createTestDocument();
    const parent = document.createElement('parent');
    parent.appendChild(document.createElement('first'));
    const retained = parent.appendChild(document.createElement('retained'));
    parent.replaceAll(retained);
    expect(parent.firstChild).toBe(retained);
    expect(parent.lastChild).toBe(retained);
    expect(retained.parentNode).toBe(parent);
  });
});
