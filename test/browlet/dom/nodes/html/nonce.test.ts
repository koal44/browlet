import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../../src/browlet/browlet';
import { CSPList, ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/index';
import type { DocumentImpl } from '../../../../../src/browlet/dom/nodes/document';
import { unwrap } from '../../../../support/browlet-binding';

// lib.dom does not yet expose nonce on SVG and MathML elements.
type NoncedElement = Element & Pick<HTMLElement, 'nonce'>;

const elements = [
  { name: 'HTML', namespace: 'http://www.w3.org/1999/xhtml', tag: 'div' },
  { name: 'SVG', namespace: 'http://www.w3.org/2000/svg', tag: 'svg' },
  { name: 'MathML', namespace: 'http://www.w3.org/1998/Math/MathML', tag: 'math' },
];

describe.each(elements)('$name nonce', (elementType) => {
  it('keeps the IDL value separate from attributes and their mutation records', async () => {
    const browser = createBrowser();
    expect(await browser.evaluate(({ namespace, tag }) => {
      const element = document.createElementNS(namespace, tag) as NoncedElement;
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      const initial = element.nonce;
      let conversions = 0;
      const values = ['secret', '', null, undefined, {
        toString() { conversions++; return 'converted'; },
      }].map((value) => {
        Reflect.set(element, 'nonce', value);
        return [element.nonce, element.getAttribute('nonce')];
      });
      return { initial, values, conversions, records: observer.takeRecords().length };
    }, elementType)).toEqual({
      initial: '',
      values: [['secret', null], ['', null], ['null', null], ['undefined', null], ['converted', null]],
      conversions: 1,
      records: 0,
    });
  });

  it('updates from content attributes, including empty values, removal, and equal writes', async () => {
    const browser = createBrowser();
    expect(await browser.evaluate(({ namespace, tag }) => {
      const element = document.createElementNS(namespace, tag) as NoncedElement;
      element.setAttribute('nonce', 'attribute');
      const first = element.nonce;
      Reflect.set(element, 'nonce', 'private');
      element.setAttribute('nonce', 'attribute');
      const equalWrite = element.nonce;
      element.setAttribute('nonce', '');
      const empty = element.nonce;
      Reflect.set(element, 'nonce', 'before-removal');
      element.removeAttribute('nonce');
      const removed = element.nonce;
      Reflect.set(element, 'nonce', 'absent');
      element.removeAttribute('nonce');
      return [first, equalWrite, empty, removed, element.nonce];
    }, elementType)).toEqual(['attribute', 'attribute', '', '', 'absent']);
  });

  it('ignores namespaced lookalikes and follows attached attribute mutation and replacement', async () => {
    const browser = createBrowser();
    expect(await browser.evaluate(({ namespace, tag }) => {
      const element = document.createElementNS(namespace, tag) as NoncedElement;
      element.setAttributeNS('urn:other', 'x:nonce', 'other');
      const initial = element.nonce;
      const attribute = document.createAttribute('nonce');
      attribute.value = 'attached';
      element.setAttributeNode(attribute);
      const attached = element.nonce;
      attribute.value = 'updated';
      const updated = element.nonce;
      const replacement = document.createAttribute('nonce');
      replacement.value = 'replacement';
      element.setAttributeNode(replacement);
      const replaced = element.nonce;
      element.removeAttributeNode(replacement);
      return [initial, attached, updated, replaced, element.nonce,
        element.getAttributeNS('urn:other', 'nonce')];
    }, elementType)).toEqual(['', 'attached', 'updated', 'replacement', '', 'other']);
  });

  it.each([
    { source: undefined, disposition: 'enforce', hidden: false },
    { source: 'meta', disposition: 'enforce', hidden: false },
    { source: 'header', disposition: 'enforce', hidden: true },
    { source: 'header', disposition: 'report', hidden: true },
  ] as const)('hides on connection for $source/$disposition policies: $hidden', async ({ source, disposition, hidden }) => {
    const browser = createBrowser(source, disposition);
    expect(await browser.evaluate(({ namespace, tag }) => {
      const element = document.createElementNS(namespace, tag) as NoncedElement;
      element.setAttribute('nonce', 'attribute');
      Reflect.set(element, 'nonce', 'private');
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      document.documentElement.appendChild(element);
      const records = observer.takeRecords().map((record) => [record.attributeName, record.oldValue]);
      return {
        nonce: element.nonce, attribute: element.getAttribute('nonce'),
        matches: element.matches('[nonce="attribute"]'), records,
      };
    }, elementType)).toEqual({
      nonce: 'private', attribute: hidden ? '' : 'attribute', matches: !hidden,
      records: hidden ? [['nonce', 'attribute']] : [],
    });
  });

  it('hides in a newly connected shadow subtree, but only on insertion', async () => {
    const browser = createBrowser('header');
    expect(await browser.evaluate(({ namespace, tag }) => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'closed' });
      const element = document.createElementNS(namespace, tag) as NoncedElement;
      element.setAttribute('nonce', 'detached');
      shadow.appendChild(element);
      const detached = element.getAttribute('nonce');
      document.documentElement.appendChild(host);
      const connected = [element.nonce, element.getAttribute('nonce')];
      element.setAttribute('nonce', 'while-connected');
      const changed = [element.nonce, element.getAttribute('nonce')];
      element.remove();
      shadow.appendChild(element);
      return [detached, connected, changed, [element.nonce, element.getAttribute('nonce')]];
    }, elementType)).toEqual(['detached', ['detached', ''],
      ['while-connected', 'while-connected'], ['while-connected', '']]);
  });

  it('does not mutate absent or empty attributes while connecting', async () => {
    const browser = createBrowser('header');
    expect(await browser.evaluate(({ namespace, tag }) => [false, true].map((hasAttribute) => {
      const element = document.createElementNS(namespace, tag) as NoncedElement;
      if (hasAttribute) element.setAttribute('nonce', '');
      Reflect.set(element, 'nonce', 'private');
      const observer = new MutationObserver(() => {});
      observer.observe(element, { attributes: true });
      document.documentElement.appendChild(element);
      return [element.nonce, element.getAttribute('nonce'), observer.takeRecords().length];
    }), elementType)).toEqual([['private', null, 0], ['private', '', 0]]);
  });

  it('copies the internal value during shallow/deep cloning and importing, independently of attributes', async () => {
    const browser = createBrowser('header');
    expect(await browser.evaluate(({ namespace, tag }) => {
      const parent = document.createElementNS(namespace, tag) as NoncedElement;
      const child = document.createElementNS(namespace, tag) as NoncedElement;
      parent.setAttribute('nonce', 'parent-attribute');
      Reflect.set(parent, 'nonce', 'parent-private');
      child.setAttribute('nonce', 'child-attribute');
      Reflect.set(child, 'nonce', 'child-private');
      parent.appendChild(child);
      const shallow = parent.cloneNode(false) as NoncedElement;
      document.documentElement.appendChild(parent);
      const deep = parent.cloneNode(true) as NoncedElement;
      const imported = document.implementation.createHTMLDocument().importNode(parent, true);
      return [
        [shallow.nonce, shallow.getAttribute('nonce'), shallow.childNodes.length],
        ...[deep, imported].map((copy) => [copy.nonce, copy.getAttribute('nonce'),
          (copy.firstElementChild as NoncedElement).nonce, copy.firstElementChild!.getAttribute('nonce')]),
      ];
    }, elementType)).toEqual([
      ['parent-private', 'parent-attribute', 0],
      ['parent-private', '', 'child-private', ''],
      ['parent-private', '', 'child-private', ''],
    ]);
  });

  it('uses the current document policy after adoption, requiring a browsing context', async () => {
    const browser = createBrowser('header');
    expect(await browser.evaluate(({ namespace, tag }) => {
      const inert = document.implementation.createHTMLDocument();
      const element = inert.createElementNS(namespace, tag) as NoncedElement;
      element.setAttribute('nonce', 'inert');
      inert.documentElement.appendChild(element);
      const before = [element.nonce, element.getAttribute('nonce')];
      document.adoptNode(element);
      const adopted = element.getAttribute('nonce');
      document.documentElement.appendChild(element);
      return [before, adopted, [element.nonce, element.getAttribute('nonce')]];
    }, elementType)).toEqual([['inert', 'inert'], 'inert', ['inert', '']]);
  });
});

