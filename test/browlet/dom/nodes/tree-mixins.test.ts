import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createTestDocument } from '../../../support/dom';
import { DocumentTypeImpl } from '../../../../src/browlet/dom/nodes/document-type';

describe('tree mixin mutations', () => {
  it('combines nodes and strings in order, retaining adjacent text as separate nodes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const element = document.createElement('span');
      parent.append('b', element, 'c');
      parent.prepend('a', '');
      const before = Array.from(parent.childNodes, (node) => [node.nodeType, node.textContent]);
      parent.replaceChildren(element, 'd');
      const after = Array.from(parent.childNodes, (node) => [node.nodeType, node.textContent]);
      parent.replaceChildren();
      return [before, after, parent.childNodes.length];
    })).toEqual([[[3, 'a'], [3, ''], [3, 'b'], [1, ''], [3, 'c']], [[1, ''], [3, 'd']], 0]);
  });

  it.each(['before', 'after', 'replaceWith'] as const)('keeps a viable anchor when %s includes its receiver and siblings', async (method) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((method) => {
      const parent = document.createElement('div');
      const a = document.createTextNode('a');
      const b = document.createTextNode('b');
      const c = document.createTextNode('c');
      const d = document.createTextNode('d');
      parent.append(a, b, c, d);
      b[method](c, b, a, b);
      return [parent.textContent, parent.childNodes.length, parent.lastChild === d];
    }, method)).toEqual(['cabd', 4, true]);
  });

  it('performs author conversion before selecting the mutation parent and reference', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const first = document.createElement('div');
      const second = document.createElement('div');
      const text = document.createTextNode('x');
      first.append(text);
      const argument = { toString() { second.append(text); return 'before'; } };
      text.before(argument as unknown as string);
      second.prepend({ toString() { second.prepend('inner'); return 'outer'; } } as unknown as string);
      return [first.textContent, second.textContent];
    })).toEqual(['', 'outerinnerbeforex']);
  });

  it('leaves detached children alone and supports empty replacements', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const retained = document.createElement('span');
      parent.append(retained);
      const detached = document.createTextNode('detached');
      detached.before(retained);
      detached.after(retained);
      detached.replaceWith(retained);
      const unchanged = parent.firstChild === retained;
      retained.replaceWith();
      return [unchanged, parent.childNodes.length, detached.textContent];
    })).toEqual([true, 0, 'detached']);
  });

  it('validates replacement Document children while excluding the old tree', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const target = new Document();
      target.append(target.createElement('old'));
      const replacement = target.createElement('new');
      target.replaceChildren(replacement);
      let name = '';
      try { target.replaceChildren('text'); } catch (error) { name = (error as DOMException).name; }
      return [target.documentElement === replacement, name, target.childNodes.length];
    })).toEqual([true, 'HierarchyRequestError', 1]);
  });

  it('uses ordinary pre-removal adjustments for live ranges and traversal cursors', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const child = document.createTextNode('old');
      parent.append(child);
      const range = document.createRange();
      range.selectNode(child);
      const iterator = document.createNodeIterator(parent);
      iterator.nextNode();
      iterator.nextNode();
      child.replaceWith('new');
      return [range.startContainer === parent, range.startOffset, range.endOffset,
        iterator.referenceNode === parent, iterator.nextNode() === parent.firstChild];
    })).toEqual([true, 0, 0, true, true]);
  });

  it('shares ChildNode operations with document types', () => {
    const document = createTestDocument();
    const doctype = new DocumentTypeImpl('html', '', '', document, document.env);
    document.appendChild(doctype);
    const before = document.createComment('before');
    const after = document.createComment('after');
    doctype.before(before);
    doctype.after(after);
    doctype.replaceWith();
    expect(Array.from(document.childNodes)).toEqual([before, after]);
  });

  it('marks only the specified convenience methods as unscopable', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return [Element.prototype, Document.prototype, DocumentFragment.prototype, CharacterData.prototype, DocumentType.prototype]
        .map((prototype) => {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.unscopables)!;
          const value = descriptor.value as Record<string, boolean>;
          return [Object.getPrototypeOf(value) === null, Object.keys(value).sort(), descriptor.writable,
            descriptor.enumerable, descriptor.configurable];
        });
    })).toEqual([
      [true, ['after', 'append', 'before', 'prepend', 'remove', 'replaceChildren', 'replaceWith'], false, false, true],
      [true, ['append', 'prepend', 'replaceChildren'], false, false, true],
      [true, ['append', 'prepend', 'replaceChildren'], false, false, true],
      [true, ['after', 'before', 'remove', 'replaceWith'], false, false, true],
      [true, ['after', 'before', 'remove', 'replaceWith'], false, false, true],
    ]);
  });
});
