import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../../src/browlet/browlet';

describe.each(['link', 'script'] as const)('%s.crossOrigin', (localName) => {
  it('reflects CORS states without changing the raw attribute or trimming it', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      return [null, '', 'anonymous', 'AnOnYmOuS', 'use-credentials', 'USE-CREDENTIALS',
        'invalid', ' use-credentials ', 'use-credentialſ'].map((value) => {
        if (value === null) element.removeAttribute('crossorigin');
        else element.setAttribute('crossorigin', value);
        return [element.crossOrigin, element.getAttribute('crossorigin')];
      });
    }, localName)).toEqual([
      [null, null], ['anonymous', ''], ['anonymous', 'anonymous'],
      ['anonymous', 'AnOnYmOuS'], ['use-credentials', 'use-credentials'],
      ['use-credentials', 'USE-CREDENTIALS'], ['anonymous', 'invalid'],
      ['anonymous', ' use-credentials '], ['anonymous', 'use-credentialſ'],
    ]);
  });

  it('converts assignments through Web IDL and removes the attribute for null or undefined', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      let conversions = 0;
      const values = ['USE-CREDENTIALS', null, 42, undefined, {
        toString() { conversions++; return 'anonymous'; },
      }];
      const results = values.map((value) => {
        Reflect.set(element, 'crossOrigin', value);
        return [element.crossOrigin, element.getAttribute('crossorigin')];
      });
      return { results, conversions };
    }, localName)).toEqual({
      results: [
        ['use-credentials', 'USE-CREDENTIALS'], [null, null], ['anonymous', '42'],
        [null, null], ['anonymous', 'anonymous'],
      ],
      conversions: 1,
    });
  });

  it('uses the DOM mutation path for creation, equal-value writes, and removal', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      element.crossOrigin = 'ANONYMOUS';
      element.crossOrigin = 'ANONYMOUS';
      element.crossOrigin = null;
      element.crossOrigin = null;
      return observer.takeRecords().map((record) => [
        record.type, record.target === element, record.attributeName,
        record.attributeNamespace, record.oldValue,
      ]);
    }, localName)).toEqual([
      ['attributes', true, 'crossorigin', null, null],
      ['attributes', true, 'crossorigin', null, 'ANONYMOUS'],
      ['attributes', true, 'crossorigin', null, 'ANONYMOUS'],
    ]);
  });

  it('ignores namespaced attributes and follows attached Attr changes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      element.setAttributeNS('urn:other', 'x:crossorigin', 'use-credentials');
      const absent = element.crossOrigin;
      element.crossOrigin = 'anonymous';
      element.getAttributeNodeNS(null, 'crossorigin')!.value = 'USE-CREDENTIALS';
      const updated = element.crossOrigin;
      element.crossOrigin = null;
      return [absent, updated, element.crossOrigin,
        element.getAttributeNS('urn:other', 'crossorigin')];
    }, localName)).toEqual([null, 'use-credentials', null, 'use-credentials']);
  });
});
