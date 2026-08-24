import { describe, expect, it, vi } from 'vitest';

import {
  parseHTMLDocument,
} from '../../../../src/browlet/parser/document-construction';
import { Snapshot } from '../../../../src/stylelet/snapshot';
import {
  compileSelectorList, matchSelectorList,
} from '../../../../src/stylelet/selector/match';
import {
  parseNestedSelectorList, parseSelectorList,
} from '../../../../src/stylelet/syntax/selector';

describe('selector matching', () => {
  it('matches a top-level nesting selector like :scope', () => {
    const document = createDocumentImpl('<main id="target"></main>');
    const root = document.documentElement;
    const target = document.getElementById('target')!;

    expect(match('&', root)).toEqual({ a: 0, b: 0, c: 0 });
    expect(match('&', target)).toBeNull();
  });

  it('matches a nested selector through its bound parent selector', () => {
    const document = createDocumentImpl(`
      <main class="parent">
        <span id="target" class="child"></span>
      </main>
      <span id="other" class="child"></span>
    `);
    const parent = parseSelectorList('.parent')!;
    const nested = parseNestedSelectorList('.child', parent)!;

    expect(matchSelectorList(nested, document.getElementById('target')!))
      .toEqual({ a: 0, b: 2, c: 0 });
    expect(matchSelectorList(nested, document.getElementById('other')!))
      .toBeNull();
  });

  it('uses the strongest parent-arm specificity for nested matching', () => {
    const document = createDocumentImpl(`
      <main><span id="target" class="child"></span></main>
    `);
    const parent = parseSelectorList('#missing, main')!;
    const nested = parseNestedSelectorList('> .child', parent)!;

    expect(matchSelectorList(nested, document.getElementById('target')!))
      .toEqual({ a: 1, b: 1, c: 0 });
  });

  it('matches a compound selector through child and descendant combinators', () => {
    const document = createDocumentImpl(`
      <main class="warning">
        <section><span id="target"></span></section>
      </main>
    `);
    const target = document.getElementById('target')!;
    const selectors = parseSelectorList('MAIN.warning > section span#target')!;

    expect(matchSelectorList(selectors, target)).toEqual({
      a: 1,
      b: 1,
      c: 3,
    });
  });

  it('matches adjacent and general element siblings', () => {
    const document = createDocumentImpl(`
      <div class="before"></div>
      text
      <div class="middle"></div>
      text
      <span id="target"></span>
    `);
    const target = document.getElementById('target')!;

    expect(match('div.before + div.middle ~ #target', target)).toEqual({
      a: 1,
      b: 2,
      c: 2,
    });
    expect(match('div.before + #target', target)).toBeNull();
  });

  it('returns the greatest specificity among matching selector-list arms', () => {
    const document = createDocumentImpl(
      '<main id="target" class="warning"></main>',
    );
    const target = document.getElementById('target')!;

    expect(match('main, .warning, #target', target)).toEqual({
      a: 1,
      b: 0,
      c: 0,
    });
    expect(match('#other, .warning', target)).toEqual({
      a: 0,
      b: 1,
      c: 0,
    });
  });

  it('supports universal selectors and rejects nonmatching compounds', () => {
    const document = createDocumentImpl(
      '<main id="target" class="one two"></main>',
    );
    const target = document.getElementById('target')!;

    expect(match('*.one.two#target', target)).not.toBeNull();
    expect(match('main.one.missing', target)).toBeNull();
    expect(match('section#target', target)).toBeNull();
  });

  it('restricts an unprefixed type selector to its default namespace URI', () => {
    const document = createDocumentImpl(`
      <circle id="html"></circle>
      <svg><circle id="svg"></circle></svg>
    `);
    const htmlCircle = document.getElementById('html')!;
    const svgCircle = document.getElementById('svg')!;
    const selectors = parseSelectorList('circle', {
      namespacePrefixes: new Map([
        ['svg', 'http://www.w3.org/2000/svg'],
      ]),
      defaultNamespace: 'http://www.w3.org/2000/svg',
    })!;

    expect(matchSelectorList(selectors, svgCircle)).not.toBeNull();
    expect(matchSelectorList(selectors, htmlCircle)).toBeNull();
  });

  it('matches a named type selector by its resolved namespace URI', () => {
    const document = createDocumentImpl(
      '<svg><circle id="target"></circle></svg>',
    );
    const target = document.getElementById('target')!;
    const selectors = parseSelectorList('vector|circle', {
      namespacePrefixes: new Map([
        ['vector', 'http://www.w3.org/2000/svg'],
      ]),
    })!;

    expect(matchSelectorList(selectors, target)).not.toBeNull();
  });

  it('matches a named attribute selector by its resolved namespace URI', () => {
    const document = createDocumentImpl(
      '<svg><use id="target" xlink:href="#icon"></use></svg>',
    );
    const target = document.getElementById('target')!;
    const context = {
      namespacePrefixes: new Map([
        ['link', 'http://www.w3.org/1999/xlink'],
      ]),
    };

    expect(matchSelectorList(
      parseSelectorList('[link|href]', context)!,
      target,
    )).not.toBeNull();
    expect(matchSelectorList(
      parseSelectorList('[link|href="#icon"]', context)!,
      target,
    )).not.toBeNull();
  });

  it('matches attributes and structural pseudo-classes', () => {
    const document = createDocumentImpl(
      '<main id="target" data-state="ready now"></main>',
    );
    const target = document.getElementById('target')!;

    expect(match('[data-state]', target)).not.toBeNull();
    expect(match('[data-state~="ready"]', target)).not.toBeNull();
    expect(match('[data-state="READY NOW" i]', target)).not.toBeNull();
    expect(match('[data-state="missing"]', target)).toBeNull();
    expect(match('#target:first-child:last-child', target)).not.toBeNull();
  });

  it('matches semantic identifier values decoded by the Stylelet parser', () => {
    const document = createDocumentImpl(
      String.raw`<main id="123" class="é foo\bar" data-state="é" data-test="foo\bar"></main>`,
    );
    const target = document.getElementById('123')!;

    expect(match(String.raw`#\31 23.\e9`, target)).not.toBeNull();
    expect(match(String.raw`[data\2d state="\e9"]`, target)).not.toBeNull();
    expect(match(String.raw`[data-test="foo\\bar"]`, target)).not.toBeNull();
  });

  it('matches logical and relative pseudo-classes', () => {
    const document = createDocumentImpl(`
      <main id="target">
        <section><span class="warning"></span></section>
      </main>
    `);
    const target = document.getElementById('target')!;

    expect(match(':is(main, aside)', target)).not.toBeNull();
    expect(match(':where(#target)', target)).toEqual({ a: 0, b: 0, c: 0 });
    expect(match('main:not(.missing)', target)).not.toBeNull();
    expect(match('main:has(> section .warning)', target)).not.toBeNull();
    expect(match('main:has(> .warning)', target)).toBeNull();
  });

  it('syncs the tree cache only for selectors that use it', () => {
    const document = createDocumentImpl('<main id="target"></main>');
    const target = document.getElementById('target')!;
    const version = vi.fn(() => 1);
    const snapshot = new Snapshot(document, {
      caps: { tree: { version } },
    });
    const simpleSelectors = parseSelectorList('#target')!;
    const structuralSelectors = parseSelectorList(':nth-child(1)')!;
    const simple = compileSelectorList(simpleSelectors, snapshot);
    const structural = compileSelectorList(structuralSelectors, snapshot);

    expect(simple.arms[0]).toMatchObject({
      cost: 1,
      usesCache: false,
      usesTriMatch: false,
    });
    expect(simple.usesCache).toBe(false);
    expect(structural.arms[0]).toMatchObject({
      cost: 8,
      usesCache: true,
      usesTriMatch: false,
    });
    expect(structural.usesCache).toBe(true);

    matchSelectorList(simpleSelectors, target, snapshot);
    expect(version).not.toHaveBeenCalled();

    matchSelectorList(structuralSelectors, target, snapshot);
    expect(version).toHaveBeenCalledOnce();
    expect(version).toHaveBeenCalledWith(document);
  });

  it('uses tri matching only for host and pseudo-element selectors', () => {
    const document = createDocumentImpl('<main></main>');
    const snapshot = new Snapshot(document);

    const simple = compileSelectorList(parseSelectorList('main')!, snapshot);
    const host = compileSelectorList(parseSelectorList(':host')!, snapshot);
    const nestedHost = compileSelectorList(
      parseSelectorList(':is(.item, :host)')!,
      snapshot,
    );
    const pseudoElement = compileSelectorList(
      parseSelectorList('main::before')!,
      snapshot,
    );

    expect(simple.usesTriMatch).toBe(false);
    expect(host.usesTriMatch).toBe(true);
    expect(nestedHost.usesTriMatch).toBe(true);
    expect(pseudoElement.usesTriMatch).toBe(true);
  });

  it('does not match pseudo-elements as element subjects', () => {
    const document = createDocumentImpl('<main id="target"></main>');
    const target = document.getElementById('target')!;

    expect(match('#target::before', target)).toBeNull();
  });
});

function match(selector: string, element: Element) {
  return matchSelectorList(parseSelectorList(selector)!, element);
}

function createDocumentImpl(source: string): Document {
  return parseHTMLDocument(source);
}
