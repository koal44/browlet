import { assert, describe, expect, it } from 'vitest';

import type { DocumentImpl } from '../../../../../src/browlet/dom/nodes/document';
import { HTMLElementImpl } from '../../../../../src/browlet/dom/nodes/html/html-element';
import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../../src/infra/index';
import { createTestDocument, parseTestDocument } from '../../../../support/dom';

describe('HTML optional tags', () => {
  it('requires start tags with attributes, including a customized built-in is value', () => {
    const document = createTestDocument();
    for (const name of ['html', 'head', 'body', 'colgroup', 'tbody']) {
      const element = createHTML(document, name);
      if (name === 'colgroup') element.appendChild(createHTML(document, 'col'));
      if (name === 'tbody') element.appendChild(createHTML(document, 'tr'));
      expect(element.canOmitStartTag(false), name).toBe(true);
      element.setAttributeNS(null, 'class', 'example');
      expect(element.canOmitStartTag(false), name).toBe(false);
      element.removeAttributeNS(null, 'class');
      expect(element.canOmitStartTag(false), name).toBe(true);
      element.isValue = 'x-example';
      expect(element.canOmitStartTag(false), name).toBe(false);
    }
  });

  it('does not treat ordinary or forbidden void-element end tags as optional', () => {
    const document = createTestDocument();
    for (const name of ['div', 'span', 'q', 'input', 'col', 'br', 'x-example']) {
      const element = createHTML(document, name);
      expect(element.canOmitStartTag(false), name).toBe(false);
      expect(element.canOmitEndTag(), name).toBe(false);
    }
  });

  it('preserves comments around html and body', () => {
    const document = createTestDocument();
    for (const name of ['html', 'body']) {
      const parent = document.createDocumentFragment();
      const element = createHTML(document, name);
      parent.appendChild(element);
      element.appendChild(document.createTextNode(''));
      expect(element.canOmitStartTag(false), name).toBe(true);
      const inside = document.createComment('inside');
      element.appendChild(inside);
      expect(element.canOmitStartTag(false), name).toBe(false);
      inside.removeNode();

      expect(element.canOmitEndTag(), name).toBe(true);
      parent.appendChild(document.createTextNode(''));
      const after = document.createComment('after');
      parent.appendChild(after);
      expect(element.canOmitEndTag(), name).toBe(false);
      after.removeNode();
      parent.appendChild(document.createTextNode('\n'));
      expect(element.canOmitEndTag(), name).toBe(true);
    }
  });

  it('permits a head start tag only for empty content or an element first', () => {
    const document = createTestDocument();
    const head = createHTML(document, 'head');
    head.appendChild(document.createTextNode(''));
    expect(head.canOmitStartTag(false)).toBe(true);
    const title = createHTML(document, 'title');
    head.appendChild(title);
    expect(head.canOmitStartTag(false)).toBe(true);
    const space = document.createTextNode(' ');
    head.insertBefore(space, title);
    expect(head.canOmitStartTag(false)).toBe(false);
    space.removeNode();
    head.insertBefore(document.createComment('keep in head'), title);
    expect(head.canOmitStartTag(false)).toBe(false);
  });

  it('retains body start tags before metadata-like elements, whitespace, and comments', () => {
    const document = createTestDocument();
    for (const name of ['meta', 'noscript', 'link', 'script', 'style', 'template']) {
      const body = createHTML(document, 'body');
      body.appendChild(document.createTextNode(''));
      body.appendChild(createHTML(document, name));
      expect(body.canOmitStartTag(false), name).toBe(false);
    }

    const body = createHTML(document, 'body');
    const text = document.createTextNode('text');
    body.appendChild(text);
    expect(body.canOmitStartTag(false)).toBe(true);
    text.data = '\ntext';
    expect(body.canOmitStartTag(false)).toBe(false);
    text.data = '\u00a0text';
    expect(body.canOmitStartTag(false)).toBe(true);
    text.removeNode();
    body.appendChild(createHTML(document, 'p'));
    expect(body.canOmitStartTag(false)).toBe(true);
  });

  it('checks the first following character for head, colgroup, and caption end tags', () => {
    const document = createTestDocument();
    for (const name of ['head', 'colgroup', 'caption']) {
      const parent = document.createDocumentFragment();
      const element = createHTML(document, name);
      parent.appendChild(element);
      expect(element.canOmitEndTag(), name).toBe(true);
      const text = document.createTextNode('');
      parent.appendChild(text);
      for (const space of ['\t', '\n', '\f', '\r', ' ']) {
        text.data = space + 'following';
        expect(element.canOmitEndTag(), name).toBe(false);
      }
      text.data = 'following ';
      expect(element.canOmitEndTag(), name).toBe(true);
      text.data = '\u00a0';
      expect(element.canOmitEndTag(), name).toBe(true);
      text.data = '';
      parent.appendChild(document.createComment('keep outside'));
      expect(element.canOmitEndTag(), name).toBe(false);
    }
  });

  it('does not apply HTML tag conditions to the same names in other namespaces', () => {
    const document = createTestDocument();
    const parent = createHTML(document, 'ul');
    const item = createHTML(document, 'li');
    parent.appendChild(item);
    parent.appendChild(document.createElementNS(SVG_NAMESPACE, 'li'));
    expect(item.canOmitEndTag()).toBe(false);

    const colgroup = createHTML(document, 'colgroup');
    colgroup.appendChild(document.createElementNS(SVG_NAMESPACE, 'col'));
    expect(colgroup.canOmitStartTag(false)).toBe(false);

    const body = createHTML(document, 'body');
    body.appendChild(document.createElementNS(SVG_NAMESPACE, 'script'));
    expect(body.canOmitStartTag(false)).toBe(true);
  });

  const endCases: [string, string, string[], boolean][] = [
    ['li', 'ul', ['li'], true],
    ['dt', 'dl', ['dt', 'dd'], false],
    ['dd', 'dl', ['dd', 'dt'], true],
    ['rt', 'ruby', ['rt', 'rp'], true],
    ['rp', 'ruby', ['rt', 'rp'], true],
    ['optgroup', 'select', ['optgroup', 'hr'], true],
    ['option', 'select', ['option', 'optgroup', 'hr'], true],
    ['thead', 'table', ['tbody', 'tfoot'], false],
    ['tbody', 'table', ['tbody', 'tfoot'], true],
    ['tfoot', 'table', [], true],
    ['tr', 'tbody', ['tr'], true],
    ['td', 'tr', ['td', 'th'], true],
    ['th', 'tr', ['td', 'th'], true],
  ];

  it.each(endCases)('checks %s end-tag boundaries without skipping intervening content', (name, parentName, followers, atEnd) => {
    const document = createTestDocument();
    const parent = createHTML(document, parentName);
    const element = createHTML(document, name);
    expect(element.canOmitEndTag()).toBe(false);
    parent.appendChild(element);
    expect(element.canOmitEndTag()).toBe(atEnd);

    for (const follower of followers) {
      const next = createHTML(document, follower);
      parent.appendChild(next);
      expect(element.canOmitEndTag(), follower).toBe(true);
      const text = document.createTextNode('');
      parent.insertBefore(text, next);
      expect(element.canOmitEndTag(), follower).toBe(true);
      text.data = ' ';
      expect(element.canOmitEndTag(), follower).toBe(false);
      text.removeNode();
      next.removeNode();
    }

    const comment = document.createComment('following');
    parent.appendChild(comment);
    expect(element.canOmitEndTag()).toBe(false);
    comment.removeNode();
    parent.appendChild(createHTML(document, 'span'));
    expect(element.canOmitEndTag()).toBe(false);
  });

  it('retains paragraph end tags except before the specified followers or at an allowed parent end', () => {
    const document = createTestDocument();
    const parent = createHTML(document, 'div');
    const paragraph = createHTML(document, 'p');
    expect(paragraph.canOmitEndTag()).toBe(false);
    parent.appendChild(paragraph);
    expect(paragraph.canOmitEndTag()).toBe(true);

    const followers = [
      'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset',
      'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
      'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search', 'section', 'table', 'ul',
    ];
    for (const name of followers) {
      const next = createHTML(document, name);
      parent.appendChild(next);
      expect(paragraph.canOmitEndTag(), name).toBe(true);
      next.removeNode();
    }
    // Sharing a public interface with an allowed follower does not grant permission.
    for (const name of ['q', 'listing', 'xmp', 'span']) {
      const next = createHTML(document, name);
      parent.appendChild(next);
      expect(paragraph.canOmitEndTag(), name).toBe(false);
      next.removeNode();
    }
    parent.appendChild(document.createTextNode(' '));
    expect(paragraph.canOmitEndTag()).toBe(false);
    for (const name of ['a', 'audio', 'del', 'ins', 'map', 'noscript', 'video']) {
      createHTML(document, name).appendChild(paragraph);
      expect(paragraph.canOmitEndTag(), name).toBe(false);
    }
    document.createElementNS(SVG_NAMESPACE, 'svg').appendChild(paragraph);
    expect(paragraph.canOmitEndTag()).toBe(false);
  });

  it('distinguishes autonomous custom parents from customized built-in parents for paragraphs', () => {
    const document = createTestDocument();
    const parent = createHTML(document, 'x-parent');
    const paragraph = createHTML(document, 'p');
    parent.appendChild(paragraph);
    // Definition/upgrade is still a dependency; supply its resulting implementation state.
    parent.customElementDefinition = {
      name: 'x-parent', localName: 'x-parent', constructor: class {}, constructionStack: [],
    };
    expect(paragraph.canOmitEndTag()).toBe(false);

    const builtin = createHTML(document, 'div');
    builtin.appendChild(paragraph);
    builtin.customElementDefinition = {
      name: 'x-parent', localName: 'div', constructor: class {}, constructionStack: [],
    };
    expect(paragraph.canOmitEndTag()).toBe(true);
  });

  it('requires content and the preceding output decision before omitting table-group start tags', () => {
    const document = createTestDocument();
    const cases = [
      ['colgroup', 'col', 'colgroup'],
      ['tbody', 'tr', 'tbody'],
      ['tbody', 'tr', 'thead'],
      ['tbody', 'tr', 'tfoot'],
    ];
    for (const [name, childName, previousName] of cases) {
      assert(name && childName && previousName);
      const table = createHTML(document, 'table');
      const previous = createHTML(document, previousName);
      const element = createHTML(document, name);
      table.appendChild(previous);
      table.appendChild(document.createTextNode(''));
      table.appendChild(element);
      expect(element.canOmitStartTag(false), name).toBe(false);
      element.appendChild(document.createTextNode(''));
      const child = createHTML(document, childName);
      element.appendChild(child);
      expect(element.canOmitStartTag(false), name).toBe(true);
      expect(element.canOmitStartTag(true), name).toBe(false);

      const space = document.createTextNode(' ');
      element.insertBefore(space, child);
      expect(element.canOmitStartTag(false), name).toBe(false);
      space.removeNode();
      table.insertBefore(document.createComment('between groups'), element);
      expect(element.canOmitStartTag(false), name).toBe(true);
    }
  });

  it('keeps separate tbody elements from merging when a preceding end tag was omitted', () => {
    const explicit = parseTestDocument('<table><tbody><tr><td>A</tbody><tbody><tr><td>B</tbody></table>');
    const bodies = explicit.getElementsByTagName('tbody');
    const first = bodies.item(0);
    const second = bodies.item(1);
    assert(first instanceof HTMLElementImpl && second instanceof HTMLElementImpl);
    expect(first.canOmitEndTag()).toBe(true);
    expect(second.canOmitStartTag(false)).toBe(true);
    expect(second.canOmitStartTag(true)).toBe(false);

    const keptStart = parseTestDocument('<table><tbody><tr><td>A<tbody><tr><td>B</table>');
    const keptEnd = parseTestDocument('<table><tbody><tr><td>A</tbody><tr><td>B</table>');
    const bothOmitted = parseTestDocument('<table><tbody><tr><td>A<tr><td>B</table>');
    expect(keptStart.getElementsByTagName('tbody').length).toBe(2);
    expect(keptEnd.getElementsByTagName('tbody').length).toBe(2);
    expect(bothOmitted.getElementsByTagName('tbody').length).toBe(1);
  });
});

function createHTML(document: DocumentImpl, name: string): HTMLElementImpl {
  const element = document.createElementNS(HTML_NAMESPACE, name);
  assert(element instanceof HTMLElementImpl);
  return element;
}
