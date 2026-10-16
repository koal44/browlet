import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { HTMLCollectionImpl, NodeListImpl } from '../../../../src/browlet/dom/nodes/collections';
import { createTestDocument } from '../../../support/dom';

describe('DOM collections', () => {
  it('refreshes owner-supplied membership and filtered lists through mutations and adoption', () => {
    const document = createTestDocument();
    const owner = document.createElement('form');
    const first = document.createElementNS(HTML_NAMESPACE, 'input');
    const second = document.createElementNS(HTML_NAMESPACE, 'input');
    owner.appendChild(first);
    owner.appendChild(second);
    first.setAttribute('name', 'group');
    second.setAttribute('name', 'group');
    let collections = 0;
    const elements = new HTMLCollectionImpl({
      root: owner,
      collect() {
        collections++;
        return [...owner.children];
      },
    });
    const named = new NodeListImpl({
      root: owner,
      collect: () => [...elements].filter((element) => element.getAttributeNS(null, 'name') === 'group'),
    });
    expect(Array.from(named)).toEqual([first, second]);
    expect(elements.length).toBe(2);
    expect(collections).toBe(1);

    second.setAttribute('name', 'other');
    expect(Array.from(named)).toEqual([first]);
    expect(elements.namedItem('other')).toBe(second);
    expect(collections).toBe(2);

    const otherDocument = createTestDocument();
    otherDocument.adoptNode(owner);
    first.remove();
    expect(elements.item(0)).toBe(second);
    expect(named.length).toBe(0);
    second.setAttribute('name', 'group');
    expect(named.item(0)).toBe(second);
  });

  it('exposes stable live child lists with Web IDL indices and realm prototypes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const nodes = parent.childNodes;
      const elements = parent.children;
      const text = document.createTextNode('text');
      const first = document.createElement('span');
      const second = document.createElement('b');
      parent.append(text, first, second);
      const initial = [nodes.length, elements.length, nodes[0] === text, elements[0] === first];
      first.remove();
      const removed = [nodes.length, elements.length, nodes[1] === second, elements[0] === second];
      const indexed = Object.getOwnPropertyDescriptor(nodes, '1')!;
      return [
        nodes === parent.childNodes, elements === parent.children,
        nodes instanceof NodeList, elements instanceof HTMLCollection,
        Array.isArray(nodes), Array.isArray(elements), initial, removed,
        nodes.item(2), nodes[2], indexed.value === second, indexed.writable, indexed.enumerable,
        Reflect.set(nodes, '0', second), Reflect.deleteProperty(nodes, '0'),
        Object.keys(nodes), Object.keys(elements), nodes.item(2 ** 32) === text,
      ];
    })).toEqual([
      true, true, true, true, false, false, [3, 2, true, true], [2, 1, true, true],
      null, undefined, true, false, true, false, false, ['0', '1'], ['0'], true,
    ]);
  });

  it('uses live iteration and Array forEach semantics on NodeList', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      parent.append('a', 'b');
      const nodes = parent.childNodes;
      const iterator = nodes.values();
      const first = iterator.next().value!.textContent;
      parent.append('c');
      const rest = Array.from(iterator, (node) => node.textContent);
      const seen: unknown[] = [];
      const receiver = {};
      nodes.forEach(function(this: object, node, index, list) {
        seen.push([node.textContent, index, list === nodes, this === receiver]);
        if (index === 0) parent.append('d');
      }, receiver);
      return [first, rest, seen, Array.from(nodes.keys()),
        Array.from(nodes.entries(), ([i, node]) => [i, node.textContent]),
        nodes[Symbol.iterator] === nodes.values];
    })).toEqual([
      'a', ['b', 'c'], [['a', 0, true, true], ['b', 1, true, true], ['c', 2, true, true]],
      [0, 1, 2, 3], [[0, 'a'], [1, 'b'], [2, 'c'], [3, 'd']], true,
    ]);
  });

  it('keeps HTML names live, nonenumerable, and behind prototype properties', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const first = document.createElement('div');
      const second = document.createElement('span');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      first.setAttribute('name', 'shared');
      second.setAttribute('id', 'shared');
      second.setAttribute('name', 'length');
      svg.setAttribute('name', 'foreign');
      parent.append(first, second, svg);
      const list = parent.children;
      const original = [list.namedItem('shared') === first, Reflect.get(list, 'shared') === first,
        list.length, list.namedItem('length') === second, list.namedItem('foreign'),
        Object.getOwnPropertyDescriptor(list, 'shared')!.enumerable, Object.keys(list)];
      first.removeAttribute('name');
      const renamed = list.namedItem('shared') === second;
      second.setAttribute('id', 'changed');
      return [original, renamed, Reflect.has(list, 'shared'), Reflect.get(list, 'changed') === second,
        list.namedItem(''), Array.from(list).length];
    })).toEqual([[true, true, 3, true, null, false, ['0', '1', '2']], true, false, true, null, 3]);
  });

  it('refreshes a retained detached collection after adoption and attribute edits', () => {
    const first = createTestDocument();
    const second = createTestDocument();
    const root = first.createElement('div');
    const child = first.createElement('span');
    root.appendChild(child);
    const list = root.getElementsByClassName('match');
    expect(list.length).toBe(0);
    second.adoptNode(root);
    child.setAttribute('class', 'match');
    expect(list.item(0)).toBe(child);
    child.getAttributeNode('class')!.value = 'other';
    expect(list.length).toBe(0);
    child.setAttribute('class', 'match');
    root.removeChild(child);
    expect(list.length).toBe(0);
  });

  it('uses only null-namespace id, name, and class attributes for collection matching', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const fragment = document.createDocumentFragment();
      const element = document.createElement('span');
      element.setAttributeNS('urn:test', 'id', 'foreign-id');
      element.setAttributeNS('urn:test', 'name', 'foreign-name');
      element.setAttributeNS('urn:test', 'class', 'foreign-class');
      fragment.append(element);
      const parent = document.createElement('div');
      const id = fragment.getElementById('foreign-id');
      parent.append(fragment);
      return [id === null, parent.children.namedItem('foreign-id') === null,
        parent.children.namedItem('foreign-name') === null,
        parent.getElementsByClassName('foreign-class').length,
        Reflect.has(parent.children, 'foreign-id'), Reflect.has(parent.children, 'foreign-name')];
    })).toEqual([true, true, true, 0, false, false]);
  });

  it('keeps existing child lists live through normalization and fragment splicing', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const fragment = document.createDocumentFragment();
      fragment.append('a', 'b', document.createElement('span'));
      const fragmentNodes = fragment.childNodes;
      const parent = document.createElement('div');
      const nodes = parent.childNodes;
      parent.append(fragment);
      parent.normalize();
      return [fragmentNodes.length, nodes.length, nodes[0]!.textContent, parent.children.length];
    })).toEqual([0, 2, 'ab', 1]);
  });
});
