import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../../src/browlet/browlet';

describe.each(['img', 'link', 'script'] as const)('%s.fetchPriority', (localName) => {
  it('reflects canonical keywords and defaults without changing the attribute text', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      return [null, '', 'high', 'LOW', 'HiGh', 'AuTo', 'invalid',
        ' high ', '\tlow', 'high low', 'hıgh'].map((value) => {
        if (value === null) element.removeAttribute('fetchpriority');
        else element.setAttribute('fetchpriority', value);
        return [element.fetchPriority, element.getAttribute('fetchpriority')];
      });
    }, localName)).toEqual([
      ['auto', null], ['auto', ''], ['high', 'high'], ['low', 'LOW'],
      ['high', 'HiGh'], ['auto', 'AuTo'], ['auto', 'invalid'], ['auto', ' high '],
      ['auto', '\tlow'], ['auto', 'high low'], ['auto', 'hıgh'],
    ]);
  });

  it('converts assignments to DOMString and preserves invalid spellings', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      let conversions = 0;
      const results = ['HIGH', '', null, undefined, {
        toString() { conversions++; return 'low'; },
      }].map((value) => {
        Reflect.set(element, 'fetchPriority', value);
        return [element.fetchPriority, element.getAttribute('fetchpriority')];
      });
      return { results, conversions };
    }, localName)).toEqual({
      results: [
        ['high', 'HIGH'], ['auto', ''], ['auto', 'null'],
        ['auto', 'undefined'], ['low', 'low'],
      ],
      conversions: 1,
    });
  });

  it('uses DOM mutation for creation, equal writes, and removal', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      // lib.dom narrows this property to known keywords, but the DOMString setter accepts any string.
      Reflect.set(element, 'fetchPriority', '');
      Reflect.set(element, 'fetchPriority', 'HIGH');
      Reflect.set(element, 'fetchPriority', 'HIGH');
      element.removeAttribute('fetchpriority');
      return observer.takeRecords().map((record) => [
        record.target === element, record.attributeName, record.attributeNamespace, record.oldValue,
      ]);
    }, localName)).toEqual([
      [true, 'fetchpriority', null, null], [true, 'fetchpriority', null, ''],
      [true, 'fetchpriority', null, 'HIGH'], [true, 'fetchpriority', null, 'HIGH'],
    ]);
  });

  it('ignores namespaced lookalikes and follows attached Attr changes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      element.setAttributeNS('urn:other', 'x:fetchpriority', 'high');
      const absent = element.fetchPriority;
      element.fetchPriority = 'low';
      element.getAttributeNodeNS(null, 'fetchpriority')!.value = 'HIGH';
      const updated = element.fetchPriority;
      element.removeAttribute('fetchpriority');
      return [absent, updated, element.fetchPriority, element.getAttributeNS('urn:other', 'fetchpriority')];
    }, localName)).toEqual(['auto', 'high', 'auto', 'high']);
  });

  it('preserves reflection through cloning, import, and adoption', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      Reflect.set(element, 'fetchPriority', 'LOW');
      const other = document.implementation.createHTMLDocument();
      const clone = element.cloneNode() as typeof element;
      const imported = other.importNode(element);
      const adopted = other.adoptNode(element);
      clone.fetchPriority = 'high';
      return [clone, imported, adopted].map((node) => [node.fetchPriority, node.getAttribute('fetchpriority')]);
    }, localName)).toEqual([['high', 'high'], ['low', 'LOW'], ['low', 'LOW']]);
  });
});

it('reflects fetch-priority attributes created by the HTML parser', async () => {
  const browser = new Browlet({
    route: () => '<link fetchpriority="LOW"><script fetchpriority="HIGH"></script><img fetchpriority="invalid">',
  });
  await browser.navigate('https://priority.test/');
  expect(await browser.evaluate(() => {
    const elements = [document.querySelector('link')!, document.querySelector('script')!, document.querySelector('img')!];
    return elements.map((element) => [element.fetchPriority, element.getAttribute('fetchpriority')]);
  })).toEqual([['low', 'LOW'], ['high', 'HIGH'], ['auto', 'invalid']]);
});
