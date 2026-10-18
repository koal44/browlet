import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { type DocumentImpl, type ElementImpl, ElementTag } from '../../../src/browlet/dom/nodes/index';
import { htmlIDLDefinitions } from '../../../src/browlet/dom/nodes/html/index';
import { HTMLArticleElementImpl, HTMLH3ElementImpl } from '../../../src/browlet/dom/nodes/html/sections/index';
import { HTMLBlockQuoteElementImpl, HTMLQElementImpl } from '../../../src/browlet/dom/nodes/html/grouping/quote';
import { HTMLXMPElementImpl } from '../../../src/browlet/dom/nodes/html/grouping/pre';
import { HTMLInsElementImpl } from '../../../src/browlet/dom/nodes/html/text/mod';
import { HTMLColGroupElementImpl } from '../../../src/browlet/dom/nodes/html/tables/col';
import { HTMLTableDataCellElementImpl } from '../../../src/browlet/dom/nodes/html/tables/cell';
import { HTMLTableFootElementImpl } from '../../../src/browlet/dom/nodes/html/tables/section';
import {
  alreadyConstructed, CustomElementRegistryImpl, type CustomElementDefinition,
} from '../../../src/browlet/dom/nodes/html/custom-elements/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { createTestDocument } from '../../support/dom';