describe('Nonce interface boundary', () => {
  it('does not add a nonce property to generic XML elements', async () => {
    const browser = createBrowser('header');
    expect(await browser.evaluate(() => {
      const element = document.createElementNS('urn:other', 'node');
      element.setAttribute('nonce', 'visible');
      document.documentElement.appendChild(element);
      return ['nonce' in element, element.getAttribute('nonce')];
    })).toEqual([false, 'visible']);
  });

  it('does not hide in a document with a header policy but no browsing context', () => {
    const browser = createBrowser('header');
    const active = unwrap<DocumentImpl>(browser.document);
    const document = active.implementation.createHTMLDocument('inert');
    document.policyContainer.cspList = active.policyContainer.cspList;
    const element = document.createElement('div');
    element.setAttribute('nonce', 'visible');
    document.documentElement!.appendChild(element);
    expect(element.getAttribute('nonce')).toBe('visible');
  });

  it('runs attribute hooks for parser-created HTML, SVG, and MathML elements', async () => {
    const browser = new Browlet({ route: () => '<div nonce="html"></div><svg nonce="svg"></svg><math nonce="math"></math>' });
    await browser.navigate('https://nonce.test/');
    expect(await browser.evaluate(() => ['div', 'svg', 'math'].map((tag) => {
      const element = document.querySelector(tag) as NoncedElement;
      return [element.nonce, element.getAttribute('nonce')];
    }))).toEqual([['html', 'html'], ['svg', 'svg'], ['math', 'math']]);
  });
});

/** Install real policy records without pretending the missing navigation/meta delivery already exists. */
function createBrowser(source?: 'header' | 'meta', disposition: 'enforce' | 'report' = 'enforce'): Browlet {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  if (source !== undefined) {
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("script-src 'unsafe-inline'", source, disposition));
  }
  if (document.documentElement === null) document.appendChild(document.createElement('html'));
  return browser;
}
