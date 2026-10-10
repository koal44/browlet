import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createTestDocument } from '../../../support/dom';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';

describe('Node values and text content', () => {
  it('reads descendant text in tree order while excluding comments', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const fragment = new DocumentFragment();
      const parent = fragment.appendChild(document.createElement('parent'));
      parent.appendChild(new Text(' a '));
      parent.appendChild(new Comment('ignored'));
      parent.appendChild(document.createElement('child')).appendChild(new Text('nested'));
      parent.appendChild(new Text(' z '));
      return [fragment.textContent, parent.textContent, parent.nodeValue, document.textContent, document.nodeValue];
    })).toEqual([' a nested z ', ' a nested z ', null, null, null]);
  });

  it.each(['nodeValue', 'textContent'] as const)('%s shares character-data replacement and null handling', async (property) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((property) => {
      const text = new Text('abc');
      const comment = new Comment('old');
      const range = new Range();
      range.selectNodeContents(text);
      text[property] = 'replacement';
      comment[property] = 'comment';
      const replaced = [text.data, text.nodeValue, text.textContent, range.startOffset, range.endOffset, comment.data];
      text[property] = null;
      Reflect.set(comment, property, undefined);
      return [replaced, text.data, comment.data];
    }, property)).toEqual([['replacement', 'replacement', 'replacement', 0, 0, 'comment'], '', '']);
  });

  it.each(['nodeValue', 'textContent'] as const)('%s changes an attached attribute through its existing value operation', async (property) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((property) => {
      const element = document.createElement('main');
      element.setAttribute('title', 'old');
      const attribute = element.attributes[0]!;
      attribute[property] = 'updated';
      const updated = [attribute.value, attribute.nodeValue, attribute.textContent, element.getAttribute('title')];
      attribute[property] = null;
      return [updated, attribute.value, element.getAttribute('title'), element.attributes[0] === attribute];
    }, property)).toEqual([['updated', 'updated', 'updated', 'updated'], '', '', true]);
  });

  it('replaces rather than edits existing children, even when the text is unchanged', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const old = parent.appendChild(new Text('same'));
      const range = new Range();
      range.selectNodeContents(old);
      const iterator = document.createNodeIterator(parent);
      iterator.nextNode();
      iterator.nextNode();
      parent.textContent = 'same';
      const replacement = parent.firstChild!;
      const replaced = [replacement !== old, replacement instanceof Text, replacement.ownerDocument === document,
        old.parentNode, range.startContainer === parent, range.startOffset, range.endOffset,
        iterator.referenceNode === parent, iterator.nextNode() === replacement];
      parent.textContent = '';
      return [replaced, parent.firstChild, parent.textContent];
    })).toEqual([[true, true, true, null, true, 0, 0, true, true], null, '']);
  });

  it('sets fragment text and leaves Document, doctype, and Element.nodeValue unchanged', async () => {
    const browlet = new Browlet({ route: () => '<!doctype html><html><body></body></html>' });
    await browlet.navigate('https://example.test/');
    expect(await browlet.evaluate(() => {
      const fragment = new DocumentFragment();
      fragment.textContent = 'fragment';
      const root = document.documentElement;
      Reflect.set(document, 'textContent', 'ignored');
      document.nodeValue = 'ignored';
      root.nodeValue = 'ignored';
      const doctype = document.doctype!;
      Reflect.set(doctype, 'textContent', 'ignored');
      doctype.nodeValue = 'ignored';
      return [fragment.firstChild instanceof Text, fragment.textContent, document.documentElement === root,
        document.nodeValue, document.textContent, root.nodeValue, doctype.nodeValue, doctype.textContent];
    })).toEqual([true, 'fragment', true, null, null, null, null, null]);
  });

  it('uses ordinary-tree content for hosts and shadow roots independently', () => {
    const document = createTestDocument();
    const host = document.createElement('host');
    const shadow = new ShadowRootImpl(host, 'open', document.env);
    host.shadowRoot = shadow;
    host.textContent = 'light';
    shadow.textContent = 'shadow';
    expect(host.textContent).toBe('light');
    expect(shadow.textContent).toBe('shadow');
    host.textContent = null;
    expect(host.firstChild).toBeNull();
    expect(shadow.textContent).toBe('shadow');
  });
});
