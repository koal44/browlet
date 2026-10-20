import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createTestDocument } from '../../../support/dom';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';

describe('Text', () => {
  it('reads wholeText across adjacent text, stopping at comments and elements', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      parent.appendChild(new Text('a'));
      const middle = parent.appendChild(new Text(''));
      const last = parent.appendChild(new Text('b'));
      parent.appendChild(new Comment('separator'));
      const other = parent.appendChild(new Text('c'));
      parent.appendChild(document.createElement('child')).appendChild(new Text('nested'));
      return [middle.wholeText, last.wholeText, other.wholeText, new Text('alone').wholeText];
    })).toEqual(['ab', 'ab', 'c', 'alone']);
  });

  it('splits attached text and moves live boundaries before truncating the original', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const text = parent.appendChild(new Text('abcdef'));
      const after = parent.appendChild(new Comment('after'));
      const span = new Range();
      span.setStart(text, 1);
      span.setEnd(text, 5);
      const seam = new Range();
      seam.setStart(text, 2);
      seam.collapse(true);
      const siblings = new Range();
      siblings.setStart(parent, 1);
      siblings.setEnd(parent, 2);
      const next = text.splitText(2);
      return [
        text.data, next.data, text.nextSibling === next, next.nextSibling === after,
        next.ownerDocument === document, next instanceof Text, text.wholeText,
        span.startContainer === text, span.startOffset, span.endContainer === next, span.endOffset,
        seam.startContainer === text, seam.startOffset, siblings.startOffset, siblings.endOffset,
      ];
    })).toEqual(['ab', 'cdef', true, true, true, true, 'abcdef', true, 1, true, 3, true, 2, 2, 3]);
  });

  it.each([0, 2, 4])('splits detached text at %i while keeping its ranges on the original', async (offset) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((offset) => {
      const text = new Text('abcd');
      const range = new Range();
      range.selectNodeContents(text);
      const next = text.splitText(offset);
      return [text.data, next.data, next.parentNode, next.ownerDocument === document,
        range.startContainer === text, range.endContainer === text, range.startOffset, range.endOffset];
    }, offset)).toEqual(['abcd'.slice(0, offset), 'abcd'.slice(offset), null, true, true, true, 0, offset]);
  });

  it('can split a surrogate pair and rejects an out-of-bounds split before inserting anything', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const text = parent.appendChild(new Text('\u{1f600}'));
      let errorName = '';
      try { text.splitText(3); } catch (error) { errorName = (error as DOMException).name; }
      const unchanged = text.data === '\u{1f600}' && text.nextSibling === null;
      const next = text.splitText(1);
      return [errorName, unchanged, text.data, next.data];
    })).toEqual(['IndexSizeError', true, '\ud83d', '\ude00']);
  });

  it('allocates split text through the adopted document even when the method is borrowed', () => {
    const source = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const text = source.document.createTextNode('abcd');
    target.document.adoptNode(text);
    const next = source.window.Text.prototype.splitText.call(text, 2);
    expect(next.ownerDocument).toBe(target.document);
    expect(next).toBeInstanceOf(target.window.Text);
    expect(text).toBeInstanceOf(source.window.Text);
    expect(next.data).toBe('cd');
  });
});

describe('Node.normalize', () => {
  it('merges text runs and moves text and parent boundaries before removing the old nodes', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const first = parent.appendChild(new Text('ab'));
      parent.appendChild(new Text(''));
      const middle = parent.appendChild(new Text('cd'));
      const last = parent.appendChild(new Text('e'));
      const separator = parent.appendChild(new Comment('separator'));
      const points: [Node, number][] = [[parent, 1], [parent, 2], [parent, 3], [parent, 4], [middle, 1], [last, 1]];
      const ranges = points.map(([node, offset]) => {
        const range = new Range();
        range.setStart(node, offset);
        range.collapse(true);
        return range;
      });
      const snapshot = new StaticRange({ startContainer: middle, startOffset: 0, endContainer: middle, endOffset: 2 });
      const iterator = document.createNodeIterator(parent);
      while (iterator.nextNode() !== middle) { /* Select the node which normalization will remove. */ }
      parent.normalize();
      return [
        first.data, first.nextSibling === separator, parent.lastChild === separator,
        middle.parentNode, last.parentNode, snapshot.startContainer === middle, snapshot.endOffset,
        ranges.map((range) => [range.startContainer === first ? 'text' : 'parent', range.startOffset,
          range.endContainer === range.startContainer, range.endOffset]),
        iterator.referenceNode === first, iterator.nextNode() === separator,
      ];
    })).toEqual(['abcde', true, true, null, null, true, 2, [
      ['text', 2, true, 2], ['text', 2, true, 2], ['text', 4, true, 4],
      ['parent', 1, true, 1], ['text', 3, true, 3], ['text', 5, true, 5],
    ], true, true]);
  });

  it('removes empty descendants, reaches nested runs, and does not normalize the receiver or its siblings', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const fragment = new DocumentFragment();
      const empty = fragment.appendChild(new Text(''));
      const child = fragment.appendChild(document.createElement('child'));
      child.appendChild(new Text(''));
      const first = child.appendChild(new Text('a'));
      const second = child.appendChild(new Text('b'));
      child.appendChild(new Text(''));
      first.normalize();
      empty.normalize();
      const before = [first.data, first.nextSibling === second, empty.parentNode === fragment];
      fragment.normalize();
      return [before, fragment.firstChild === child, child.firstChild === first,
        child.lastChild === first, first.data, empty.parentNode, second.parentNode];
    })).toEqual([['a', true, true], true, true, true, 'ab', null, null]);
  });

  it('does not cross a shadow boundary and can normalize the shadow root itself', () => {
    const document = createTestDocument();
    const host = document.createElement('host');
    const shadow = new ShadowRootImpl(host, 'open');
    host.shadowRoot = shadow;
    const light = host.appendChild(document.createTextNode('a'));
    host.appendChild(document.createTextNode('b'));
    const dark = shadow.appendChild(document.createTextNode('c'));
    shadow.appendChild(document.createTextNode('d'));
    host.normalize();
    expect(light.data).toBe('ab');
    expect(dark.data).toBe('c');
    expect(dark.nextSibling).not.toBeNull();
    shadow.normalize();
    expect(dark.data).toBe('cd');
    expect(dark.nextSibling).toBeNull();
  });
});
