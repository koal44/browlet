import { describe, expect, it } from 'vitest';

import { Document } from '../../../../src/domlet/nodes/document';

describe('DOM node traversal', () => {
  it('projects element traversal over the node tree', () => {
    const document = new Document();
    const parent = document.createElement('parent');
    const first = document.createElement('first');
    const text = document.createTextNode('between');
    const last = document.createElement('last');

    document.appendChild(parent);
    parent.appendChild(first);
    parent.appendChild(text);
    parent.appendChild(last);

    expect(parent.firstElementChild).toBe(first);
    expect(parent.lastElementChild).toBe(last);
    expect(parent.children).toEqual([first, last]);
    expect(parent.childElementCount).toBe(2);
    expect(first.nextElementSibling).toBe(last);
    expect(last.previousElementSibling).toBe(first);
    expect(text.previousElementSibling).toBe(first);
    expect(text.nextElementSibling).toBe(last);
    expect(first.parentNode).toBe(parent);
    expect(first.parentElement).toBe(parent);
  });

  it('reports roots, connection, and ownership', () => {
    const document = new Document();
    const parent = document.createElement('parent');
    const child = document.createElement('child');

    parent.appendChild(child);

    expect(child.getRootNode()).toBe(parent);
    expect(child.isConnected).toBe(false);
    expect(child.ownerDocument).toBe(document);

    document.appendChild(parent);

    expect(child.getRootNode()).toBe(document);
    expect(child.isConnected).toBe(true);
    expect(document.ownerDocument).toBeNull();
  });

  it('projects tree comparison into DOM position flags', () => {
    const document = new Document();
    const parent = document.createElement('div');
    const first = document.createElement('span');
    const second = document.createElement('span');

    parent.appendChild(first);
    parent.appendChild(second);

    expect(parent.compareDocumentPosition(first)).toBe(0x04 | 0x10);
    expect(first.compareDocumentPosition(parent)).toBe(0x02 | 0x08);
    expect(first.compareDocumentPosition(second)).toBe(0x04);
    expect(second.compareDocumentPosition(first)).toBe(0x02);
    expect(first.compareDocumentPosition(first)).toBe(0);
  });
});
