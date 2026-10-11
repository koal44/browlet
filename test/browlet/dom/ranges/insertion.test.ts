import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('Range insertion', () => {
  it('splits Text and includes an inserted fragment in a previously collapsed range', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const text = parent.appendChild(document.createTextNode('abcd'));
      const range = new Range();
      range.setStart(text, 2);
      const other = new Range();
      other.setStart(text, 3);
      other.setEnd(text, 4);
      const fragment = document.createDocumentFragment();
      fragment.append('X', 'Y');
      range.insertNode(fragment);
      return [Array.from(parent.childNodes, (node) => node.nodeValue), fragment.childNodes.length,
        range.startContainer === text, range.startOffset, range.endContainer === parent, range.endOffset,
        String(range), other.startContainer === parent.lastChild, other.startOffset, other.endOffset];
    })).toEqual([['ab', 'X', 'Y', 'cd'], 0, true, 2, true, 3, 'XY', true, 1, 2]);
  });

  it('splits Text even for an empty fragment and moves the end to the parent position', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const text = parent.appendChild(document.createTextNode('abcd'));
      const range = new Range();
      range.setStart(text, 2);
      range.insertNode(document.createDocumentFragment());
      return [parent.childNodes.length, range.startContainer === text, range.startOffset,
        range.endContainer === parent, range.endOffset, range.collapsed, String(range)];
    })).toEqual([2, true, 2, true, 1, false, '']);
  });

  it('does not reset a noncollapsed end after text splitting and insertion', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const text = parent.appendChild(document.createTextNode('abcd'));
      const range = new Range();
      range.setStart(text, 1);
      range.setEnd(text, 3);
      range.insertNode(document.createTextNode('X'));
      return [parent.textContent, range.startContainer === text, range.startOffset,
        range.endContainer === parent.lastChild, range.endOffset, String(range)];
    })).toEqual(['aXbcd', true, 1, true, 2, 'Xbc']);
  });

  it('computes the new end after removing a node that is already a child', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const a = root.appendChild(document.createElement('a'));
      const b = root.appendChild(document.createElement('b'));
      const c = root.appendChild(document.createElement('c'));
      const range = new Range();
      range.setStart(root, 0);
      range.insertNode(a);
      const sameReference = [range.startOffset, range.endOffset];
      range.setStart(root, 2);
      range.collapse(true);
      range.insertNode(a);
      const moveFromBefore = [range.startOffset, range.endOffset, root.firstChild === b,
        root.childNodes[1] === a, root.lastChild === c];
      range.setStart(root, 0);
      range.collapse(true);
      range.insertNode(c);
      return [sameReference, moveFromBefore, range.startOffset, range.endOffset, root.firstChild === c];
    })).toEqual([[0, 1], [1, 2, true, true, true], 0, 1, true]);
  });

  it('validates a failed insertion before splitting Text or queuing mutation records', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const text = parent.appendChild(document.createTextNode('abcd'));
      const range = new Range();
      range.setStart(text, 2);
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { subtree: true, characterData: true, childList: true });
      let errorName = '';
      try { range.insertNode(parent); } catch (error) { errorName = (error as DOMException).name; }
      return [errorName, parent.childNodes.length, text.data, range.startOffset, range.endOffset,
        range.collapsed, observer.takeRecords().length];
    })).toEqual(['HierarchyRequestError', 1, 'abcd', 2, 2, true, 0]);
  });

  it('rejects comments, instructions, detached Text, attributes, and insertion of the start container itself', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const starts = [document.createComment('comment'), document.createProcessingInstruction('test', 'instruction'),
        document.createTextNode('detached'), document.createAttribute('x'), document.createElement('div')];
      return starts.map((start, index) => {
        const range = new Range();
        range.setStart(start, 0);
        try { range.insertNode(index === 4 ? start : document.createElement('new')); }
        catch (error) { return (error as DOMException).name; }
        return 'no error';
      });
    })).toEqual(Array(5).fill('HierarchyRequestError'));
  });

  it('splits CDATA using the Text split algorithm and adopts inserted nodes into the destination document', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = document.implementation.createDocument(null, 'root');
      const text = xml.documentElement.appendChild(xml.createCDATASection('abcd'));
      const foreign = document.createElement('foreign');
      const range = xml.createRange();
      range.setStart(text, 1);
      range.insertNode(foreign);
      return [text.data, xml.documentElement.lastChild!.nodeType,
        xml.documentElement.lastChild!.nodeValue, foreign.ownerDocument === xml,
        range.startContainer === text, range.endContainer === xml.documentElement, range.endOffset];
    })).toEqual(['a', 3, 'bcd', true, true, true, 2]);
  });
});

