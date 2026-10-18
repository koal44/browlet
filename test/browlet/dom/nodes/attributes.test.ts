import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createTestDocument } from '../../../support/dom';

describe('DOM attributes', () => {
  // https://html.spec.whatwg.org/multipage/dom.html#attribute-text
  it('preserves unrestricted attribute strings through DOM setters', async () => {
    const browlet = new Browlet({ route: () => '' });
    const values = ['', ' \t\r\n ', '<tag a="b">&\'</tag>', 'before\0after', '\uD800', '\uDFFF', '\u{1F98A}'];
    expect(await browlet.evaluate((values) => {
      const element = document.createElement('main');
      const attribute = document.createAttribute('data-attr-value');
      element.setAttributeNode(attribute);
      return values.map((value) => {
        element.setAttribute('data-value', value);
        element.setAttributeNS('urn:test', 'p:value', value);
        attribute.value = value;
        return [
          element.getAttribute('data-value'), element.getAttributeNS('urn:test', 'value'),
          element.getAttribute('data-attr-value'), attribute.value,
        ];
      });
    }, values)).toEqual(values.map((value) => [value, value, value, value]));
  });

  it('keeps one live map and one Attr while exposing independent name snapshots', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      const attributes = element.attributes;
      const empty = element.hasAttributes();
      element.setAttribute('DATA-State', 'first');
      const attribute = element.getAttributeNode('data-state')!;
      const names = element.getAttributeNames();
      element.setAttribute('DATA-STATE', 'second');
      element.setAttribute('title', 'title');
      return [
        empty, element.hasAttributes(), attributes === element.attributes,
        attribute === attributes.item(0), attribute === element.getAttributeNodeNS(null, 'data-state'),
        attribute.value, attribute.ownerElement === element, attribute.ownerDocument === document,
        attribute.parentNode, names instanceof Array, names, element.getAttributeNames(),
      ];
    })).toEqual([false, true, true, true, true, 'second', true, true, null, true, ['data-state'], ['data-state', 'title']]);
  });

  it('preserves case on HTML elements in XML documents', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const xml = new Document();
      const element = xml.createElementNS('http://www.w3.org/1999/xhtml', 'main');
      element.setAttribute('DATA-State', 'value');
      return [element.attributes[0]!.name, element.getAttribute('DATA-State'), element.getAttribute('data-state')];
    })).toEqual(['DATA-State', 'value', null]);
  });

  it('preserves case on foreign elements in HTML documents', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      element.setAttribute('viewBox', '0 0 10 10');
      return [element.attributes[0]!.name, element.getAttribute('viewBox'), element.getAttribute('viewbox')];
    })).toEqual(['viewBox', '0 0 10 10', null]);
  });

  it('updates the document when a map attaches or replaces an attribute', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const source = new Document();
      const element = document.createElement('main');
      const first = source.createAttribute('data-value');
      const second = source.createAttribute('data-value');
      const appended = element.attributes.setNamedItem(first);
      const firstAdopted = first.ownerDocument === document;
      const replaced = element.attributes.setNamedItemNS(second);
      return [
        appended === null, firstAdopted, replaced === first,
        first.ownerElement === null, first.ownerDocument === document,
        second.ownerElement === element, second.ownerDocument === document,
      ];
    })).toEqual([true, true, true, true, true, true, true]);
  });

  it('distinguishes qualified names from namespace/local-name pairs and retains an existing prefix', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      element.setAttributeNS('urn:one', 'a:State', 'first');
      const attribute = element.getAttributeNodeNS('urn:one', 'State')!;
      element.setAttributeNS('urn:one', 'b:State', 'second');
      element.setAttributeNS('urn:two', 'a:State', 'other');
      element.setAttributeNS('', 'plain', 'empty namespace');
      return [
        element.getAttributeNodeNS('urn:one', 'State') === attribute,
        attribute.name, attribute.localName, attribute.prefix, attribute.namespaceURI, attribute.value,
        element.getAttributeNS('urn:one', 'state'), element.getAttributeNS('urn:two', 'State'),
        element.getAttributeNS(null, 'plain'), element.hasAttributeNS('', 'plain'),
        element.getAttributeNames(),
      ];
    })).toEqual([true, 'a:State', 'State', 'a', 'urn:one', 'second', null, 'other', 'empty namespace', true,
      ['a:State', 'a:State', 'plain']]);
  });

  it('keeps colons in unnamespaced attribute local names', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      element.setAttribute('p:part', 'plain');
      element.setAttributeNS('urn:part', 'p:part', 'namespaced');
      const plain = element.getAttributeNode('p:part')!;
      element.setAttribute('p:part', 'changed');
      return [plain.localName, plain.prefix, plain.namespaceURI, plain.value,
        element.getAttributeNS('urn:part', 'part'), element.getAttributeNames()];
    })).toEqual(['p:part', null, null, 'changed', 'namespaced', ['p:part', 'p:part']]);
  });

  it.each(['', 'has space', 'has\ttab', 'a/b', 'a=b', 'a>b', 'a\0b'])(
    'rejects invalid local name %j before changing attributes', async (name) => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate((name) => {
        const element = document.createElement('main');
        element.setAttribute('kept', 'value');
        const errors: string[] = [];
        for (const action of [
          () => element.setAttribute(name, 'bad'),
          () => element.toggleAttribute(name, false),
          () => document.createAttribute(name),
        ]) {
          try { action(); errors.push('no exception'); }
          catch (error) { errors.push(error instanceof DOMException ? error.name : 'foreign exception'); }
        }
        return [errors, element.getAttributeNames(), element.getAttribute('kept')];
      }, name)).toEqual([['InvalidCharacterError', 'InvalidCharacterError', 'InvalidCharacterError'], ['kept'], 'value']);
    },
  );

  it.each([
    [null, 'p:value', 'NamespaceError'],
    ['', 'p:value', 'NamespaceError'],
    ['urn:test', 'xml:value', 'NamespaceError'],
    [null, 'xmlns', 'NamespaceError'],
    ['urn:test', 'xmlns:value', 'NamespaceError'],
    ['http://www.w3.org/2000/xmlns/', 'p:value', 'NamespaceError'],
    ['urn:test', ':value', 'InvalidCharacterError'],
    ['urn:test', 'p:', 'InvalidCharacterError'],
    ['urn:test', 'p:bad name', 'InvalidCharacterError'],
  ] as const)('validates namespace %j and name %j', async (namespace, name, expected) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(({ namespace, name }) => {
      const element = document.createElement('main');
      element.setAttribute('kept', 'value');
      const errors: string[] = [];
      for (const action of [
        () => element.setAttributeNS(namespace, name, 'bad'),
        () => document.createAttributeNS(namespace, name),
      ]) {
        try { action(); errors.push('no exception'); }
        catch (error) { errors.push(error instanceof DOMException ? error.name : 'foreign exception'); }
      }
      return [errors, element.getAttributeNames()];
    }, { namespace, name })).toEqual([[expected, expected], ['kept']]);
  });

  it('creates detached attributes with normalized namespaces and case-sensitive names', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const plain = document.createAttribute('DATA-State');
      const namespaced = document.createAttributeNS('urn:test', 'p:State');
      const empty = document.createAttributeNS('', 'UPPER');
      const xml = document.createAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang');
      const xmlns = document.createAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:p');
      namespaced.value = 'detached';
      return [plain.name, namespaced.name, namespaced.localName, namespaced.prefix, namespaced.value,
        namespaced.ownerElement, namespaced.ownerDocument === document, namespaced.specified,
        empty.name, empty.namespaceURI, xml.name, xmlns.name];
    })).toEqual(['data-state', 'p:State', 'State', 'p', 'detached', null, true, true, 'UPPER', null, 'xml:lang', 'xmlns:p']);
  });

  it('toggles without overwriting retained values and handles omitted versus false force', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      const absent = element.toggleAttribute('DATA-State', false);
      const added = element.toggleAttribute('DATA-State');
      const attribute = element.getAttributeNode('data-state')!;
      const initial = attribute.value;
      attribute.value = 'retained';
      const kept = element.toggleAttribute('DATA-STATE', true);
      const value = attribute.value;
      const removed = element.toggleAttribute('data-state');
      const restored = element.toggleAttribute('data-state', true);
      return [absent, added, initial, kept, value, removed, attribute.ownerElement, restored,
        element.getAttribute('data-state'), element.getAttributeNode('data-state') !== attribute];
    })).toEqual([false, true, '', true, 'retained', false, null, true, '', true]);
  });

  it('removes by name, namespace, or exact Attr and keeps detached values usable', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      element.setAttribute('plain', 'plain');
      element.setAttributeNS('urn:one', 'p:value', 'one');
      element.setAttributeNS('urn:two', 'p:value', 'two');
      const plain = element.getAttributeNode('plain')!;
      const first = element.getAttributeNodeNS('urn:one', 'value')!;
      const second = element.getAttributeNodeNS('urn:two', 'value')!;
      const removed = element.removeAttributeNode(first);
      element.removeAttributeNS('', 'plain');
      element.removeAttribute('p:value');
      element.removeAttribute('absent');
      element.removeAttributeNS('urn:missing', 'absent');
      first.value = 'detached';
      return [removed === first, first.value, first.ownerDocument === document,
        plain.ownerElement, first.ownerElement, second.ownerElement, element.hasAttributes()];
    })).toEqual([true, 'detached', true, null, null, null, false]);
  });

  it('rejects an in-use or unrelated Attr atomically and preserves same-object attachment', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const first = document.createElement('first');
      const second = document.createElement('second');
      first.setAttribute('name', 'first');
      second.setAttribute('name', 'second');
      const firstAttr = first.getAttributeNode('name')!;
      const secondAttr = second.getAttributeNode('name')!;
      const errors: string[] = [];
      for (const action of [
        () => second.setAttributeNode(firstAttr),
        () => second.attributes.setNamedItemNS(firstAttr),
        () => second.removeAttributeNode(firstAttr),
        () => first.removeAttributeNode(document.createAttribute('name')),
      ]) {
        try { action(); errors.push('no exception'); }
        catch (error) { errors.push(error instanceof DOMException ? error.name : 'foreign exception'); }
      }
      return [errors, first.setAttributeNodeNS(firstAttr) === firstAttr,
        first.getAttributeNode('name') === firstAttr, second.getAttributeNode('name') === secondAttr,
        firstAttr.ownerElement === first, secondAttr.ownerElement === second];
    })).toEqual([['InUseAttributeError', 'InUseAttributeError', 'NotFoundError', 'NotFoundError'], true, true, true, true, true]);
  });

  it('keeps a foreign Attr platform identity and realm when attaching it', () => {
    const source = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const attribute = source.document.createAttribute('name');
    const prototype: unknown = Object.getPrototypeOf(attribute);
    const element = target.document.createElement('main');
    element.setAttributeNode(attribute);

    expect({
      identity: element.getAttributeNode('name') === attribute,
      document: attribute.ownerDocument === target.document,
      element: attribute.ownerElement === element,
      prototype: Object.getPrototypeOf(attribute) === prototype,
      distinctRealms: Object.getPrototypeOf(attribute) !== Object.getPrototypeOf(target.document.createAttribute('name')),
    }).toEqual({ identity: true, document: true, element: true, prototype: true, distinctRealms: true });
  });

  it('applies Web IDL string and boolean conversion before the implementation receives values', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      const order: string[] = [];
      element.setAttribute(
        { toString() { order.push('name'); return 'TITLE'; } } as unknown as string,
        { toString() { order.push('value'); return 'text'; } } as unknown as string,
      );
      Reflect.set(element.getAttributeNode('title')!, 'value', null);
      const forced = element.toggleAttribute('empty', 0 as unknown as boolean);
      return [order, element.getAttribute('title'), forced, element.hasAttribute('empty')];
    })).toEqual([['name', 'value'], 'null', false, false]);
  });

  it('runs element change steps once per mutation, including same-value writes', () => {
    const document = createTestDocument();
    const element = document.createElement('main');
    const changed = vi.spyOn(element, 'attributeChanged');
    element.setAttribute('name', 'one');
    const attribute = element.getAttributeNode('name')!;
    attribute.value = 'one';
    const replacement = document.createAttribute('name');
    replacement.value = 'two';
    element.setAttributeNode(replacement);
    element.setAttributeNode(replacement);
    element.toggleAttribute('name', true);
    element.attributes.removeNamedItem('name');
    replacement.value = 'detached';

    expect(changed.mock.calls).toEqual([
      ['name', null, 'one', null],
      ['name', 'one', 'one', null],
      ['name', 'one', 'two', null],
      ['name', 'two', null, null],
    ]);
  });

  it('updates one retained inline style declaration through every attribute mutation entry point', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('div');
      const style = element.style;
      const colors: string[] = [];
      element.setAttribute('style', 'color: red');
      colors.push(style.getPropertyValue('color'));
      element.getAttributeNode('style')!.value = 'color: blue';
      colors.push(style.getPropertyValue('color'));
      element.setAttributeNS(null, 'style', 'color: green');
      colors.push(style.getPropertyValue('color'));
      const replacement = document.createAttribute('style');
      replacement.value = 'color: orange';
      element.setAttributeNodeNS(replacement);
      colors.push(style.getPropertyValue('color'));
      element.setAttributeNS('urn:other', 'style', 'color: purple');
      colors.push(style.getPropertyValue('color'));
      element.removeAttributeNS(null, 'style');
      colors.push(style.getPropertyValue('color'));
      replacement.value = 'color: pink';
      element.attributes.setNamedItem(replacement);
      colors.push(style.getPropertyValue('color'));
      element.removeAttributeNode(replacement);
      colors.push(style.getPropertyValue('color'));
      style.setProperty('color', 'red');
      return [colors, element.style === style, element.getAttributeNS(null, 'style')];
    })).toEqual([['red', 'blue', 'green', 'orange', 'orange', '', 'pink', ''], true, 'color: red;']);
  });

  it('ignores a namespaced style attribute when first creating inline style state', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('div');
      element.setAttributeNS('urn:other', 'style', 'color: purple');
      const style = element.style;
      const initial = style.getPropertyValue('color');
      style.setProperty('color', 'red');
      return [initial, element.getAttributeNS('urn:other', 'style'), element.getAttributeNS(null, 'style')];
    })).toEqual(['', 'color: purple', 'color: red;']);
  });
});
