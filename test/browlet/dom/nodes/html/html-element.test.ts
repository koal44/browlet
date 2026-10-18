import { assert, describe, expect, it } from 'vitest';
import { Browlet } from '../../../../../src/browlet/browlet';

describe('shared HTML element attributes', () => {
  it('reflects strings on specialized, generic, and unknown HTML elements', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => ['div', 'article', 'unknown'].map((name) => {
      const element = document.createElement(name);
      const initial = [element.title, element.lang, element.accessKey];
      element.title = '  a title\n';
      element.lang = 'EN-us';
      element.accessKey = 'x y';
      const written = ['title', 'lang', 'accesskey'].map((attribute) => element.getAttribute(attribute));
      element.setAttribute('title', 'changed');
      element.removeAttribute('lang');
      element.setAttributeNS('urn:other', 'x:lang', 'fr');
      return [initial, written, element.title, element.lang, element.accessKey];
    }))).toEqual(Array.from({ length: 3 }, () => [
      ['', '', ''], ['  a title\n', 'EN-us', 'x y'], 'changed', '', 'x y',
    ]));
  });

  it('reflects inert and headingReset by attribute presence', () => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.window.document.createElement('h2');
    assert(element instanceof browser.window.HTMLElement);
    expect([element.inert, element.headingReset]).toEqual([false, false]);
    element.inert = true;
    element.headingReset = true;
    expect([element.getAttribute('inert'), element.getAttribute('headingreset')]).toEqual(['', '']);
    element.setAttribute('inert', 'false');
    element.setAttribute('headingreset', 'false');
    expect([element.inert, element.headingReset]).toEqual([true, true]);
    element.inert = false;
    element.headingReset = false;
    expect([element.hasAttribute('inert'), element.hasAttribute('headingreset')]).toEqual([false, false]);
  });

  it('limits headingOffset reads to 0 through 8 without clamping the stored attribute', () => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.window.document.createElement('section');
    assert(element instanceof browser.window.HTMLElement);
    expect(element.headingOffset).toBe(0);
    const reads = ['', 'bad', '-1', '0', '4tail', '8', '9', '999999999999999999999'].map((value) => {
      element.setAttribute('headingoffset', value);
      return [element.headingOffset, element.getAttribute('headingoffset')];
    });
    expect(reads).toEqual([
      [0, ''], [0, 'bad'], [0, '-1'], [0, '0'], [4, '4tail'], [8, '8'], [8, '9'],
      [8, '999999999999999999999'],
    ]);
    element.headingOffset = 20;
    expect([element.headingOffset, element.getAttribute('headingoffset')]).toEqual([8, '20']);
    element.removeAttribute('headingoffset');
    expect(element.headingOffset).toBe(0);
  });

  it('shares autofocus reflection across HTML, SVG, and MathML, but not foreign elements', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const elements = [
        document.createElement('input'),
        document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
        document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math'),
      ];
      const states = elements.map((element) => {
        const initial = Reflect.get(element, 'autofocus');
        Reflect.set(element, 'autofocus', true);
        const written = element.getAttribute('autofocus');
        element.setAttribute('autofocus', 'false');
        const present = Reflect.get(element, 'autofocus');
        Reflect.set(element, 'autofocus', false);
        return [initial, written, present, element.hasAttribute('autofocus')];
      });
      return [states, 'autofocus' in document.createElementNS('urn:other', 'example')];
    })).toEqual([Array.from({ length: 3 }, () => [false, '', true, false]), false]);
  });
});
