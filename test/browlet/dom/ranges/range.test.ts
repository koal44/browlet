import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';
import { createTestDocument } from '../../../support/dom';

describe('Range selection', () => {
  it('uses the constructor realm document and the factory receiver document', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const other = new Document();
      const range = new Range();
      const created = other.createRange();
      return [
        range instanceof AbstractRange, range.startContainer === document,
        range.endContainer === document, range.startOffset, range.endOffset, range.collapsed,
        created.startContainer === other, created.endContainer === other,
      ];
    })).toEqual([true, true, true, 0, 0, true, true, true]);
  });

  it('keeps factory results with the receiver document when borrowing another realm method', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const range = second.window.Document.prototype.createRange.call(first.document);
    expect(range).toBeInstanceOf(first.window.Range);
    expect(range).not.toBeInstanceOf(second.window.Range);
    expect(range.startContainer).toBe(first.document);
    expect(() => second.window.Range.prototype.setStart.call(range, first.document, 100))
      .toThrow(second.window.DOMException);
    expect(range.startOffset).toBe(0);
  });

  it('orders ancestor offsets and descendant points, collapsing only across the opposite boundary', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      parent.appendChild(document.createComment('before'));
      const child = parent.appendChild(document.createTextNode('text'));
      const range = new Range();
      range.selectNodeContents(parent);
      range.setStart(child, 1);
      const selected = [range.endContainer === parent, range.endOffset, range.commonAncestorContainer === parent];
      range.setEnd(parent, 1);
      const collapsedBefore = [range.collapsed, range.startContainer === parent, range.startOffset];
      range.setEnd(child, 2);
      const selectedAgain = [range.startContainer === parent, range.startOffset, range.endContainer === child];
      range.setStart(parent, 2);
      return [selected, collapsedBefore, selectedAgain, range.collapsed, range.endContainer === parent, range.endOffset];
    })).toEqual([[true, 2, true], [true, true, 1], [true, 1, true], true, true, 2]);
  });

  it('supports relative boundary setters and collapse without changing the tree', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const first = parent.appendChild(document.createTextNode('first'));
      const second = parent.appendChild(document.createTextNode('second'));
      const range = new Range();
      range.setStartBefore(first);
      range.setEndAfter(second);
      const offsets = [range.startOffset, range.endOffset];
      range.collapse();
      offsets.push(range.startOffset, range.endOffset);
      range.setStartAfter(first);
      range.setEndBefore(second);
      offsets.push(range.startOffset, range.endOffset);
      range.selectNode(second);
      range.collapse(true);
      offsets.push(range.startOffset, range.endOffset);
      return [offsets, range.startContainer === parent, parent.firstChild === first, parent.lastChild === second];
    })).toEqual([[0, 2, 2, 2, 1, 1, 1, 1], true, true, true]);
  });

  it('validates offsets before changing either endpoint', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const range = new Range();
      const text = document.createTextNode('\u{1f600}x');
      range.selectNodeContents(text);
      const errors: string[] = [];
      for (const offset of [4, -1]) {
        try { range.setStart(text, offset); }
        catch (error) { errors.push((error as DOMException).name); }
      }
      return [errors, range.startOffset, range.endOffset, range.startContainer === text];
    })).toEqual([['IndexSizeError', 'IndexSizeError'], 0, 3, true]);
  });

  it('moves registration when selection switches to another root or document', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const first = document.createElement('first');
      first.appendChild(document.createElement('unused'));
      const other = new Document();
      const second = other.createElement('second');
      const selected = second.appendChild(other.createElement('selected'));
      const range = new Range();
      range.selectNodeContents(first);
      range.selectNode(selected);
      first.removeChild(first.firstChild!);
      const unchanged = range.startContainer === second && range.endOffset === 1;
      second.removeChild(selected);
      return [unchanged, range.startContainer === second, range.startOffset, range.endOffset];
    })).toEqual([true, true, 0, 0]);
  });
});

