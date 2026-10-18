import { describe, expect, it } from 'vitest';

import { HTML_NAMESPACE } from '../../../../../src/infra/index';
import { Browlet } from '../../../../../src/browlet/browlet';
import { getBlockingTokens } from '../../../../../src/browlet/dom/nodes/html/attributes/blocking';
import { HTMLScriptElementImpl } from '../../../../../src/browlet/dom/nodes/html/scripting/script';
import { createTestDocument, parseTestDocument } from '../../../../support/dom';

describe.each(['link', 'style', 'script'] as const)('%s.blocking', (tag) => {
  it('retains one live token list without creating an absent attribute', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const list = element.blocking;
      return [list === element.blocking, list instanceof DOMTokenList, list.length,
        list.value, String(list), list.item(0), element.hasAttribute('blocking')];
    }, tag)).toEqual([true, true, 0, '', '', null, false]);
  });

  it('supports render without treating case or unknown tokens as author-list normalization', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      element.setAttribute('blocking', ' RENDER render unknown render\t');
      const list = element.blocking;
      return {
        supported: ['render', 'RENDER', 'Render', '', 'future', ' render', 'render\t', 'render\u00a0']
          .map((token) => list.supports(token)),
        tokens: Array.from(list),
        value: list.value,
        contains: ['RENDER', 'render', 'Render', 'unknown'].map((token) => list.contains(token)),
      };
    }, tag)).toEqual({
      supported: [true, true, true, false, false, false, false, false],
      tokens: ['RENDER', 'render', 'unknown'],
      value: ' RENDER render unknown render\t',
      contains: [true, true, false, true],
    });
  });

  it('forwards assignment to value, including DOMString conversion and mutation records', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const list = element.blocking;
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      let conversions = 0;
      Reflect.set(element, 'blocking', { toString() { conversions++; return 'RENDER other'; } });
      Reflect.set(element, 'blocking', null);
      Reflect.set(element, 'blocking', undefined);
      return [element.blocking === list, conversions, list.value, Array.from(list),
        observer.takeRecords().map((record) => [record.attributeName, record.attributeNamespace, record.oldValue])];
    }, tag)).toEqual([true, 1, 'undefined', ['undefined'], [
      ['blocking', null, null], ['blocking', null, 'RENDER other'], ['blocking', null, 'null'],
    ]]);
  });

  it('tracks ordinary attribute writes, attached Attr updates, replacement, and removal', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const list = element.blocking;
      const seen: string[][] = [];
      element.setAttribute('blocking', 'one one'); seen.push(Array.from(list));
      element.getAttributeNode('blocking')!.value = 'RENDER'; seen.push(Array.from(list));
      const replacement = document.createAttribute('blocking');
      replacement.value = 'render unknown';
      element.setAttributeNode(replacement); seen.push(Array.from(list));
      element.setAttributeNS('urn:other', 'x:blocking', 'other'); seen.push(Array.from(list));
      element.removeAttribute('blocking'); seen.push(Array.from(list));
      return [seen, element.getAttributeNS('urn:other', 'blocking')];
    }, tag)).toEqual([[['one'], ['RENDER'], ['render', 'unknown'], ['render', 'unknown'], []], 'other']);
  });

  it('uses normal token mutation without restricting storage to supported tokens', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const list = element.blocking;
      list.add();
      const absent = element.getAttribute('blocking');
      list.add('render', 'unknown', 'render');
      list.replace('render', 'RENDER');
      list.remove('unknown');
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      list.value = 'RENDER';
      list.value = 'RENDER';
      const records = observer.takeRecords().map((record) => record.oldValue);
      list.remove('RENDER');
      return [absent, records, element.getAttribute('blocking'), list.length];
    }, tag)).toEqual([null, ['RENDER', 'RENDER'], '', 0]);
  });

  it('keeps adopted lists live and gives clones and imports their own list', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((tag) => {
      const element = document.createElement(tag);
      const list = element.blocking;
      list.add('render');
      const other = document.implementation.createHTMLDocument();
      other.adoptNode(element);
      const clone = element.cloneNode(false) as typeof element;
      const imported = document.importNode(element, false);
      clone.blocking.add('clone');
      imported.blocking.add('imported');
      element.setAttribute('blocking', 'original');
      return [element.blocking === list, clone.blocking !== list, imported.blocking !== list,
        clone.blocking !== imported.blocking, list.value, clone.blocking.value, imported.blocking.value];
    }, tag)).toEqual([true, true, true, true, 'original', 'render clone', 'render imported']);
  });

  it('interprets only supported tokens after ASCII folding and ASCII whitespace splitting', () => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, tag);
    const values = [null, '', 'render', 'RENDER', 'Render unknown RENDER',
      '\trender\n\f\r ', 'prerender', 'render\v', 'render\u00a0', 'ｒｅｎｄｅｒ'];
    expect(values.map((value) => {
      if (value === null) element.removeAttribute('blocking');
      else element.setAttribute('blocking', value);
      return [[...getBlockingTokens(element)], element.isPotentiallyRenderBlocking(), element.getAttribute('blocking')];
    })).toEqual(values.map((value, index) => [index >= 2 && index <= 5 ? ['render'] : [],
      index >= 2 && index <= 5, value]));
    element.removeAttribute('blocking');
    element.setAttributeNS('urn:other', 'x:blocking', 'render');
    expect(element.isPotentiallyRenderBlocking()).toBe(false);
  });
});