describe('HTML element constructors', () => {
  it('declares one argument-free HTML constructor on each eligible element interface', () => {
    const elements = htmlIDLDefinitions.filter((definition) => definition.kind === 'interface')
      .filter((definition) => /^HTML\w*Element$/.test(definition.name));
    expect(elements).toHaveLength(72);
    for (const definition of elements) {
      expect(definition.exposed).toBe('Window');
      const constructors = definition.members.filter((member) => member.kind === 'constructor');
      if (definition.name === 'HTMLUnknownElement' || definition.name === 'HTMLMediaElement') {
        expect(constructors).toEqual([]);
      } else {
        expect(constructors).toHaveLength(1);
        expect(constructors[0]?.arguments).toEqual([]);
        expect(constructors[0]?.extendedAttributes).toEqual([{ kind: 'no-arguments', name: 'HTMLConstructor' }]);
      }
    }
  });

  it('rejects direct construction and function calls for every element interface', async () => {
    const browser = new Browlet({ route: () => '' });
    const names = htmlIDLDefinitions.filter((definition) => definition.kind === 'interface')
      .filter((definition) => /^HTML\w*Element$/.test(definition.name)).map((definition) => definition.name);
    expect(await browser.evaluate((names) => names.map((name) => {
      const constructor = Reflect.get(globalThis, name) as typeof HTMLElement;
      return [() => { Reflect.construct(constructor, []); }, () => { Reflect.apply(constructor, null, []); }].map((call) => {
        try { call(); return false; } catch (error) { return error instanceof TypeError; }
      });
    }), names)).toEqual(names.map(() => [true, true]));
  });

  it('rejects the active constructor itself even when a definition uses it', () => {
    const browser = new Browlet({ route: () => '' });
    const Target = browser.window.HTMLDivElement;
    addDefinition(browser, Target, 'div');
    expect(() => new Target()).toThrow(getRelevantRealm(browser.window).intrinsics.typeError);
  });

  it('creates an autonomous element with its definition, document, and author prototype', async () => {
    const { browser, Target, definition, document, registry } = await fixture();
    const element = new Target();
    const implementation = unwrap<ElementImpl>(element);
    expect(Object.getPrototypeOf(element)).toBe(Target.prototype);
    expect(element.ownerDocument).toBe(browser.document);
    expect([element.localName, element.namespaceURI, element.prefix, element.attributes.length])
      .toEqual(['x-test', 'http://www.w3.org/1999/xhtml', null, 0]);
    expect(implementation.nodeDocument).toBe(document);
    expect(implementation.customElementDefinition).toBe(definition);
    expect(implementation.customElementRegistry).toBe(registry);
    expect(implementation.customElementState).toBe('custom');
    expect(implementation.isValue).toBeNull();
    expect(implementation.tag).toBe(ElementTag.Other);
    expect(definition.constructionStack).toEqual([]);
  });

  it.each([
    ['HTMLQuoteElement', 'q', HTMLQElementImpl], ['HTMLQuoteElement', 'blockquote', HTMLBlockQuoteElementImpl],
    ['HTMLElement', 'article', HTMLArticleElementImpl], ['HTMLPreElement', 'xmp', HTMLXMPElementImpl],
    ['HTMLHeadingElement', 'h3', HTMLH3ElementImpl],
    ['HTMLModElement', 'ins', HTMLInsElementImpl], ['HTMLTableColElement', 'colgroup', HTMLColGroupElementImpl],
    ['HTMLTableCellElement', 'td', HTMLTableDataCellElementImpl], ['HTMLTableSectionElement', 'tfoot', HTMLTableFootElementImpl],
  ] as const)('constructs a customized built-in through %s for %s', async (base, localName, constructor) => {
    const { Target, definition } = await fixture(base, localName);
    const element = new Target();
    expect(element.localName).toBe(localName);
    expect(element.getAttribute('is')).toBeNull();
    expect(unwrap<ElementImpl>(element).isValue).toBe(definition.name);
    expect(unwrap<ElementImpl>(element).constructor).toBe(constructor);
    expect(unwrap<ElementImpl>(element).tag).toBe(constructor.prototype.tag);
  });

  it('uses the current Document after prototype access, retaining the already selected definition and registry', async () => {
    const { browser, definition, registry } = await fixture();
    const env = getRelevantRealm(browser.window).env;
    const replacement = createTestDocument(env);
    const Target = new Proxy(function Target() {}, {
      get() {
        env.window.setAssociatedDocument(replacement);
        return browser.window.HTMLElement.prototype;
      },
    });
    definition.constructor = Target;
    const element = Reflect.construct(browser.window.HTMLElement, [], Target) as object;
    const implementation = unwrap<ElementImpl>(element);
    expect(implementation.nodeDocument === replacement, 'nodeDocument must follow the replacement').toBe(true);
    expect(implementation.customElementDefinition).toBe(definition);
    expect(implementation.customElementRegistry).toBe(registry);
  });

  it.each([
    ['HTMLParagraphElement', 'x-test'], ['HTMLQuoteElement', 'p'], ['HTMLElement', 'div'],
  ])('rejects the mismatched %s base for %s', async (base, localName) => {
    const { browser, Target } = await fixture(base, localName);
    expect(() => new Target()).toThrow(getRelevantRealm(browser.window).intrinsics.typeError);
  });

  it('rejects an unregistered subclass before reading its prototype', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let reads = 0;
      const target = new Proxy(function Target() {}, {
        get(target, key, receiver) {
          if (key === 'prototype') reads++;
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      let rejected = false;
      try { Reflect.construct(HTMLElement, [], target); }
      catch (error) { rejected = error instanceof TypeError; }
      return [rejected, reads];
    })).toEqual([true, 0]);
  });

  it('uses the active constructor map ahead of the current document registry', async () => {
    const { browser, Target, definition } = await fixture();
    const scoped = new CustomElementRegistryImpl();
    scoped.isScoped = true;
    const scopedDefinition = { ...definition, name: 'x-scoped', localName: 'x-scoped', constructionStack: [] };
    scoped.definitions.add(scopedDefinition);
    const active = getRelevantRealm(browser.window).agent.activeCustomElementConstructorMap;
    active.set(Target, scoped);
    try {
      const element = new Target();
      expect(element.localName).toBe('x-scoped');
      expect(element.ownerDocument).toBe(browser.document);
      expect(unwrap<ElementImpl>(element).customElementRegistry).toBe(scoped);
      expect(unwrap<ElementImpl>(element).customElementDefinition).toBe(scopedDefinition);
      expect(active.get(Target)).toBe(scoped);
    } finally { active.delete(Target); }
  });

  it('does not fall back to another registry when the selected registry has no matching definition', async () => {
    const { browser, Target, document } = await fixture();
    const active = getRelevantRealm(browser.window).agent.activeCustomElementConstructorMap;
    active.set(Target, new CustomElementRegistryImpl());
    try {
      expect(() => new Target()).toThrow(getRelevantRealm(browser.window).intrinsics.typeError);
    } finally { active.delete(Target); }
    document.customElementRegistry = null;
    expect(() => new Target()).toThrow(getRelevantRealm(browser.window).intrinsics.typeError);
  });

  it('reuses the upgrade element and replaces only the last stack entry', async () => {
    const { browser, Target, definition } = await fixture();
    const first = browser.document.createElement('x-first');
    const existing = browser.document.createElement('x-test');
    const implementation = unwrap<ElementImpl>(existing);
    implementation.customElementState = 'precustomized';
    implementation.customElementDefinition = definition;
    definition.constructionStack.push(unwrap<ElementImpl>(first), implementation);
    expect(new Target()).toBe(existing);
    expect(Object.getPrototypeOf(existing)).toBe(Target.prototype);
    expect(implementation.tag).toBe(ElementTag.Other);
    expect(definition.constructionStack).toEqual([unwrap(first), alreadyConstructed]);
    // The upgrade algorithm, not super(), changes precustomized to custom and pops the stack.
    expect(implementation.customElementState).toBe('precustomized');
    expect(() => new Target()).toThrow(getRelevantRealm(browser.window).intrinsics.typeError);
  });

  it('rejects a second super() call through the already-constructed marker', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      Reflect.set(globalThis, 'Target', class extends HTMLElement {
        constructor() { super(); super(); }
      });
    });
    const Target = Reflect.get(browser.window, 'Target') as new() => HTMLElement;
    const definition = addDefinition(browser, Target);
    definition.constructionStack.push(unwrap<ElementImpl>(browser.document.createElement('x-test')));
    expect(() => new Target()).toThrow(getRelevantRealm(browser.window).intrinsics.typeError);
    expect(definition.constructionStack).toEqual([alreadyConstructed]);
  });

  it.each([false, true])('preserves a prototype-getter exception before consuming the upgrade entry: %s', async (upgrade) => {
    const { browser, definition } = await fixture();
    const sentinel = {};
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Author prototype access can throw any value.
    const Target = new Proxy(function Target() {}, { get() { throw sentinel; } });
    definition.constructor = Target;
    const existing = unwrap<ElementImpl>(browser.document.createElement('x-test'));
    if (upgrade) definition.constructionStack.push(existing);
    let thrown: unknown;
    try { Reflect.construct(browser.window.HTMLElement, [], Target); } catch (error) { thrown = error; }
    expect(thrown).toBe(sentinel);
    expect(definition.constructionStack).toEqual(upgrade ? [existing] : []);
  });

  it.each([false, true])('reads the prototype once and ignores extra arguments: upgrade=%s', async (upgrade) => {
    const { browser, definition } = await fixture();
    const reads: PropertyKey[] = [];
    const prototype = {};
    const Target = new Proxy(function Target() {}, {
      get(_target, key) { reads.push(key); return prototype; },
    });
    definition.constructor = Target;
    if (upgrade) definition.constructionStack.push(unwrap<ElementImpl>(browser.document.createElement('x-test')));
    const argument = { toString() { throw new Error('Unexpected argument conversion'); } };
    const element = Reflect.construct(browser.window.HTMLElement, [argument], Target) as object;
    expect(Object.getPrototypeOf(element)).toBe(prototype);
    expect(reads).toEqual(['prototype']);
  });

  it('reads the last upgrade entry after a reentrant prototype getter', async () => {
    const { browser, definition } = await fixture();
    const existing = browser.document.createElement('x-test');
    definition.constructionStack.push(unwrap<ElementImpl>(existing));
    let reads = 0;
    let nested: object | undefined;
    const Target = new Proxy(function Target() {}, {
      get() {
        if (++reads === 1) nested = Reflect.construct(browser.window.HTMLElement, [], Target) as object;
        return browser.window.HTMLElement.prototype;
      },
    });
    definition.constructor = Target;
    expect(() => { Reflect.construct(browser.window.HTMLElement, [], Target); })
      .toThrow(getRelevantRealm(browser.window).intrinsics.typeError);
    expect(reads).toBe(2);
    expect(nested).toBe(existing);
    expect(definition.constructionStack).toEqual([alreadyConstructed]);
  });

  it('chooses fresh construction before a prototype getter changes the stack', async () => {
    const { browser, definition } = await fixture();
    const existing = unwrap<ElementImpl>(browser.document.createElement('x-test'));
    const Target = new Proxy(function Target() {}, {
      get() {
        definition.constructionStack.push(existing);
        return browser.window.HTMLElement.prototype;
      },
    });
    definition.constructor = Target;
    const element = Reflect.construct(browser.window.HTMLElement, [], Target) as object;
    expect(unwrap<ElementImpl>(element)).not.toBe(existing);
    expect(definition.constructionStack).toEqual([existing]);
  });

  it.each([false, true])('uses newTarget realm for a primitive prototype, retaining allocation ownership: upgrade=%s', async (upgrade) => {
    const { browser, definition } = await fixture('HTMLDivElement', 'div');
    const foreign = new Browlet({ route: () => '' });
    await foreign.evaluate(() => { Reflect.set(globalThis, 'Target', function Target() {}); });
    const Target = Reflect.get(foreign.window, 'Target') as new() => object;
    Reflect.set(Target, 'prototype', 0);
    definition.constructor = Target;
    const existing = browser.document.createElement('div');
    if (upgrade) definition.constructionStack.push(unwrap<ElementImpl>(existing));
    const element = Reflect.construct(browser.window.HTMLDivElement, [], Target) as object;
    expect(Object.getPrototypeOf(element)).toBe(foreign.window.HTMLDivElement.prototype);
    expect(getRelevantRealm(element)).toBe(getRelevantRealm(browser.window));
    expect(unwrap<ElementImpl>(element).nodeDocument).toBe(unwrap(browser.document));
    if (upgrade) expect(element).toBe(existing);
  });

  // SPEC_CLASH(html-constructor-nonextensible-upgrade): HTML/Chromium ignore false; Firefox/WebKit throw.
  it('returns the upgrade element when its non-extensibility prevents changing its prototype', async () => {
    const { browser, Target, definition } = await fixture();
    const existing = browser.document.createElement('x-test');
    const prototype = Reflect.getPrototypeOf(existing);
    Object.preventExtensions(existing);
    definition.constructionStack.push(unwrap<ElementImpl>(existing));
    expect(new Target()).toBe(existing);
    expect(Object.getPrototypeOf(existing)).toBe(prototype);
    expect(definition.constructionStack).toEqual([alreadyConstructed]);
  });
});

// Supply the missing define()/upgrade producers as state, while exercising real platform constructors.
async function fixture(base = 'HTMLElement', localName = 'x-test') {
  const browser = new Browlet({ route: () => '' });
  await browser.evaluate((base) => {
    const Parent = Reflect.get(globalThis, base) as typeof HTMLElement;
    Reflect.set(globalThis, 'Target', class extends Parent {});
  }, base);
  const Target = Reflect.get(browser.window, 'Target') as new() => HTMLElement;
  const document = unwrap<DocumentImpl>(browser.document);
  const registry = document.customElementRegistry!;
  const definition = addDefinition(browser, Target, localName);
  return { browser, Target, definition, document, registry };
}

function addDefinition(browser: Browlet, constructor: object, localName = 'x-test'): CustomElementDefinition {
  const definition: CustomElementDefinition = { name: 'x-test', localName, constructor, constructionStack: [] };
  unwrap<DocumentImpl>(browser.document).customElementRegistry!.definitions.add(definition);
  return definition;
}
