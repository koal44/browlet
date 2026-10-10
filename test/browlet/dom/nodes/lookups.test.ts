import { describe, expect, it } from 'vitest';
import { createTestDocument } from '../../../support/dom';
import { DocumentMode } from '../../../../src/browlet/dom/nodes/document';


describe('element lookups', () => {
  it('finds the first matching ID in document order', () => {
    const { document, first, nested, last } = createFixture();

    first.setAttribute('id', 'match');
    nested.setAttribute('id', 'match');
    last.setAttribute('id', 'match');

    expect(document.getElementById('match')).toBe(first);
    expect(document.getElementById('missing')).toBeNull();
  });

  it('does not treat an empty id attribute as an element ID', () => {
    const { document, first } = createFixture();
    first.setAttribute('id', '');
    expect(document.getElementById('')).toBeNull();
  });

  it('keeps retained collection lengths current after tree and attribute changes', () => {
    const { document, root, first } = createFixture();
    const elements = root.getElementsByTagName('item');
    const classes = root.getElementsByClassName('selected');
    expect(elements.length).toBe(3);
    expect(classes.length).toBe(0);
    root.appendChild(document.createElement('item'));
    first.setAttribute('class', 'selected');
    expect(elements.length).toBe(4);
    expect(classes.length).toBe(1);
  });

  it('matches HTML tag names without changing foreign-element case', () => {
    const { document, root, first, nested, last } = createFixture();
    document.type = 'html';
    const foreign = document.createElementNS('urn:test', 'ITEM');
    root.appendChild(foreign);
    expect(Array.from(root.getElementsByTagName('ITEM'))).toEqual([first, nested, last, foreign]);
    expect(Array.from(root.getElementsByTagName('item'))).toEqual([first, nested, last]);
  });

  it('treats an empty namespace as null in namespace lookups', () => {
    const { document, root } = createFixture();
    const element = document.createElementNS(null, 'item');
    root.appendChild(element);
    expect(Array.from(root.getElementsByTagNameNS(null, 'item'))).toEqual([element]);
    expect(Array.from(root.getElementsByTagNameNS('', 'item'))).toEqual([element]);
  });

  it('uses ASCII-insensitive class matching in quirks mode', () => {
    const { document, root, first } = createFixture();
    document.mode = DocumentMode.Quirks;
    first.setAttribute('class', 'MiXeD cafÉ');
    expect(root.getElementsByClassName('mixed cafÉ').length).toBe(1);
    expect(root.getElementsByClassName('mixed café').length).toBe(0);
  });

  it('distinguishes qualified and local names for prefixed elements', () => {
    const { document, root } = createFixture();
    root.appendChild(document.createElementNS('urn:test', 'p:item'));
    expect(root.getElementsByTagName('p:item').length).toBe(1);
    expect(root.getElementsByTagNameNS('urn:test', 'item').length).toBe(1);
  });

  it('matches every requested class and preserves document order', () => {
    const { document, root, first, nested, last } = createFixture();

    first.setAttribute('class', 'one two');
    nested.setAttribute('class', 'two\tthree one');
    last.setAttribute('class', 'one');

    expect(Array.from(document.getElementsByClassName('one two'))).toEqual([first, nested]);
    expect(Array.from(root.getElementsByClassName('one'))).toEqual([first, nested, last]);
    expect(Array.from(document.getElementsByClassName('  '))).toEqual([]);
  });

  it('matches tag names and wildcards in document order', () => {
    const { document, root, first, nested, last } = createFixture();

    expect(Array.from(document.getElementsByTagName('item'))).toEqual([first, nested, last]);
    expect(Array.from(root.getElementsByTagName('*'))).toEqual([first, nested, last]);
    expect(Array.from(first.getElementsByTagName('item'))).toEqual([nested]);
  });

  it('matches namespace and local-name wildcards', () => {
    const { document, root, first, nested, last } = createFixture();
    const svg = 'http://www.w3.org/2000/svg';

    const svgItem = document.createElementNS(svg, 'item');
    root.appendChild(svgItem);

    expect(Array.from(document.getElementsByTagNameNS(svg, 'item'))).toEqual([svgItem]);
    expect(Array.from(document.getElementsByTagNameNS('*', 'item')))
      .toEqual([first, nested, last, svgItem]);
    expect(Array.from(document.getElementsByTagNameNS(svg, '*'))).toEqual([svgItem]);
  });
});

function createFixture() {
  const document = createTestDocument();
  const root = document.createElement('root');
  const first = document.createElement('item');
  const nested = document.createElement('item');
  const last = document.createElement('item');

  document.appendChild(root);
  root.appendChild(first);
  first.appendChild(nested);
  root.appendChild(last);

  return { document, root, first, nested, last };
}
