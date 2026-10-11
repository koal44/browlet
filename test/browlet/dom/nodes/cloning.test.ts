import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import type { Element as PlatformElement, HTMLSlotElement as PlatformSlotElement } from '../../../../src/browlet/platform';

describe('Node cloning and import', () => {
  it('copies names, ordered attributes, and descendants without sharing nodes or listeners', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const source = document.createElementNS('urn:example', 'p:root');
      source.setAttributeNS('urn:attr', 'a:first', 'one');
      source.setAttribute('second', 'two');
      source.append(document.createTextNode('text'), document.createComment('comment'));
      let calls = 0;
      source.addEventListener('test', () => calls++);
      const copy = source.cloneNode(true) as Element;
      const shallow = source.cloneNode() as Element;
      copy.dispatchEvent(new Event('test'));
      return [copy !== source, copy.isEqualNode(source), shallow.childNodes.length,
        copy.getAttributeNames(), copy.getAttributeNode('second') !== source.getAttributeNode('second'),
        copy.firstChild !== source.firstChild, copy.ownerDocument === document,
        copy.firstChild!.ownerDocument === document, copy.parentNode, calls];
    })).toEqual([true, true, 0, ['a:first', 'second'], true, true, true, true, null, 0]);
  });

  it('copies document metadata and associates all copied nodes with the new document', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = document.implementation.createDocument('urn:example', 'p:root');
      xml.documentElement.append(xml.createCDATASection('cdata'), xml.createProcessingInstruction('test', 'x="1"'));
      const copy = xml.cloneNode(true) as XMLDocument;
      return [copy instanceof XMLDocument, copy !== xml, copy.ownerDocument, copy.URL === xml.URL,
        copy.contentType, copy.isEqualNode(xml), copy.documentElement.ownerDocument === copy,
        copy.documentElement.firstChild!.ownerDocument === copy, copy.defaultView,
        copy.implementation !== xml.implementation];
    })).toEqual([true, true, null, true, 'application/xml', true, true, true, null, true]);
  });

  it('copies all leaf kinds, including XML data made invalid after construction', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = document.implementation.createDocument(null, 'root');
      const cdata = xml.createCDATASection('valid');
      cdata.data = ']]>';
      const pi = xml.createProcessingInstruction('test', 'valid');
      pi.data = '?>';
      const attribute = xml.createAttributeNS('urn:a', 'p:value');
      attribute.value = 'attr';
      const nodes: Node[] = [cdata, pi, attribute, xml.createTextNode('text'),
        xml.createComment('comment'), xml.implementation.createDocumentType('root', 'public', 'system'),
        xml.createDocumentFragment()];
      return nodes.map((node) => {
        const copy = document.importNode(node, true);
        return [copy.nodeType, copy.nodeName, copy.nodeValue, copy.ownerDocument === document, copy.isEqualNode(node)];
      });
    })).toEqual([
      [4, '#cdata-section', ']]>', true, true], [7, 'test', '?>', true, true],
      [2, 'p:value', 'attr', true, true], [3, '#text', 'text', true, true],
      [8, '#comment', 'comment', true, true], [10, 'root', null, true, true],
      [11, '#document-fragment', null, true, true],
    ]);
  });

  it('clones clonable shadow trees even for shallow host copies and rejects standalone roots', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open', clonable: true, delegatesFocus: true, serializable: true });
      shadow.append(document.createElement('slot'), document.createTextNode('shadow'));
      host.append('light');
      const shallow = host.cloneNode(false) as Element;
      const deep = host.cloneNode(true) as Element;
      const errors: string[] = [];
      for (const action of [() => shadow.cloneNode(), () => document.importNode(shadow),
        () => document.importNode(document)]) {
        try { action(); } catch (error) { errors.push((error as DOMException).name); }
      }
      return [shallow.childNodes.length, shallow.shadowRoot!.textContent, shallow.shadowRoot!.host === shallow,
        shallow.shadowRoot!.delegatesFocus, shallow.shadowRoot!.serializable,
        deep.textContent, deep.shadowRoot !== shadow, errors];
    })).toEqual([0, 'shadow', true, true, true, 'light', true, Array(3).fill('NotSupportedError')]);
  });

  it('imports into the destination realm even through a borrowed method', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const source = first.window.document.createElement('div');
    source.appendChild(first.window.document.createTextNode('text'));
    const copy = first.window.document.importNode.call(second.window.document, source, true);
    expect(copy).toBeInstanceOf(second.window.HTMLElement);
    expect(copy).not.toBeInstanceOf(first.window.HTMLElement);
    expect(copy.firstChild).toBeInstanceOf(second.window.Text);
    expect(copy.ownerDocument).toBe(second.window.document);
    expect(source.ownerDocument).toBe(first.window.document);
  });

  it('distinguishes the boolean and dictionary import defaults', () => {
    const browser = new Browlet({ route: () => '' });
    const document = browser.window.document;
    const source = document.createElement('div');
    source.append('text');
    expect(document.importNode(source).childNodes.length).toBe(0);
    expect(document.importNode(source, {}).childNodes.length).toBe(1);
    expect(document.importNode(source, { selfOnly: true }).childNodes.length).toBe(0);
    expect(() => document.importNode(source, {
      customElementRegistry: null,
    } as unknown as Parameters<typeof document.importNode>[1])).toThrow(expect.objectContaining({ name: 'TypeError' }));
  });

  it('does not copy manual slot membership or nonclonable shadow roots', () => {
    const browser = new Browlet({ route: () => '' });
    const document = browser.window.document;
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open', slotAssignment: 'manual', clonable: true });
    const slot = document.createElement('slot');
    const text = document.createTextNode('light');
    shadow.append(slot);
    host.append(text);
    // The generated createElement contract returns Element for arbitrary names.
    (slot as PlatformSlotElement).assign(text);
    const copy = host.cloneNode(true) as PlatformElement;
    const copiedSlot = copy.shadowRoot!.firstChild as PlatformSlotElement;
    expect(copiedSlot.assignedNodes()).toEqual([]);
    const other = document.createElement('div');
    other.attachShadow({ mode: 'open' });
    expect((other.cloneNode(true) as typeof other).shadowRoot).toBeNull();
  });
});