describe('Range surrounding', () => {
  it('clears the new parent, fills it with the selection, and selects it', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const text = root.appendChild(document.createTextNode('abcd'));
      const wrapper = document.createElement('strong');
      wrapper.append('old');
      const observer = new MutationObserver(() => {});
      observer.observe(wrapper, { childList: true });
      const range = new Range();
      range.setStart(text, 1);
      range.setEnd(text, 3);
      range.surroundContents(wrapper);
      return [Array.from(root.childNodes, (node) => [node.nodeName, node.textContent]),
        range.startContainer === root, range.endContainer === root, range.startOffset, range.endOffset,
        observer.takeRecords().map((record) => [record.removedNodes.length, record.addedNodes.length]), String(range)];
    })).toEqual([[['#text', 'a'], ['STRONG', 'bc'], ['#text', 'd']], true, true, 1, 2, [[1, 0], [0, 1]], 'bc']);
  });

  it('rejects partially selected non-Text ancestors before checking the new parent kind', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const branch = root.appendChild(document.createElement('em'));
      const start = branch.appendChild(document.createTextNode('abc'));
      const end = root.appendChild(document.createTextNode('def'));
      const range = new Range();
      range.setStart(start, 1);
      range.setEnd(end, 1);
      const errors: string[] = [];
      for (const parent of [document.createElement('strong'), document.createDocumentFragment()]) {
        try { range.surroundContents(parent); } catch (error) { errors.push((error as DOMException).name); }
      }
      return [errors, root.textContent, branch.parentNode === root, range.startContainer === start, range.startOffset];
    })).toEqual([['InvalidStateError', 'InvalidStateError'], 'abcdef', true, true, 1]);
  });

  it('rejects partially selected comments but permits fully selected comments', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const comment = root.appendChild(document.createComment('abc'));
      const range = new Range();
      range.setStart(comment, 1);
      range.setEnd(root, 1);
      let errorName = '';
      try { range.surroundContents(document.createElement('em')); }
      catch (error) { errorName = (error as DOMException).name; }
      range.selectNode(comment);
      const wrapper = document.createElement('strong');
      range.surroundContents(wrapper);
      return [errorName, wrapper.firstChild === comment, range.startOffset, range.endOffset];
    })).toEqual(['InvalidStateError', true, 0, 1]);
  });

  it('rejects Document, DocumentType, and DocumentFragment parents before extraction', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const text = root.appendChild(document.createTextNode('abc'));
      const range = new Range();
      range.selectNode(text);
      const parents = [new Document(), document.implementation.createDocumentType('html', '', ''),
        document.createDocumentFragment()];
      const errors = parents.map((parent) => {
        try { range.surroundContents(parent); } catch (error) { return (error as DOMException).name; }
        return 'no error';
      });
      return [errors, text.parentNode === root, range.startOffset, range.endOffset];
    })).toEqual([Array(3).fill('InvalidNodeTypeError'), true, 0, 1]);
  });

  it('preserves the specified partial mutations when a CharacterData parent fails later', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const text = root.appendChild(document.createTextNode('abcd'));
      const parent = document.createComment('wrapper');
      const range = new Range();
      range.setStart(text, 1);
      range.setEnd(text, 3);
      let errorName = '';
      try { range.surroundContents(parent); } catch (error) { errorName = (error as DOMException).name; }
      return [errorName, Array.from(root.childNodes, (node) => [node.nodeType, node.nodeValue]),
        parent.parentNode === root, range.startContainer === text, range.startOffset,
        range.endContainer === root, range.endOffset];
    })).toEqual(['HierarchyRequestError', [[3, 'a'], [8, 'wrapper'], [3, 'd']], true, true, 1, true, 2]);
  });

  it('inserts an empty parent for a collapsed range', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const range = new Range();
      range.selectNodeContents(root);
      const parent = document.createElement('em');
      range.surroundContents(parent);
      return [root.firstChild === parent, parent.childNodes.length, range.startContainer === root,
        range.endContainer === root, range.startOffset, range.endOffset];
    })).toEqual([true, 0, true, true, 0, 1]);
  });
});
