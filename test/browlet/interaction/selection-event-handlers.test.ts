import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl, ElementImpl } from '../../../src/browlet/dom/nodes/index';
import type { HTMLElementImpl } from '../../../src/browlet/dom/nodes/html/html-element';
import { unwrap } from '../../support/browlet-binding';

const selectionTypes = ['selectstart', 'selectionchange'];

describe('Selection API §4.3: GlobalEventHandlers', () => {
  it('connects every includer to ordinary callback identity, invocation, cancellation, and removal', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate((types: string[]) => {
      const targets: Record<string, EventTarget> = {
        window, document, html: document.createElement('div'),
        svg: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
        mathml: document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi'),
        body: document.body, frameset: document.createElement('frameset'),
      };
      return Object.entries(targets).flatMap(([kind, target]) => types.map((type) => {
        const name = 'on' + type;
        const initiallyNull = Reflect.get(target, name) === null;
        let calls = 0;
        let receiver = false;
        const callback = function(this: EventTarget, event: Event) {
          calls++;
          receiver = this === target && event.currentTarget === target && event.type === type;
          return false;
        };
        Reflect.set(target, name, callback);
        const identity = Reflect.get(target, name) === callback;
        const canceled = !target.dispatchEvent(new Event(type, { cancelable: true }));
        Reflect.set(target, name, null);
        target.dispatchEvent(new Event(type));
        return [kind, type, initiallyNull, identity, receiver, canceled, calls, Reflect.get(target, name) === null];
      }));
    }, selectionTypes)).toEqual(
      ['window', 'document', 'html', 'svg', 'mathml', 'body', 'frameset']
        .flatMap((kind) => selectionTypes.map((type) => [kind, type, true, true, true, true, 1, true])),
    );
  });

  it('installs branded accessors without extending base Element or ShadowRoot', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate((types: string[]) => {
      const prototypes = [Document.prototype, HTMLElement.prototype, SVGElement.prototype, MathMLElement.prototype];
      const accessors = prototypes.flatMap((prototype) => types.map((type) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the accessor's receiver validation.
        const { get, set, enumerable, configurable } = Object.getOwnPropertyDescriptor(prototype, 'on' + type)!;
        let rejects = false;
        try { Reflect.apply(get!, {}, []); } catch (error) { rejects = error instanceof TypeError; }
        return [get!.length, set!.length, enumerable, configurable, rejects];
      }));
      const generic = document.createElementNS('urn:example', 'element');
      return [accessors, types.map((type) => [
        'on' + type in Element.prototype, 'on' + type in ShadowRoot.prototype, 'on' + type in generic,
      ])];
    }, selectionTypes)).toEqual([
      Array.from({ length: 8 }, () => [0, 1, true, true, true]),
      [[false, false, false], [false, false, false]],
    ]);
  });

  it.each(['html', 'svg', 'mathml', 'body', 'frameset'])('compiles and removes %s content handlers on that element', async (kind) => {
    const browser = await createBrowser();
    expect(await browser.evaluate(({ kind, types }: { kind: string; types: string[]; }) => {
      const element = kind === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'g')
        : kind === 'mathml' ? document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi')
          : kind === 'body' ? document.body : document.createElement(kind === 'html' ? 'div' : kind);
      return types.map((type) => {
        const name = 'on' + type;
        element.setAttribute(name, 'this.setAttribute("data-result", event.type); return false;');
        const canceled = !element.dispatchEvent(new Event(type, { cancelable: true }));
        const local = Reflect.get(window, name) === null && Reflect.get(document, name) === null;
        const value = element.getAttribute('data-result');
        element.removeAttribute(name);
        element.removeAttribute('data-result');
        element.dispatchEvent(new Event(type));
        return [value, canceled, local, Reflect.get(element, name) === null, element.getAttribute('data-result')];
      });
    }, { kind, types: selectionTypes })).toEqual(selectionTypes.map((type) => [type, true, true, true, null]));
  });

  it('uses the receiver map for a setter borrowed from another Window', async () => {
    const first = await createBrowser();
    const second = await createBrowser();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Supply the receiver explicitly to the borrowed setter.
    const { set } = Object.getOwnPropertyDescriptor(second.window.Document.prototype, 'onselectionchange')!;
    let calls = 0;
    const callback = () => { calls++; };
    Reflect.apply(set!, first.document, [callback]);
    expect(first.document.onselectionchange).toBe(callback);
    first.document.dispatchEvent(new first.window.Event('selectionchange'));
    expect(calls).toBe(1);
    expect(second.document.onselectionchange).toBeNull();
  });

  it('erases property and content handlers through the existing target-wide erasure', async () => {
    const browser = await createBrowser();
    const element = browser.document.body!;
    let calls = 0;
    browser.document.onselectionchange = () => { calls++; };
    element.setAttribute('onselectstart', 'this.setAttribute("data-result", "called");');
    browser.document.dispatchEvent(new browser.window.Event('selectionchange'));
    element.dispatchEvent(new browser.window.Event('selectstart'));
    expect(calls).toBe(1);
    expect(element.getAttribute('data-result')).toBe('called');

    unwrap<DocumentImpl>(browser.document).eraseAllEventListenersAndHandlers();
    unwrap<ElementImpl>(element).eraseAllEventListenersAndHandlers();
    element.removeAttribute('data-result');
    browser.document.dispatchEvent(new browser.window.Event('selectionchange'));
    element.dispatchEvent(new browser.window.Event('selectstart'));
    expect(calls).toBe(1);
    expect(browser.document.onselectionchange).toBeNull();
    expect(Reflect.get(element, 'onselectstart')).toBeNull();
    expect(element.getAttribute('data-result')).toBeNull();
    expect(element.hasAttribute('onselectstart')).toBe(true);
  });

  it('permits Selection content attributes on ordinary, unfinished, custom, and unknown HTML elements', async () => {
    const browser = await createBrowser();
    for (const tag of ['article', 'input', 'textarea', 'body', 'frameset', 'x-widget', 'unknown']) {
      const element = unwrap<HTMLElementImpl>(browser.document.createElement(tag));
      for (const type of selectionTypes) expect(element.allowsContentAttribute('on' + type), tag + ': ' + type).toBe(true);
    }
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '<!doctype html><body></body>', reporting: false });
  await browser.navigate('https://selection.test/');
  return browser;
}
