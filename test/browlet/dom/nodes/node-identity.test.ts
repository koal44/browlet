import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('Node identity and position', () => {
  it('compares node data, unordered attributes, and ordered ordinary children', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const first = document.createElement('div');
      const second = document.createElement('div');
      first.setAttribute('a', '1'); first.setAttribute('b', '2');
      second.setAttribute('b', '2'); second.setAttribute('a', '1');
      first.append('text', document.createComment('comment'));
      second.append('text', document.createComment('comment'));
      const equal = first.isEqualNode(second);
      second.attachShadow({ mode: 'open' }).append('ignored');
      const ignoresShadow = first.isEqualNode(second);
      second.firstChild!.nodeValue = 'changed';
      const changed = first.isEqualNode(second);
      const a = document.createAttributeNS('urn:a', 'a:name');
      const b = document.createAttributeNS('urn:a', 'b:name');
      return [equal, ignoresShadow, changed, a.isEqualNode(b), first.isSameNode(first), first.isSameNode(second),
        first.isEqualNode(null), second.shadowRoot!.isEqualNode(document.createDocumentFragment()),
        new Document().isEqualNode(document.implementation.createDocument(null, ''))];
    })).toEqual([true, true, false, true, true, false, false, false, true]);
  });

  it('exposes constants and node names, and recomputes HTML casing after adoption', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', 'p:MiXeD');
      const before = [element.nodeName, element.tagName];
      const xml = new Document();
      xml.adoptNode(element);
      element.id = 'id'; element.className = 'class';
      return [Node.ELEMENT_NODE, element.DOCUMENT_POSITION_FOLLOWING, Node.NOTATION_NODE, before,
        element.nodeName, element.getAttribute('id'), element.getAttribute('class'), element.hasChildNodes(),
        document.nodeName, xml.createTextNode('').nodeName, xml.createComment('').nodeName];
    })).toEqual([1, 4, 12, ['P:MIXED', 'P:MIXED'], 'p:MiXeD', 'id', 'class', false, '#document', '#text', '#comment']);
  });
  it('orders disconnected nodes consistently in opposite directions', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const first = document.createElement('div');
      const second = document.createTextNode('second');
      const forward = first.compareDocumentPosition(second);
      const reverse = second.compareDocumentPosition(first);
      return [forward & 33, reverse & 33, (forward & 6) !== 0,
        (forward & 6) !== (reverse & 6), forward === first.compareDocumentPosition(second)];
    })).toEqual([33, 33, true, true, true]);
  });

  it('compares attributes through their owners and orders attributes before children', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      parent.setAttribute('first', '1');
      parent.setAttribute('second', '2');
      const first = parent.getAttributeNode('first')!;
      const second = parent.getAttributeNode('second')!;
      const child = parent.appendChild(document.createElement('span'));
      return [parent.compareDocumentPosition(first), first.compareDocumentPosition(parent),
        first.compareDocumentPosition(second), second.compareDocumentPosition(first),
        first.compareDocumentPosition(child), child.compareDocumentPosition(first), parent.contains(first)];
    })).toEqual([20, 10, 36, 34, 4, 2, false]);
  });
});
