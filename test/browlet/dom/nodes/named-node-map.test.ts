import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('NamedNodeMap', () => {
  it('reflects insertion, replacement, and removal through live indices and names', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      const map = element.attributes;
      element.setAttribute('first', 'one');
      element.setAttribute('second', 'two');
      const first = map[0]!;
      const second = map[1]!;
      const replacement = document.createAttribute('first');
      replacement.value = 'replacement';
      const previous = map.setNamedItem(replacement);
      const afterReplacement = [map.length, map[0] === replacement, map[1] === second,
        Reflect.get(map, 'first') === replacement, previous === first, first.ownerElement];
      map.removeNamedItem('FIRST');
      return [afterReplacement, map.length, map[0] === second, map[1], map.item(1),
        Reflect.has(map, 'first'), Reflect.has(map, '1'), Object.keys(map),
        Object.getOwnPropertyNames(map), map === element.attributes];
    })).toEqual([[2, true, true, true, true, null], 1, true, undefined, null, false, false,
      ['0'], ['0', 'second'], true]);
  });

  it('deduplicates supported names without deduplicating namespaced attributes', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      element.setAttributeNS('urn:one', 'p:name', 'one');
      element.setAttributeNS('urn:two', 'p:name', 'two');
      const map = element.attributes;
      const first = map[0]!;
      const second = map[1]!;
      const before = [element.getAttributeNames(), Object.getOwnPropertyNames(map), Reflect.get(map, 'p:name') === first];
      map.removeNamedItemNS('urn:one', 'name');
      return [before, map.getNamedItem('p:name') === second, Reflect.get(map, 'p:name') === second,
        map.getNamedItemNS('urn:two', 'name') === second, map.length];
    })).toEqual([[['p:name', 'p:name'], ['0', '1', 'p:name'], true], true, true, true, 1]);
  });

  it('hides uppercase names only for HTML elements in HTML documents', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const xml = new Document();
      const htmlElement = document.createElement('main');
      const xmlElement = xml.createElementNS('http://www.w3.org/1999/xhtml', 'main');
      const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      return [htmlElement, xmlElement, svgElement].map((element) => {
        element.setAttributeNS(null, 'UPPER', 'value');
        const map = element.attributes;
        return [map.getNamedItem('UPPER') === map[0], map.getNamedItemNS(null, 'UPPER') === map[0],
          Reflect.has(map, 'UPPER'), Object.getOwnPropertyNames(map)];
      });
    })).toEqual([[false, true, false, ['0']], [true, true, true, ['0', 'UPPER']], [true, true, true, ['0', 'UPPER']]]);
  });

  it('keeps prototype and indexed properties ahead of colliding attribute names', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      element.setAttribute('item', 'method name');
      element.setAttribute('length', 'length name');
      element.setAttribute('0', 'index name');
      const map = element.attributes;
      return [typeof map.item, map.length, map[0]!.name, map.getNamedItem('0') === map[2],
        map.getNamedItem('item') === map[0], Object.keys(map), Object.hasOwn(map, 'length'),
        Reflect.get(map, 'push') === undefined, map.item(-1), map.item(2 ** 32) === map[0]];
    })).toEqual(['function', 3, 'item', true, true, ['0', '1', '2'], false, true, null, true]);
  });

  it('throws NotFoundError for missing removals without changing the map', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      element.setAttribute('kept', 'value');
      const map = element.attributes;
      const errors: string[] = [];
      for (const action of [() => map.removeNamedItem('missing'), () => map.removeNamedItemNS(null, 'missing')]) {
        try { action(); errors.push('no exception'); }
        catch (error) { errors.push(error instanceof DOMException ? error.name : 'foreign exception'); }
      }
      return [errors, map.length, map[0]!.value];
    })).toEqual([['NotFoundError', 'NotFoundError'], 1, 'value']);
  });

  it('does not expose raw storage mutation to authors', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const element = document.createElement('main');
      element.setAttribute('name', 'value');
      const map = element.attributes;
      const attribute = map[0]!;
      return [Array.isArray(map), Reflect.set(map, '0', null), Reflect.deleteProperty(map, '0'),
        Reflect.set(map, 'length', 0), map[0] === attribute, map.length,
        Reflect.get(map, 'associateElement') === undefined, Reflect.get(element, 'attributeList') === undefined];
    })).toEqual([false, false, false, false, true, 1, true, true]);
  });
});
