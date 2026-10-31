import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

describe('HTML §12.4: Web Storage origin isolation', () => {
  it.each(['http://example.test/', 'https://other.test/', 'https://example.test:8443/'])(
    'prevents reads and overwrites across the origin boundary at %s', async (otherURL) => {
      const browser = new Browlet({ route: () => '' });
      await browser.navigate('https://example.test/');
      await browser.evaluate(writeBoth, 'original');

      await browser.navigate(otherURL);
      expect(await browser.evaluate(readBoth)).toEqual([null, null]);
      await browser.evaluate(writeBoth, 'other origin');

      await browser.navigate('https://example.test/return');
      expect(await browser.evaluate(readBoth)).toEqual(['original', 'original']);
      await browser.navigate(otherURL);
      expect(await browser.evaluate(readBoth)).toEqual(['other origin', 'other origin']);
    },
  );

  it('shares data across directories, query strings, fragments, and an explicit default port', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/alice/');
    await browser.evaluate(writeBoth, 'alice');
    await browser.navigate('https://example.test:443/bob/?different=query#fragment');
    expect(await browser.evaluate(readBoth)).toEqual(['alice', 'alice']);
    await browser.evaluate(writeBoth, 'bob');
    await browser.navigate('https://example.test/alice/return');
    expect(await browser.evaluate(readBoth)).toEqual(['bob', 'bob']);
  });

  it('does not merge storage when document.domain relaxes different hosts and ports', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://a.example.test:8000/');
    expect(await browser.evaluate(relaxDomain)).toBe('example.test');
    await browser.evaluate(writeBoth, 'first origin');

    await browser.navigate('https://b.example.test:9000/');
    expect(await browser.evaluate(relaxDomain)).toBe('example.test');
    expect(await browser.evaluate(readBoth)).toEqual([null, null]);
    await browser.evaluate(writeBoth, 'second origin');

    // Domain relaxation must not change the key used by a later unrelaxed Document.
    await browser.navigate('https://a.example.test:8000/return');
    expect(await browser.evaluate(readBoth)).toEqual(['first origin', 'first origin']);
    expect(await browser.evaluate(relaxDomain)).toBe('example.test');
    expect(await browser.evaluate(readBoth)).toEqual(['first origin', 'first origin']);
  });
});

function writeBoth(value: string): void {
  localStorage.setItem('saved', value);
  sessionStorage.setItem('saved', value);
}

function readBoth(): (string | null)[] {
  return [localStorage.getItem('saved'), sessionStorage.getItem('saved')];
}

function relaxDomain(): string {
  document.domain = 'example.test';
  return document.domain;
}