describe('Potential render blocking', () => {
  it('does not interpret arbitrary elements or foreign namespaces as blocking attributes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => [document.createElement('div'),
      document.createElement('img'), document.createElementNS('urn:other', 'script')].map((element) => {
      element.setAttribute('blocking', 'render');
      return 'blocking' in element;
    }))).toEqual([false, false, false]);
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, 'div');
    element.setAttribute('blocking', 'render');
    expect(element.isPotentiallyRenderBlocking()).toBe(false);
  });

  it('retains parser origin for styles and stylesheet links, independently of parser completion', () => {
    const document = parseTestDocument('<style></style><link rel="alternate STYLESHEET"><link rel="preload">');
    const style = document.getElementsByTagName('style').item(0)!;
    const sheet = document.getElementsByTagName('link').item(0)!;
    const preload = document.getElementsByTagName('link').item(1)!;
    expect([style, sheet, preload].map((element) => element.isPotentiallyRenderBlocking())).toEqual([true, true, false]);
    sheet.setAttribute('rel', 'stylesheetish');
    expect(sheet.isPotentiallyRenderBlocking()).toBe(false);
    sheet.setAttribute('rel', 'stylesheet');
    expect(sheet.isPotentiallyRenderBlocking()).toBe(true);
    preload.setAttribute('blocking', 'render');
    expect(preload.isPotentiallyRenderBlocking()).toBe(true);
    for (const element of [style, sheet]) {
      element.remove();
      expect(element.isPotentiallyRenderBlocking()).toBe(true);
      const other = createTestDocument();
      other.adoptNode(element);
      expect(element.isPotentiallyRenderBlocking()).toBe(false);
      document.adoptNode(element);
      expect(element.isPotentiallyRenderBlocking()).toBe(true);
      const clone = element.cloneNode(false);
      if (!clone.isElement()) throw new Error('Expected an element');
      expect(clone.isPotentiallyRenderBlocking()).toBe(false);
    }
  });

  it('uses script preparation state rather than guessing from the type content attribute', () => {
    const document = parseTestDocument('<script type="text/javascript"></script>');
    const script = document.getElementsByTagName('script').item(0)!;
    if (!HTMLScriptElementImpl.is(script)) throw new Error('Expected a script implementation');
    expect(script.parserDocument).toBe(document);
    expect(script.isPotentiallyRenderBlocking()).toBe(false);
    // Supply the output of the missing script-preparation algorithm, without simulating execution.
    script.scriptType = 'classic';
    expect(script.isPotentiallyRenderBlocking()).toBe(true);
    script.setAttribute('type', 'module');
    expect(script.isPotentiallyRenderBlocking()).toBe(true);
    for (const attribute of ['async', 'defer']) {
      script.setAttribute(attribute, 'false');
      expect(script.isPotentiallyRenderBlocking()).toBe(false);
      script.removeAttribute(attribute);
      expect(script.isPotentiallyRenderBlocking()).toBe(true);
    }
    script.parserDocument = null;
    expect(script.isPotentiallyRenderBlocking()).toBe(false);
    script.parserDocument = document;
    for (const type of ['module', 'importmap', 'speculationrules', null] as const) {
      script.scriptType = type;
      expect(script.isPotentiallyRenderBlocking()).toBe(false);
    }
    script.setAttribute('blocking', 'RENDER');
    expect(script.isPotentiallyRenderBlocking()).toBe(true);
    const clone = script.cloneNode(false);
    if (!HTMLScriptElementImpl.is(clone)) throw new Error('Expected a script clone');
    expect(clone.parserDocument).toBe(null);
    expect(clone.scriptType).toBe(null);
  });

  it('initializes reflected token lists from parser attributes', async () => {
    const browser = new Browlet({ route: () => '<link blocking="RENDER"><style blocking="unknown render"></style><script blocking="render"></script>' });
    await browser.navigate('https://blocking.test/');
    expect(await browser.evaluate(() => ['link', 'style', 'script'].map((tag) => {
      const element = document.querySelector(tag) as HTMLLinkElement | HTMLStyleElement | HTMLScriptElement;
      return [element.blocking.value, Array.from(element.blocking)];
    }))).toEqual([['RENDER', ['RENDER']], ['unknown render', ['unknown', 'render']], ['render', ['render']]]);
  });
});