describe('Live range structural updates', () => {
  it('keeps a boundary at the insertion point and advances boundaries strictly after it', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      parent.appendChild(document.createElement('a'));
      const b = parent.appendChild(document.createElement('b'));
      const range = new Range();
      range.setStart(parent, 1);
      range.setEnd(parent, 2);
      const fragment = new DocumentFragment();
      fragment.appendChild(document.createElement('x'));
      fragment.appendChild(document.createElement('y'));
      parent.insertBefore(fragment, b);
      const afterInsert = [range.startOffset, range.endOffset];
      parent.appendChild(document.createElement('tail'));
      return [afterInsert, range.startOffset, range.endOffset];
    })).toEqual([[1, 4], 1, 4]);
  });

  it('retains detached-tree selection across insertion and adoption, then adjusts later removal', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createTextNode('text'));
      const range = new Range();
      range.setStart(child, 1);
      range.setEnd(child, 3);
      const other = new Document();
      other.appendChild(root);
      const retained = range.startContainer === child && range.startOffset === 1 && range.endOffset === 3;
      range.detach();
      root.removeChild(child);
      return [retained, range.startContainer === root, range.endContainer === root, range.startOffset, range.endOffset];
    })).toEqual([true, true, true, 0, 0]);
  });

  it('moves fragment child boundaries back to the fragment before insertion', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const fragment = new DocumentFragment();
      const text = fragment.appendChild(document.createTextNode('text'));
      const range = new Range();
      range.selectNodeContents(text);
      document.createElement('parent').appendChild(fragment);
      return [range.startContainer === fragment, range.endContainer === fragment, range.startOffset, range.endOffset];
    })).toEqual([true, true, 0, 0]);
  });

  it('keeps shadow-tree ranges registered while the host is removed and adopted', () => {
    const document = createTestDocument();
    const host = document.appendChild(document.createElement('host'));
    // attachShadow is a later slice; establish its implementation association directly.
    const shadow = new ShadowRootImpl(host, 'closed', document.env);
    host.shadowRoot = shadow;
    const text = shadow.appendChild(document.createTextNode('text'));
    const range = document.createRange();
    range.selectNodeContents(text);
    const other = createTestDocument();
    other.adoptNode(host);
    expect(text.nodeDocument).toBe(other);
    expect(range.startContainer).toBe(text);
    expect(range.endOffset).toBe(4);
    shadow.removeChild(text);
    expect(range.startContainer).toBe(shadow);
    expect(range.endContainer).toBe(shadow);
    expect([range.startOffset, range.endOffset]).toEqual([0, 0]);
  });

  it('adjusts both removal and insertion boundaries for a state-preserving move', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const root = document.createElement('root');
      const source = root.appendChild(document.createElement('source'));
      const target = root.appendChild(document.createElement('target'));
      const moved = source.appendChild(document.createTextNode('text'));
      const before = target.appendChild(document.createElement('before'));
      const inside = new Range();
      inside.selectNodeContents(moved);
      const atTarget = new Range();
      atTarget.selectNodeContents(target);
      target.moveBefore(moved, before);
      return [inside.startContainer === source, inside.startOffset, inside.endOffset, atTarget.startOffset, atTarget.endOffset];
    })).toEqual([true, 0, 0, 0, 2]);
  });

  // DOM 4E owns replace-data and its range participant; structural mutations are 4C.
  it.fails('adjusts boundaries when existing CharacterData.data replaces the selected text (4E)', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const text = document.createTextNode('text');
      const range = new Range();
      range.setStart(text, 1);
      range.setEnd(text, 3);
      text.data = 'x';
      return [range.startOffset, range.endOffset];
    })).toEqual([0, 0]);
  });
});

describe('StaticRange', () => {
  it('keeps its snapshot when the selected subtree is removed', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const text = parent.appendChild(document.createTextNode('text'));
      const range = new StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 3 });
      parent.removeChild(text);
      return [range instanceof AbstractRange, range.startContainer === text, range.startOffset, range.endOffset];
    })).toEqual([true, true, 1, 3]);
  });

  it('accepts disconnected and out-of-bounds endpoints but rejects attributes', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const start = document.createTextNode('start');
      const end = document.createTextNode('end');
      const range = new StaticRange({ startContainer: start, startOffset: 100, endContainer: end, endOffset: 50 });
      let error: unknown;
      try { new StaticRange({ startContainer: document.createAttribute('x'), startOffset: 0, endContainer: end, endOffset: 0 }); }
      catch (caught) { error = caught; }
      return [range.startOffset, range.endOffset, error instanceof DOMException && error.name];
    })).toEqual([100, 50, 'InvalidNodeTypeError']);
  });
});
