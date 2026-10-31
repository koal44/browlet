import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { extractMicrodataJSON } from '../../../../src/browlet/html/microdata/index';
import { SVG_NAMESPACE } from '../../../../src/infra/index';
import { parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { parseTestDocument } from '../../../support/dom';

describe('Microdata JSON extraction', () => {
  it('returns an empty items array without searching descendants of supplied non-items', () => {
    const document = parseTestDocument('<div itemscope><span itemprop="name">Ada</span></div>');
    expect(extractMicrodataJSON([])).toBe('{"items":[]}');
    expect(extractMicrodataJSON([
      document, document.body!, document.createTextNode('text'), document.createComment('comment'),
    ])).toBe('{"items":[]}');
  });

  it('keeps input order and repeated items, with an empty properties object for an empty item', () => {
    const document = parseTestDocument('<div id="a" itemscope><span itemprop="name">A</span></div><div id="b" itemscope></div>');
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    expect(extractMicrodataJSON([b, a, b])).toBe('{"items":[{"properties":{}},{"properties":{"name":["A"]}},{"properties":{}}]}');
  });

  it('uses itemprop absence for top-level status and ignores foreign items', () => {
    const document = parseTestDocument('<div itemscope><div id="inner" itemscope></div></div><div id="property" itemscope itemprop=""></div>');
    const foreign = document.createElementNS(SVG_NAMESPACE, 'svg');
    foreign.setAttribute('itemscope', '');
    expect(extractMicrodataJSON([
      document.getElementById('inner')!, document.getElementById('property')!, foreign,
    ])).toBe('{"items":[{"properties":{}}]}');
  });

  it('emits only explicit types, preserving token order and duplicates without vocabulary validation', () => {
    const document = parseTestDocument(`
      <div id="item" itemscope itemtype="urn:example:Person opaque urn:example:Person">
        <div itemprop="contact" itemscope><span itemprop="name">Ada</span></div>
      </div>
    `);
    expect(JSON.parse(extractMicrodataJSON([document.getElementById('item')!]))).toEqual({
      items: [{
        type: ['urn:example:Person', 'opaque', 'urn:example:Person'],
        properties: { contact: [{ properties: { name: ['Ada'] } }] },
      }],
    });
  });

  it('serializes parsed identifiers and omits missing or invalid identifiers', () => {
    const document = parseTestDocument(`
      <div id="missing" itemscope></div><div id="invalid" itemscope itemid="https://["></div>
      <div id="empty" itemscope itemid=""></div><div id="relative" itemscope itemid="../item?q=é"></div>
    `);
    document.url = parseURL('https://example.test/path/page').url!;
    const nodes = ['missing', 'invalid', 'empty', 'relative'].map((id) => document.getElementById(id)!);
    expect(JSON.parse(extractMicrodataJSON(nodes))).toEqual({
      items: [
        { properties: {} }, { properties: {} },
        { id: 'https://example.test/path/page', properties: {} },
        { id: 'https://example.test/item?q=%C3%A9', properties: {} },
      ],
    });
  });

  it('collects repeated and multi-name properties in tree order, including itemref targets', () => {
    const document = parseTestDocument(`
      <span id="before" itemprop="name alias name">Before</span>
      <div id="item" itemscope itemref="after before"><span itemprop="name">Inside</span></div>
      <span id="after" itemprop="name alias">After</span>
    `);
    expect(JSON.parse(extractMicrodataJSON([document.getElementById('item')!]))).toEqual({
      items: [{
        properties: {
          name: ['Before', 'Inside', 'After'], alias: ['Before', 'After'],
        },
      }],
    });
  });

  it('retains discovered values when overlapping references flag a traversal error', () => {
    const document = parseTestDocument('<div id="item" itemscope itemref="value value"><span id="value" itemprop="name">Ada</span></div>');
    expect(extractMicrodataJSON([document.getElementById('item')!])).toBe('{"items":[{"properties":{"name":["Ada"]}}]}');
  });

  it('replaces a cyclic nested item with ERROR without losing its other properties', () => {
    const document = parseTestDocument(`
      <div id="root" itemscope itemref="a"></div>
      <div id="a" itemscope itemprop="a" itemref="b"><span itemprop="name">A</span></div>
      <div id="b" itemscope itemprop="b" itemref="a"><span itemprop="name">B</span></div>
    `);
    expect(JSON.parse(extractMicrodataJSON([document.getElementById('root')!]))).toEqual({
      items: [{
        properties: {
          a: [{ properties: { name: ['A'], b: [{ properties: { a: ['ERROR'], name: ['B'] } }] } }],
        },
      }],
    });
  });

  it('serializes shared nested items independently in different branches and top-level items', () => {
    const document = parseTestDocument(`
      <div id="first" itemscope itemref="left right"></div>
      <div id="second" itemscope itemref="shared"></div>
      <div id="left" itemscope itemprop="left" itemref="shared"></div>
      <div id="right" itemscope itemprop="right" itemref="shared"></div>
      <div id="shared" itemscope itemprop="child"><span itemprop="name">Shared</span></div>
    `);
    const child = { properties: { name: ['Shared'] } };
    const branch = { properties: { child: [child] } };
    expect(JSON.parse(extractMicrodataJSON([
      document.getElementById('first')!, document.getElementById('second')!,
    ]))).toEqual({
      items: [
        { properties: { left: [branch], right: [branch] } },
        { properties: { child: [child] } },
      ],
    });
  });

  it('treats JavaScript object member names as ordinary properties', () => {
    const document = parseTestDocument(`
      <div id="item" itemscope>
        <span itemprop="__proto__ constructor toString toJSON hasOwnProperty">value</span>
        <span itemprop="__proto__">second</span>
      </div>
    `);
    expect(JSON.parse(extractMicrodataJSON([document.getElementById('item')!]))).toEqual({
      items: [{
        properties: {
          ['__proto__']: ['value', 'second'], constructor: ['value'], toString: ['value'],
          toJSON: ['value'], hasOwnProperty: ['value'],
        },
      }],
    });
  });

  it('uses compact JSON while preserving Unicode, controls, and numeric-looking strings', () => {
    const document = parseTestDocument('<div id="item" itemscope><span id="text" itemprop="text"></span><data itemprop="number" value="001.50"></data></div>');
    document.getElementById('text')!.textContent = 'é🦉 "\\\b\t\n\f\r\u0000';
    expect(extractMicrodataJSON([document.getElementById('item')!])).toBe(
      '{"items":[{"properties":{"text":["é🦉 \\"\\\\\\b\\t\\n\\f\\r\\u0000"],"number":["001.50"]}}]}',
    );
  });

  it('reads author mutations while retaining attribute-set-time URL values', async () => {
    const browser = new Browlet({
      route: () => `
      <base id="base" href="https://assets.test/first/">
      <article id="item" itemscope itemtype="urn:example:Article" itemid="article">
        <a itemprop="url" href="page">Page</a><time itemprop="date" datetime="2026-10-29">Today</time>
        <meta itemprop="summary" content="Before"><span id="name" itemprop="name">Old</span>
      </article>
    `,
    });
    await browser.navigate('https://example.test/');
    const item = unwrap<ElementImpl>(browser.document.getElementById('item')!);
    const before = extractMicrodataJSON([item]);
    expect(JSON.parse(before)).toEqual({
      items: [{
        type: ['urn:example:Article'], id: 'https://assets.test/first/article', properties: {
          url: ['https://assets.test/first/page'], date: ['2026-10-29'], summary: ['Before'], name: ['Old'],
        },
      }],
    });

    await browser.evaluate(() => {
      document.getElementById('base')!.setAttribute('href', 'https://assets.test/second/');
      const name = document.getElementById('name')!;
      name.setAttribute('itemprop', 'title');
      name.textContent = 'New';
    });
    expect(JSON.parse(extractMicrodataJSON([item]))).toEqual({
      items: [{
        type: ['urn:example:Article'], id: 'https://assets.test/second/article', properties: {
          url: ['https://assets.test/first/page'], date: ['2026-10-29'], summary: ['Before'], title: ['New'],
        },
      }],
    });
  });
});
