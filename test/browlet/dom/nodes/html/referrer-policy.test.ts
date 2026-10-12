import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../../src/browlet/browlet';

describe.each(['link', 'script'] as const)('%s.referrerPolicy', (localName) => {
  it('reflects one canonical keyword without changing or trimming the content attribute', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      return [null, '', 'origin', 'ORIGIN', 'strict-origin-when-cross-origin',
        'invalid', ' origin ', 'origin, no-referrer', 'always', 'ſame-origin'].map((value) => {
        if (value === null) element.removeAttribute('referrerpolicy');
        else element.setAttribute('referrerpolicy', value);
        return [element.referrerPolicy, element.getAttribute('referrerpolicy')];
      });
    }, localName)).toEqual([
      ['', null], ['', ''], ['origin', 'origin'], ['origin', 'ORIGIN'],
      ['strict-origin-when-cross-origin', 'strict-origin-when-cross-origin'],
      ['', 'invalid'], ['', ' origin '], ['', 'origin, no-referrer'],
      ['', 'always'], ['', 'ſame-origin'],
    ]);
  });

  it('uses DOMString conversion and retains empty, null, and undefined assignments as attributes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      let conversions = 0;
      const results = ['NO-REFERRER', '', null, undefined, {
        toString() { conversions++; return 'unsafe-url'; },
      }].map((value) => {
        Reflect.set(element, 'referrerPolicy', value);
        return [element.referrerPolicy, element.getAttribute('referrerpolicy')];
      });
      return { results, conversions };
    }, localName)).toEqual({
      results: [
        ['no-referrer', 'NO-REFERRER'], ['', ''], ['', 'null'],
        ['', 'undefined'], ['unsafe-url', 'unsafe-url'],
      ],
      conversions: 1,
    });
  });

  it('uses DOM mutation delivery for empty creation, equal writes, and removal', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      element.referrerPolicy = '';
      element.referrerPolicy = 'ORIGIN';
      element.referrerPolicy = 'ORIGIN';
      element.removeAttribute('referrerpolicy');
      return observer.takeRecords().map((record) => [
        record.type, record.target === element, record.attributeName,
        record.attributeNamespace, record.oldValue,
      ]);
    }, localName)).toEqual([
      ['attributes', true, 'referrerpolicy', null, null],
      ['attributes', true, 'referrerpolicy', null, ''],
      ['attributes', true, 'referrerpolicy', null, 'ORIGIN'],
      ['attributes', true, 'referrerpolicy', null, 'ORIGIN'],
    ]);
  });

  it('ignores namespaced lookalikes and follows attached Attr changes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      element.setAttributeNS('urn:other', 'x:referrerpolicy', 'no-referrer');
      const absent = element.referrerPolicy;
      element.referrerPolicy = 'origin';
      element.getAttributeNodeNS(null, 'referrerpolicy')!.value = 'SAME-ORIGIN';
      const updated = element.referrerPolicy;
      element.removeAttribute('referrerpolicy');
      return [absent, updated, element.referrerPolicy,
        element.getAttributeNS('urn:other', 'referrerpolicy')];
    }, localName)).toEqual(['', 'same-origin', '', 'no-referrer']);
  });
});
