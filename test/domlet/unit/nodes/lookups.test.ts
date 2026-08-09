import { describe, expect, it } from 'vitest';

import { Attribute } from '../../../../src/domlet/nodes/attribute';
import { Document } from '../../../../src/domlet/nodes/document';

describe('element lookups', () => {
  it('finds the first matching ID in document order', () => {
    const { document, first, nested, last } = createFixture();

    first.attributes.push(new Attribute('id', 'match'));
    nested.attributes.push(new Attribute('id', 'match'));
    last.attributes.push(new Attribute('id', 'match'));

    expect(document.getElementById('match')).toBe(first);
    expect(document.getElementById('missing')).toBeNull();
  });

  it('matches every requested class and preserves document order', () => {
    const { document, root, first, nested, last } = createFixture();

    first.attributes.push(new Attribute('class', 'one two'));
    nested.attributes.push(new Attribute('class', 'two\tthree one'));
    last.attributes.push(new Attribute('class', 'one'));

    expect(document.getElementsByClassName('one two')).toEqual([first, nested]);
    expect(root.getElementsByClassName('one')).toEqual([first, nested, last]);
    expect(document.getElementsByClassName('  ')).toEqual([]);
  });

  it('matches tag names and wildcards in document order', () => {
    const { document, root, first, nested, last } = createFixture();

    expect(document.getElementsByTagName('item')).toEqual([first, nested, last]);
    expect(root.getElementsByTagName('*')).toEqual([first, nested, last]);
    expect(first.getElementsByTagName('item')).toEqual([nested]);
  });

  it('matches namespace and local-name wildcards', () => {
    const { document, first, nested, last } = createFixture();
    const svg = 'http://www.w3.org/2000/svg';

    const svgItem = document.createElement('item', svg);
    document.documentElement!.appendChild(svgItem);

    expect(document.getElementsByTagNameNS(svg, 'item')).toEqual([svgItem]);
    expect(document.getElementsByTagNameNS('*', 'item'))
      .toEqual([first, nested, last, svgItem]);
    expect(document.getElementsByTagNameNS(svg, '*')).toEqual([svgItem]);
  });
});

function createFixture() {
  const document = new Document();
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
