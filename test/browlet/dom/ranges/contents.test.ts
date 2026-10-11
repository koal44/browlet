import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

const operations = ['cloneContents', 'extractContents', 'deleteContents'] as const;

describe('Range content operations', () => {
  for (const operation of operations) {
    it.each(['text', 'cdata', 'comment', 'instruction'] as const)(`${operation} selects part of one %s node`, async (kind) => {
      const browser = new Browlet({ route: () => '' });
      expect(await browser.evaluate(({ operation, kind }) => {
        const xml = document.implementation.createDocument(null, 'root');
        const node = kind === 'text' ? xml.createTextNode('abcdef')
          : kind === 'cdata' ? xml.createCDATASection('abcdef')
          : kind === 'comment' ? xml.createComment('abcdef') : xml.createProcessingInstruction('test', 'abcdef');
        xml.documentElement.appendChild(node);
        const range = xml.createRange();
        range.setStart(node, 1);
        range.setEnd(node, 4);
        const fragment = range[operation]();
        return [fragment ? [fragment.childNodes.length, fragment.firstChild!.nodeType === node.nodeType,
          fragment.firstChild!.nodeValue, fragment.firstChild!.nodeName === node.nodeName,
          fragment.firstChild!.ownerDocument === xml] : null,
        node.data, range.startContainer === node, range.endContainer === node, range.startOffset, range.endOffset];
      }, { operation, kind })).toEqual([operation === 'deleteContents' ? null : [1, true, 'bcd', true, true],
        operation === 'cloneContents' ? 'abcdef' : 'aef', true, true, 1, operation === 'cloneContents' ? 4 : 1]);
    });

    it(`${operation} handles collapsed ranges without changing data or queuing records`, async () => {
      const browser = new Browlet({ route: () => '' });
      expect(await browser.evaluate((operation) => {
        const text = document.createTextNode('abc');
        const range = new Range();
        range.setStart(text, 1);
        const observer = new MutationObserver(() => {});
        observer.observe(text, { characterData: true });
        const fragment = range[operation]();
        const attribute = document.createAttribute('x');
        range.selectNodeContents(attribute);
        const attributeFragment = range[operation]();
        return [fragment?.childNodes.length ?? null, attributeFragment?.childNodes.length ?? null,
          text.data, observer.takeRecords().length, range.collapsed];
      }, operation)).toEqual([operation === 'deleteContents' ? null : 0, operation === 'deleteContents' ? null : 0,
        'abc', 0, true]);
    });
  }

  it.each(['extractContents', 'deleteContents'] as const)('%s preserves the starting offset when removing a ProcessingInstruction tail', async (operation) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((operation) => {
      const xml = document.implementation.createDocument(null, 'root');
      const instruction = xml.documentElement.appendChild(xml.createProcessingInstruction('test', 'ij'));
      const range = xml.createRange();
      range.setStart(instruction, 1);
      range.setEnd(instruction, 2);
      const fragment = range[operation]();
      return [instruction.data, fragment?.firstChild?.nodeValue ?? null,
        range.startContainer === instruction, range.endContainer === instruction, range.startOffset, range.endOffset];
    }, operation)).toEqual(['i', operation === 'extractContents' ? 'j' : null, true, true, 1, 1]);
  });

  it.each(operations)('%s preserves partial ancestor structure and handles fully selected subtrees', async (operation) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((operation) => {
      const xml = document.implementation.createDocument(null, 'root');
      const root = xml.documentElement;
      const left = root.appendChild(xml.createElement('left'));
      left.setAttribute('id', 'left');
      const start = left.appendChild(xml.createTextNode('ab'));
      left.appendChild(xml.createElement('em')).append('CD');
      left.append('ef');
      const middle = root.appendChild(xml.createElement('middle'));
      middle.append('GH');
      const right = root.appendChild(xml.createElement('right'));
      right.append('ij');
      right.appendChild(xml.createElement('em')).append('KL');
      const end = right.appendChild(xml.createTextNode('mn'));
      const range = xml.createRange();
      range.setStart(start, 1);
      range.setEnd(end, 1);
      const otherRange = xml.createRange();
      otherRange.selectNodeContents(middle.firstChild!);
      const iterator = xml.createNodeIterator(root);
      while (iterator.nextNode() !== middle.firstChild) { /* Position inside the selected subtree. */ }
      const fragment = range[operation]();
      return [fragment ? [fragment.textContent, Array.from(fragment.childNodes, (node) => node.nodeName),
        (fragment.firstChild as Element).getAttribute('id'), fragment.firstChild !== left,
        fragment.childNodes[1] === middle, fragment.firstChild!.childNodes[1]!.nodeName,
        fragment.lastChild!.childNodes[1]!.nodeName] : null,
      root.textContent, Array.from(root.childNodes, (node) => node.nodeName),
      range.startContainer === (operation === 'cloneContents' ? start : root),
      range.endContainer === (operation === 'cloneContents' ? end : root), range.startOffset, range.endOffset,
      operation === 'cloneContents' ? otherRange.startContainer === middle.firstChild
        : otherRange.startContainer === root && otherRange.startOffset === 1 && otherRange.collapsed,
      root.contains(iterator.referenceNode)];
    }, operation)).toEqual([operation === 'deleteContents' ? null : ['bCDefGHijKLm', ['left', 'middle', 'right'],
      'left', true, operation === 'extractContents', 'em', 'em'],
    operation === 'cloneContents' ? 'abCDefGHijKLmn' : 'an',
    operation === 'cloneContents' ? ['left', 'middle', 'right'] : ['left', 'right'], true, true, 1, 1, true, true]);
  });

  it.each(['cloneContents', 'extractContents'] as const)('%s retains empty partial ancestors at text edges', async (operation) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((operation) => {
      const root = document.createElement('root');
      const left = root.appendChild(document.createElement('left'));
      const start = left.appendChild(document.createTextNode('ab'));
      const right = root.appendChild(document.createElement('right'));
      const end = right.appendChild(document.createTextNode('cd'));
      const range = new Range();
      range.setStart(start, 2);
      range.setEnd(end, 0);
      const fragment = range[operation]();
      return [fragment.childNodes.length, fragment.firstChild!.firstChild!.nodeValue,
        fragment.lastChild!.firstChild!.nodeValue, root.textContent, range.collapsed];
    }, operation)).toEqual([2, '', '', 'abcd', operation === 'extractContents']);
  });

  it.each(operations)('%s handles a start container that contains the end', async (operation) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((operation) => {
      const root = document.createElement('root');
      root.append('before');
      const middle = root.appendChild(document.createElement('middle'));
      middle.append('whole');
      const right = root.appendChild(document.createElement('right'));
      const end = right.appendChild(document.createTextNode('after'));
      const range = new Range();
      range.setStart(root, 1);
      range.setEnd(end, 2);
      const fragment = range[operation]();
      return [fragment?.textContent ?? null, root.textContent, range.startContainer === root,
        range.startOffset, range.endContainer === (operation === 'cloneContents' ? end : root), range.endOffset];
    }, operation)).toEqual([operation === 'deleteContents' ? null : 'wholeaf',
      operation === 'cloneContents' ? 'beforewholeafter' : 'beforeter', true, 1, true,
      operation === 'cloneContents' ? 2 : 1]);
  });

  it.each(operations)('%s handles an end container that contains the start', async (operation) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((operation) => {
      const root = document.createElement('root');
      const left = root.appendChild(document.createElement('left'));
      const start = left.appendChild(document.createTextNode('before'));
      root.append('whole', document.createElement('after'));
      const range = new Range();
      range.setStart(start, 2);
      range.setEnd(root, 2);
      const fragment = range[operation]();
      return [fragment?.textContent ?? null, root.textContent,
        range.startContainer === (operation === 'cloneContents' ? start : root), range.endContainer === root,
        range.startOffset, range.endOffset];
    }, operation)).toEqual([operation === 'deleteContents' ? null : 'forewhole',
      operation === 'cloneContents' ? 'beforewhole' : 'be', true, true,
      operation === 'cloneContents' ? 2 : 1, operation === 'cloneContents' ? 2 : 1]);
  });

  it.each(['cloneContents', 'extractContents'] as const)('%s rejects a contained doctype before changing the tree or range', async (operation) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((operation) => {
      const xml = document.implementation.createDocument(null, 'root');
      xml.insertBefore(xml.implementation.createDocumentType('root', '', ''), xml.documentElement);
      const end = xml.documentElement.appendChild(xml.createTextNode('abc'));
      const range = xml.createRange();
      range.setStart(xml, 0);
      range.setEnd(end, 1);
      const observer = new MutationObserver(() => {});
      observer.observe(xml, { subtree: true, childList: true, characterData: true });
      let errorName = '';
      try { range[operation](); } catch (error) { errorName = (error as DOMException).name; }
      return [errorName, xml.doctype !== null, end.data, range.startContainer === xml,
        range.startOffset, range.endContainer === end, range.endOffset, observer.takeRecords().length];
    }, operation)).toEqual(['HierarchyRequestError', true, 'abc', true, 0, true, 1, 0]);
  });

  it('allows deleteContents to remove a doctype and collapse within its document', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = document.implementation.createDocument(null, 'root');
      xml.insertBefore(xml.implementation.createDocumentType('root', '', ''), xml.documentElement);
      const end = xml.documentElement.appendChild(xml.createTextNode('abc'));
      const range = xml.createRange();
      range.setStart(xml, 0);
      range.setEnd(end, 1);
      range.deleteContents();
      return [xml.doctype, end.data, range.startContainer === xml, range.startOffset, range.collapsed];
    })).toEqual([null, 'bc', true, 0, true]);
  });

  it.each(['extractContents', 'deleteContents'] as const)('%s uses normal mutation records for data and subtree removals', async (operation) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((operation) => {
      const root = document.createElement('root');
      const start = root.appendChild(document.createTextNode('abc'));
      const middle = root.appendChild(document.createElement('middle'));
      middle.append('whole');
      const end = root.appendChild(document.createTextNode('def'));
      const range = new Range();
      range.setStart(start, 1);
      range.setEnd(end, 2);
      const observer = new MutationObserver(() => {});
      observer.observe(root, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
      range[operation]();
      return observer.takeRecords().map((record) => [record.type,
        record.target === start ? 'start' : record.target === end ? 'end' : 'root',
        record.oldValue, record.removedNodes.length,
        record.type !== 'childList' || (record.previousSibling === start && record.nextSibling === end)]);
    }, operation)).toEqual([['characterData', 'start', 'abc', 0, true],
      ['childList', 'root', null, 1, true], ['characterData', 'end', 'def', 0, true]]);
  });
});
