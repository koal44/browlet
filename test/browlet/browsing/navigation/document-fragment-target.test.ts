import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseURL } from '../../../../src/url/index';
import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../src/infra/index';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import type { Document } from '../../../../src/browlet/platform';
import { DocumentMode, type DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { matchSelectorList, parseSelectorList } from '../../../../src/stylelet/selector/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document fragment target', () => {
  it.each([
    ['', null], ['#', 'top'], ['#missing', null], ['#top', 'top'], ['#TOP', 'top'], ['#%74op', 'top'],
  ] as const)('selects %s without an element', (fragment, expected) => {
    const { document } = fixture(fragment);
    expect(document.indicatedPart).toBe(expected);
  });

  it('rejects another URL except for its fragment', () => {
    const { document } = fixture('#original');
    const target = appendElement(document, 'div', { id: 'match' });
    expect(document.selectIndicatedPart(parseURL('https://example.test/page#match').url!)).toBe(target);
    for (const url of ['https://other.test/page#match', 'https://example.test/other#match', 'https://example.test/page?q#match']) {
      expect(document.selectIndicatedPart(parseURL(url).url!)).toBeNull();
    }
    expect(document.selectIndicatedPart(parseURL('https://example.test/page').url!)).toBeNull();
  });

  it('prefers an ID anywhere in the Document over an earlier legacy name', () => {
    const { document } = fixture('#same');
    appendElement(document, 'a', { name: 'same' });
    const target = appendElement(document, 'div', { id: 'same' });
    expect(document.indicatedPart).toBe(target);
  });

  it('prefers a raw legacy name over a decoded ID', () => {
    const { document } = fixture('#%6eame');
    appendElement(document, 'div', { id: 'name' });
    const raw = appendElement(document, 'a', { name: '%6eame' });
    expect(document.indicatedPart).toBe(raw);
  });

  it('prefers a raw ID over a decoded ID', () => {
    const { document } = fixture('#%69d');
    appendElement(document, 'div', { id: 'id' });
    const raw = appendElement(document, 'div', { id: '%69d' });
    expect(document.indicatedPart).toBe(raw);
  });

  it.each([
    ['#a%20b', 'a b'], ['#%C3%A9', 'é'], ['#replacement%FF', 'replacement�'],
    ['#%EF%BB%BFbom', '\uFEFFbom'], ['#%2561', '%61'], ['#bad%zz', 'bad%zz'], ['#a+b', 'a+b'],
  ] as const)('decodes %s once as UTF-8 without stripping a BOM or converting plus', (fragment, id) => {
    const { document } = fixture(fragment);
    const target = appendElement(document, 'div', { id });
    expect(document.indicatedPart).toBe(target);
  });

  it('finds decoded legacy names and lets a real top anchor beat the special value', () => {
    const { document } = fixture('#%6eame');
    const named = appendElement(document, 'a', { name: 'name' });
    expect(document.indicatedPart).toBe(named);
    named.setAttribute('name', 'TOP');
    document.url.fragment = 'TOP';
    expect(document.indicatedPart).toBe(named);
  });

  it('uses current tree order for duplicate IDs and names', () => {
    const { document } = fixture('#same');
    const first = appendElement(document, 'div', { id: 'same' });
    const second = appendElement(document, 'div', { id: 'same' });
    expect(document.indicatedPart).toBe(first);
    document.body!.insertBefore(second, first);
    expect(document.indicatedPart).toBe(second);
    first.remove();
    second.remove();
    const firstName = appendElement(document, 'a', { name: 'same' });
    const secondName = appendElement(document, 'a', { name: 'same' });
    expect(document.indicatedPart).toBe(firstName);
    document.body!.insertBefore(secondName, firstName);
    expect(document.indicatedPart).toBe(secondName);
  });

  it('excludes shadow trees and non-anchor or foreign name attributes', () => {
    const { document, platform } = fixture('#hidden');
    const host = platform.createElement('div');
    platform.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowTarget = platform.createElement('div');
    shadowTarget.id = 'hidden';
    shadow.appendChild(shadowTarget);
    appendElement(document, 'div', { name: 'hidden' });
    const svgAnchor = document.createElementNS(SVG_NAMESPACE, 'a');
    svgAnchor.setAttribute('name', 'hidden');
    document.body!.appendChild(svgAnchor);
    expect(document.indicatedPart).toBeNull();
    svgAnchor.id = 'hidden';
    expect(document.indicatedPart).toBe(svgAnchor);
  });

  it('matches anchor names exactly in quirks mode as in standards mode', () => {
    const { document } = fixture('#named');
    const anchor = appendElement(document, 'a', { name: 'Named' });
    for (const mode of [DocumentMode.Quirks, DocumentMode.NoQuirks]) {
      document.mode = mode;
      expect(document.indicatedPart).toBeNull();
      document.url.fragment = 'Named';
      expect(document.indicatedPart).toBe(anchor);
      document.url.fragment = 'named';
    }
  });

  it('keeps non-HTML MIME fragment rules explicit without failing for an absent fragment', () => {
    const { document } = fixture('');
    document.type = 'xml';
    expect(document.indicatedPart).toBeNull();
    document.url.fragment = 'xml-id';
    expect(() => document.indicatedPart).toThrow('Non-HTML Document fragment selection is not implemented');
  });

  it('does not infer a CSS target from the URL before fragment scrolling selects one', () => {
    const { document, platform } = fixture('#duplicate');
    for (let i = 0; i < 2; i++) {
      const element = document.createElement('div');
      element.id = 'duplicate';
      document.body!.appendChild(element);
    }
    expect(platform.querySelectorAll(':target').length).toBe(0);
  });

  it('uses the same retained target for stylesheet matching and DOM queries', () => {
    const { document, platform } = fixture('#duplicate');
    const first = appendElement(document, 'div', { id: 'duplicate' });
    const second = appendElement(document, 'div', { id: 'duplicate' });
    const context = document.getStyleEngine().context;
    const selector = parseSelectorList(':target', {})!;
    const matches = () => [first, second].map((element) => matchSelectorList(selector, element, context) !== null);
    expect(matches()).toEqual([false, false]);
    expect(() => document.scrollToFragment()).toThrow('Fragment target revealing, scrolling, and focusing are not implemented');
    expect(matches()).toEqual([true, false]);
    expect(matchSelectorList(selector, first, context)).toEqual({ a: 0, b: 1, c: 0 });
    document.url.fragment = 'elsewhere';
    first.id = 'renamed';
    expect(matches()).toEqual([true, false]);
    expect(platform.querySelector(':target')).toBe(project(first));
    document.scrollToFragment();
    expect(matches()).toEqual([false, false]);
    expect(platform.querySelector(':target')).toBeNull();
  });

  it('retains the selected target across URL and ID changes, then clears it for a missing fragment', () => {
    const { document, platform } = fixture('#old-anchor');
    const target = appendElement(document, 'a', { name: 'old-anchor', id: 'original' });
    appendElement(document, 'div', { id: 'new-id' });
    expect(() => document.scrollToFragment()).toThrow('Fragment target revealing, scrolling, and focusing are not implemented');
    expect(document.targetElement).toBe(target);
    expect(platform.querySelector(':target')).toBe(project(target));
    document.url.fragment = 'new-id';
    target.id = 'changed';
    expect(platform.querySelector(':target')).toBe(project(target));
    document.url.fragment = 'missing';
    document.scrollToFragment();
    expect(document.targetElement).toBeNull();
    expect(platform.querySelector(':target')).toBeNull();
  });

  it('matches only the selected duplicate ID, retaining that identity after reordering', () => {
    const { document, platform } = fixture('#duplicate');
    const first = appendElement(document, 'div', { id: 'duplicate' });
    const second = appendElement(document, 'div', { id: 'duplicate' });
    expect(() => document.scrollToFragment()).toThrow('Fragment target revealing, scrolling, and focusing are not implemented');
    expect(Array.from(platform.querySelectorAll(':target'))).toEqual([project(first)]);
    document.body!.insertBefore(second, first);
    expect(Array.from(platform.querySelectorAll(':target'))).toEqual([project(first)]);
  });

  it.each(['', 'top'])('clears the target before attempting viewport scrolling for #%s', (fragment) => {
    const { document } = fixture('#old');
    document.targetElement = appendElement(document, 'div', { id: 'old' });
    document.url.fragment = fragment;
    const scroll = vi.spyOn(document, 'scrollToBeginning').mockImplementation(() => {
      expect(document.targetElement).toBeNull();
    });
    document.scrollToFragment();
    expect(scroll).toHaveBeenCalledOnce();
    scroll.mockRestore();
    expect(() => document.scrollToFragment()).toThrow('Document viewport scrolling is not implemented');
  });

  it('clears the target without scrolling when the URL has no fragment', () => {
    const { document } = fixture('');
    document.targetElement = appendElement(document, 'div', { id: 'old' });
    const scroll = vi.spyOn(document, 'scrollToBeginning');
    document.scrollToFragment();
    expect(document.targetElement).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
  });
});

function appendElement(document: DocumentImpl, name: string, attributes: Record<string, string>) {
  const element = document.createElementNS(HTML_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  document.body!.appendChild(element);
  return element;
}

function fixture(fragment: string) {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = top.activeDocument!;
  document.url = parseURL(`https://example.test/page${fragment}`).url!;
  const platform = project(document) as Document;
  return { document, platform };
}
