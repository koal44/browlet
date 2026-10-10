import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('MutationRecord', () => {
  it('captures fragment insertion and removal with static, stable NodeLists', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const before = document.createTextNode('before');
      const after = document.createTextNode('after');
      parent.append(before, after);
      const fragment = document.createDocumentFragment();
      const a = document.createTextNode('a');
      const b = document.createTextNode('b');
      fragment.append(a, b);
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { childList: true });
      observer.observe(fragment, { childList: true });
      parent.insertBefore(fragment, after);
      const records = observer.takeRecords();
      a.remove();
      b.remove();
      const [removed, added] = records;
      return [
        records.length, removed!.target === fragment, added!.target === parent,
        removed!.type, Array.from(removed!.removedNodes, (node) => node.nodeValue),
        Array.from(added!.addedNodes, (node) => node.nodeValue),
        removed!.addedNodes.length, added!.removedNodes.length,
        removed!.previousSibling, removed!.nextSibling,
        added!.previousSibling === before, added!.nextSibling === after,
        added!.attributeName, added!.attributeNamespace, added!.oldValue,
        added!.addedNodes === added!.addedNodes, added!.addedNodes instanceof NodeList,
        added!.addedNodes[0] === a, Reflect.set(added!, 'type', 'changed'), added!.type,
      ];
    })).toEqual([
      2, true, true, 'childList', ['a', 'b'], ['a', 'b'], 0, 0,
      null, null, true, true, null, null, null, true, true, true, false, 'childList',
    ]);
  });

  it('reports replacement and replace-all as combined child-list records', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      parent.append('a', 'b', 'c');
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { childList: true });
      parent.replaceChild(document.createTextNode('replacement'), parent.childNodes[1]!);
      parent.replaceChildren('x', 'y');
      return observer.takeRecords().map((record) => [
        Array.from(record.addedNodes, (node) => node.nodeValue),
        Array.from(record.removedNodes, (node) => node.nodeValue),
        record.previousSibling?.nodeValue ?? null, record.nextSibling?.nodeValue ?? null,
      ]);
    })).toEqual([
      [['replacement'], ['b'], 'a', 'c'], [['x', 'y'], ['a', 'replacement', 'c'], null, null],
    ]);
  });

  it('keeps one record per observer and combines old-value requests across ancestor registrations', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const child = document.createElement('span');
      parent.append(child);
      child.setAttribute('id', 'old');
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { subtree: true, attributes: true, attributeOldValue: true });
      observer.observe(child, { attributes: true });
      child.setAttribute('id', 'new');
      const records = observer.takeRecords();
      return records.map((record) => [record.target === child, record.attributeName, record.oldValue]);
    })).toEqual([[true, 'id', 'old']]);
  });

  it('filters attribute local names exactly and excludes namespaced attributes when a filter exists', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const target = document.createElement('div');
      const filtered = new MutationObserver(() => {});
      const all = new MutationObserver(() => {});
      filtered.observe(target, { attributeFilter: ['data-x', 'UPPER'], attributeOldValue: true });
      all.observe(target, { attributes: true, attributeOldValue: true });
      target.setAttribute('data-x', 'one');
      target.setAttributeNS('urn:test', 'p:data-x', 'foreign');
      target.setAttribute('UPPER', 'lowered');
      target.getAttributeNode('data-x')!.value = 'two';
      target.removeAttribute('data-x');
      const summarize = (record: MutationRecord) => [
        record.type, record.attributeName, record.attributeNamespace, record.oldValue,
        record.addedNodes.length, record.removedNodes.length, record.previousSibling, record.nextSibling,
      ];
      return [filtered.takeRecords().map(summarize), all.takeRecords().map(summarize)];
    })).toEqual([
      [
        ['attributes', 'data-x', null, null, 0, 0, null, null],
        ['attributes', 'data-x', null, 'one', 0, 0, null, null],
        ['attributes', 'data-x', null, 'two', 0, 0, null, null],
      ],
      [
        ['attributes', 'data-x', null, null, 0, 0, null, null],
        ['attributes', 'data-x', 'urn:test', null, 0, 0, null, null],
        ['attributes', 'upper', null, null, 0, 0, null, null],
        ['attributes', 'data-x', null, 'one', 0, 0, null, null],
        ['attributes', 'data-x', null, 'two', 0, 0, null, null],
      ],
    ]);
  });

  it('records equal-value writes and character-data replacement, splitting, and normalization', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const text = document.createTextNode('abcd');
      parent.append(text);
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { subtree: true, characterData: true, characterDataOldValue: true, childList: true });
      text.data = 'abcd';
      text.replaceData(1, 2, 'X');
      text.splitText(1);
      parent.normalize();
      return observer.takeRecords().map((record) => [
        record.type, record.oldValue,
        record.addedNodes.length, record.removedNodes.length, record.attributeName, record.attributeNamespace,
      ]);
    })).toEqual([
      ['characterData', 'abcd', 0, 0, null, null],
      ['characterData', 'abcd', 0, 0, null, null],
      ['childList', null, 1, 0, null, null],
      ['characterData', 'aXd', 0, 0, null, null],
      ['characterData', 'a', 0, 0, null, null],
      ['childList', null, 0, 1, null, null],
    ]);
  });

  it('gives different observers independent records with their own old-value selection', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const target = document.createElement('div');
      target.setAttribute('id', 'old');
      const first = new MutationObserver(() => {});
      const second = new MutationObserver(() => {});
      first.observe(target, { attributeOldValue: true });
      second.observe(target, { attributes: true });
      target.setAttribute('id', 'new');
      const a = first.takeRecords()[0]!;
      const b = second.takeRecords()[0]!;
      return [a !== b, a.oldValue, b.oldValue, a.target === b.target, a.addedNodes !== b.addedNodes];
    })).toEqual([true, 'old', null, true, true]);
  });
});
