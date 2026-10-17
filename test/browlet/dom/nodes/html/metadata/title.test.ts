import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../../../src/browlet/browlet';

describe('HTMLTitleElement', () => {
  it('preserves its interface through parsing, creation, and cloning', async () => {
    const browser = new Browlet({ route: () => '<!doctype html><title>Parsed title</title>' });
    await browser.navigate('https://example.test/');

    expect(await browser.evaluate(() => {
      const title = document.querySelector('title')!;
      return [title instanceof HTMLTitleElement, title instanceof HTMLElement,
        title.cloneNode(true) instanceof HTMLTitleElement,
        document.createElement('title') instanceof HTMLTitleElement,
        document.createElementNS('urn:other', 'title') instanceof HTMLTitleElement];
    })).toEqual([true, true, true, true, false]);
  });

  it('exposes raw child text and replaces children through DOMString conversion', async () => {
    const browser = new Browlet({ route: () => '' });

    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const title = doc.createElement('title');
      const nested = doc.createElement('span');
      nested.textContent = 'ignored';
      title.append('\t first\n', nested, ' second ');
      doc.head.appendChild(title);
      const initial = [title.text, doc.title];
      title.text = '  replacement\n title ';
      const replaced = [title.text, doc.title, title.childNodes.length, nested.parentNode === null];
      Reflect.set(title, 'text', null);
      const converted = [title.text, doc.title];
      title.text = '';
      return { initial, replaced, converted, empty: [title.firstChild === null, doc.title] };
    })).toEqual({
      initial: ['\t first\n second ', 'first second'],
      replaced: ['  replacement\n title ', 'replacement title', 1, true],
      converted: ['null', 'null'],
      empty: [true, ''],
    });
  });
});
