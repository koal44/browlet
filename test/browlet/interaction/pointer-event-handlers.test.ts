import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { HTMLElement } from '../../../src/browlet/platform';
import type { DocumentImpl, ElementImpl } from '../../../src/browlet/dom/nodes/index';
import type { HTMLElementImpl } from '../../../src/browlet/dom/nodes/html/html-element';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/index';
import { PointerEventImpl, type PointerInputEventType } from '../../../src/browlet/interaction/events/index';
import { PointerEventStream } from '../../../src/browlet/interaction/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

const pointerTypes = [
  'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerrawupdate',
  'pointerup', 'pointercancel', 'pointerout', 'pointerleave', 'gotpointercapture', 'lostpointercapture',
];

describe('Pointer Events §5: GlobalEventHandlers', () => {
  it.each([true, false])('connects all includers with secure context = %s', async (secure) => {
    const browser = await createBrowser(secure);
    expect(await browser.evaluate(({ types, secure }: { types: string[]; secure: boolean; }) => {
      const targets: Record<string, EventTarget> = {
        window, document, html: document.createElement('div'),
        svg: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
        mathml: document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi'),
        body: document.body, frameset: document.createElement('frameset'),
      };
      return Object.entries(targets).flatMap(([kind, target]) => types.map((type) => {
        const name = `on${type}`;
        if (!secure && type === 'pointerrawupdate') return [kind, type, name in target];
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
        const canceled = !target.dispatchEvent(new PointerEvent(type, { cancelable: true }));
        Reflect.set(target, name, null);
        target.dispatchEvent(new PointerEvent(type));
        return [kind, type, initiallyNull, identity, receiver, canceled, calls, Reflect.get(target, name) === null];
      }));
    }, { types: pointerTypes, secure })).toEqual(
      ['window', 'document', 'html', 'svg', 'mathml', 'body', 'frameset'].flatMap((kind) => pointerTypes.map((type) =>
        !secure && type === 'pointerrawupdate'
          ? [kind, type, false]
          : [kind, type, true, true, true, true, 1, true]
      )),
    );
  });

  it('installs ordinary branded accessors on the includers, without extending base Element', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const result = [Document.prototype, HTMLElement.prototype, SVGElement.prototype, MathMLElement.prototype]
        .map((prototype) => {
          // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise receiver validation on the accessor.
          const { get, set, enumerable, configurable } = Object.getOwnPropertyDescriptor(prototype, 'onpointerenter')!;
          let rejects = false;
          try { Reflect.apply(get!, {}, []); } catch (error) { rejects = error instanceof TypeError; }
          return [get!.length, set!.length, enumerable, configurable, rejects];
        });
      return [result, 'onpointerdown' in Element.prototype,
        'onpointerdown' in document.createElementNS('urn:example', 'element')];
    })).toEqual([Array.from({ length: 4 }, () => [0, 1, true, true, true]), false, false]);
  });

  it.each(['html', 'svg', 'mathml', 'body', 'frameset'])('compiles and removes %s content handlers locally', async (kind) => {
    const browser = await createBrowser();
    expect(await browser.evaluate(({ kind, types }: { kind: string; types: string[]; }) => {
      const element = kind === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'g')
        : kind === 'mathml' ? document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi')
          : document.createElement(kind === 'html' ? 'div' : kind);
      return types.map((type) => {
        const name = `on${type}`;
        element.setAttribute(name, 'this.setAttribute("data-result", event.type); return false;');
        const canceled = !element.dispatchEvent(new PointerEvent(type, { cancelable: true }));
        const local = Reflect.get(window, name) === null;
        const value = element.getAttribute('data-result');
        element.removeAttribute(name);
        element.removeAttribute('data-result');
        element.dispatchEvent(new PointerEvent(type));
        return [value, canceled, local, Reflect.get(element, name) === null, element.getAttribute('data-result')];
      });
    }, { kind, types: pointerTypes })).toEqual(pointerTypes.map((type) => [type, true, true, true, null]));
  });

  it('keeps insecure raw content handlers separate from a plain JavaScript expando', async () => {
    const browser = await createBrowser(false);
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      let propertyCalls = 0;
      Reflect.set(element, 'onpointerrawupdate', () => { propertyCalls++; });
      element.setAttribute('onpointerrawupdate', 'this.setAttribute("data-result", event.type); return false;');
      const canceled = !element.dispatchEvent(new Event('pointerrawupdate', { cancelable: true }));
      const contentValue = element.getAttribute('data-result');
      element.removeAttribute('onpointerrawupdate');
      element.removeAttribute('data-result');
      const accepted = element.dispatchEvent(new Event('pointerrawupdate', { cancelable: true }));
      return [propertyCalls, canceled, contentValue, accepted, element.getAttribute('data-result'),
        typeof Reflect.get(element, 'onpointerrawupdate'), 'onpointerrawupdate' in HTMLElement.prototype];
    })).toEqual([0, true, 'pointerrawupdate', true, null, 'function', false]);
  });

  it('retains the existing CSP gate for pointer content attributes', async () => {
    const browser = await createBrowser();
    getRelevantRealm(browser.window).getAssociatedDocument().policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse("script-src-attr 'none'", 'header', 'enforce'),
    );
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.setAttribute('onpointerdown', 'this.id = "blocked";');
      element.dispatchEvent(new PointerEvent('pointerdown'));
      const blocked = [element.id, element.onpointerdown];
      element.onpointerdown = () => { element.id = 'callback'; };
      element.dispatchEvent(new PointerEvent('pointerdown'));
      return [blocked, element.id];
    })).toEqual([['', null], 'callback']);
  });

  it('uses the receiver map when a pointer setter is borrowed across Windows', async () => {
    const browser = await createBrowser();
    const other = await createBrowser();
    const element = browser.document.createElement('div') as HTMLElement;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the borrowed setter with its explicit receiver.
    const { set } = Object.getOwnPropertyDescriptor(other.window.HTMLElement.prototype, 'onpointerdown')!;
    let calls = 0;
    const callback = () => { calls++; };
    Reflect.apply(set!, element, [callback]);
    expect(element.onpointerdown).toBe(callback);
    element.dispatchEvent(new browser.window.PointerEvent('pointerdown'));
    expect(calls).toBe(1);
    expect(other.document.body!.onpointerdown).toBeNull();
  });

  it('routes native input and capture notifications through the same handler map', async () => {
    const browser = await createBrowser();
    const document = unwrap<DocumentImpl>(browser.document);
    const a = browser.document.createElement('div') as HTMLElement;
    const b = browser.document.createElement('div') as HTMLElement;
    browser.document.body!.append(a, b);
    const aImpl = unwrap<ElementImpl>(a);
    const bImpl = unwrap<ElementImpl>(b);
    const stream = new PointerEventStream(7, false, true, () => false);
    document.getNodeNavigable()!.topLevelTraversable.pointerEventStreams.set(7, stream);
    const trace: string[] = [];
    a.onpointerdown = () => { a.setPointerCapture(7); trace.push('down'); };
    a.ongotpointercapture = () => { trace.push('gain'); };
    a.onpointermove = () => { trace.push('move'); };
    a.onpointerup = () => { trace.push('up'); };
    a.onlostpointercapture = () => { trace.push('loss'); };
    const send = (type: PointerInputEventType, buttons: number, hit: ElementImpl) => {
      const input = new PointerEventImpl(type, { buttons, pointerType: 'mouse' });
      const target = stream.prepareTarget(type, input, () => hit);
      const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
      event.copyInputFrom(input);
      event.setPointerEventAttributes(type);
      stream.dispatchToTarget(event, target, () => hit, 1);
    };
    send('pointerdown', 1, aImpl);
    send('pointermove', 1, bImpl);
    send('pointerup', 0, bImpl);
    expect(trace).toEqual(['down', 'gain', 'move', 'up', 'loss']);
    aImpl.eraseAllEventListenersAndHandlers();
    expect(a.onpointerdown).toBeNull();
    expect(a.ongotpointercapture).toBeNull();
    send('pointerdown', 1, aImpl);
    expect(trace).toEqual(['down', 'gain', 'move', 'up', 'loss']);
  });

  it('permits pointer content attributes on ordinary, unfinished, custom, and unknown HTML elements', async () => {
    const browser = await createBrowser();
    for (const tag of ['article', 'input', 'body', 'frameset', 'x-widget', 'unknown']) {
      const element = unwrap<HTMLElementImpl>(browser.document.createElement(tag));
      for (const type of pointerTypes) expect(element.allowsContentAttribute(`on${type}`), `${tag}: ${type}`).toBe(true);
    }
  });
});

async function createBrowser(secure = true) {
  const browser = new Browlet({ route: () => '<!doctype html><body></body>', reporting: false });
  await browser.navigate(`${secure ? 'https' : 'http'}://pointer.test/`);
  return browser;
}
