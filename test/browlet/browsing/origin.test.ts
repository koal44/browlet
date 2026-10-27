import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { OriginConstructor } from '../../../src/browlet/platform';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { OriginImpl } from '../../../src/browlet/browsing/origin';
import { MessageEventImpl } from '../../../src/browlet/communication/message-event';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { getBindingContext, unwrap } from '../../support/browlet-binding';

describe('Origin interface', () => {
  it('extracts the current Window origin through its WindowProxy', async () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    const initial = proxy.Origin.from(proxy);
    expect(initial.opaque).toBe(true);
    expect(initial.isSameOrigin(proxy.Origin.from(proxy))).toBe(true);

    await browser.navigate('https://example.com/');
    expect(browser.window).toBe(proxy);
    expect(proxy.Origin.from(proxy).isSameOrigin(proxy.Origin.from('https://example.com/'))).toBe(true);
    expect(await browser.evaluate(() => {
      const Origin = Reflect.get(globalThis, 'Origin') as OriginConstructor;
      return Origin.from(globalThis).isSameOrigin(Origin.from('https://example.com/'));
    })).toBe(true);
  });

  it('rejects cross-origin globals and permits same-origin-domain globals', async () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    await first.navigate('https://www.example.com/');
    await second.navigate('https://shop.example.com/');
    const Origin = first.window.Origin;
    const TypeError = Reflect.get(first.window, 'TypeError') as typeof globalThis.TypeError;
    expect(() => Origin.from(second.window)).toThrow(TypeError);
    first.document.domain = 'example.com';
    expect(() => Origin.from(second.window)).toThrow(TypeError);
    second.document.domain = 'example.com';
    expect(Origin.from(second.window).isSameOrigin(Origin.from('https://shop.example.com/'))).toBe(true);
  });

  it('uses entry settings when calling a different realm\'s Origin.from', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://www.example.com/');
    const previousEnv = unwrap<DocumentImpl>(browser.document).env;
    const previousGlobal = previousEnv.global;
    const previousOrigin = browser.window.Origin;

    await browser.navigate('https://shop.example.com/');
    expect(unwrap<DocumentImpl>(browser.document).env.realm.agent).toBe(previousEnv.realm.agent);
    Reflect.set(browser.window, 'previousGlobal', previousGlobal);
    Reflect.set(browser.window, 'previousOrigin', previousOrigin);
    expect(await browser.evaluate(() => {
      const Origin = Reflect.get(globalThis, 'previousOrigin') as OriginConstructor;
      const previousGlobal = Reflect.get(globalThis, 'previousGlobal') as object;
      const PreviousTypeError = Reflect.get(previousGlobal, 'TypeError') as typeof TypeError;
      let rejected = false;
      try { Origin.from(previousGlobal); }
      catch (error) { rejected = error instanceof PreviousTypeError; }
      const current = Origin.from(globalThis);
      return [
        rejected,
        current.isSameOrigin(Origin.from('https://shop.example.com/')),
        Object.getPrototypeOf(current) === Origin.prototype,
      ];
    })).toEqual([true, true, true]);
  });

  it('does not conflate unrelated opaque globals', () => {
    const first = new Browlet({ route: () => '' }).window;
    const second = new Browlet({ route: () => '' }).window;
    expect(() => first.Origin.from(second)).toThrow(Reflect.get(first, 'TypeError'));
  });

  it('copies a MessageEvent internal origin without reparsing its exposed string', () => {
    const browser = new Browlet({ route: () => '' });
    const binding = getBindingContext(unwrap<DocumentImpl>(browser.document).env.realm);
    const origin = createOpaqueOrigin();
    const event = binding.project(MessageEventImpl, new MessageEventImpl('message', {}, 0, origin));
    const copy = browser.window.Origin.from(event);
    expect(Reflect.get(event, 'origin')).toBe('null');
    expect(unwrap<OriginImpl>(copy).extractOrigin()).toBe(origin);
    expect(copy.isSameOrigin(browser.window.Origin.from(event))).toBe(true);
    for (const value of [null, '', 'null', 'https://example.com/']) {
      const event = binding.project(MessageEventImpl, new MessageEventImpl('message', {}, 0, value));
      expect(Reflect.get(event, 'origin')).toBe(value ?? '');
      expect(() => browser.window.Origin.from(event)).toThrow(Reflect.get(browser.window, 'TypeError'));
    }
  });

  it.each(['a', 'area'])('rejects a %s with no hyperlink URL', (tag) => {
    const browser = new Browlet({ route: () => '' });
    expect(() => browser.window.Origin.from(browser.document.createElement(tag)))
      .toThrow(Reflect.get(browser.window, 'TypeError'));
  });

  it('constructs unique opaque origins', () => {
    const browlet = new Browlet({ route: () => '' });
    const Origin = browlet.window.Origin;
    const first = new Origin();
    const second = new Origin();

    expect(first).toBeInstanceOf(Origin);
    expect(first.opaque).toBe(true);
    expect(first.isSameOrigin(first)).toBe(true);
    expect(first.isSameOrigin(second)).toBe(false);
  });

  it('creates origins from strings and URL platform objects', () => {
    const browlet = new Browlet({ route: () => '' });
    const Origin = browlet.window.Origin;
    const URL = browlet.window.URL;
    const fromString = Origin.from('https://www.example.com/path');
    const fromURL = Origin.from(new URL('https://www.example.com/elsewhere'));
    const fromOrigin = Origin.from(fromString);
    const sameSite = Origin.from('https://shop.example.com/');

    expect(fromString.opaque).toBe(false);
    expect(fromString.isSameOrigin(fromURL)).toBe(true);
    expect(fromString.isSameOrigin(fromOrigin)).toBe(true);
    expect(fromString.isSameSite(sameSite)).toBe(true);
    expect(() => Origin.from({})).toThrow(Reflect.get(browlet.window, 'TypeError'));
  });

  it('projects origins returned by static operations into their realm', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const FirstOrigin = first.window.Origin;
    const SecondOrigin = second.window.Origin;

    const origin = SecondOrigin.from('https://www.example.com/');

    expect(origin).toBeInstanceOf(SecondOrigin);
    expect(origin).not.toBeInstanceOf(FirstOrigin);
  });

  it('preserves opaque identity when copying, but creates distinct platform objects', () => {
    const { Origin, URL } = new Browlet({ route: () => '' }).window;
    const opaque = new Origin();
    const copy = Origin.from(opaque);
    expect(copy).not.toBe(opaque);
    expect(copy.opaque).toBe(true);
    expect(copy.isSameOrigin(opaque)).toBe(true);
    expect(copy.isSameSite(opaque)).toBe(true);
    const url = new URL('data:text/plain,hello');
    expect(Origin.from(url).isSameOrigin(Origin.from(url))).toBe(false);
    expect(Origin.from('about:blank').isSameOrigin(Origin.from('about:blank'))).toBe(false);
  });

  it('captures a URL origin without following later URL changes', () => {
    const { Origin, URL } = new Browlet({ route: () => '' }).window;
    const url = new URL('https://EXAMPLE.com:443/first');
    const origin = Origin.from(url);
    url.href = 'https://other.com/';
    expect(origin.isSameOrigin(Origin.from('https://example.com/second'))).toBe(true);
    expect(origin.isSameOrigin(Origin.from(url))).toBe(false);
    expect(origin.isSameSite(Origin.from('http://example.com/'))).toBe(false);
  });

  it('unwraps supported objects across realms and projects into the called operation realm', () => {
    const first = new Browlet({ route: () => '' }).window;
    const second = new Browlet({ route: () => '' }).window;
    const original = new second.Origin();
    const copy = first.Origin.from(original);
    expect(copy).toBeInstanceOf(first.Origin);
    expect(copy).not.toBeInstanceOf(second.Origin);
    expect(copy.isSameOrigin(original)).toBe(true);
    expect(first.Origin.from(new second.URL('https://example.com/'))
      .isSameOrigin(second.Origin.from('https://example.com/'))).toBe(true);
  });

  it('rejects unsupported values without coercion and realizes errors in the operation realm', () => {
    const browser = new Browlet({ route: () => '' });
    const { Origin } = browser.window;
    const TypeError = Reflect.get(browser.window, 'TypeError') as typeof globalThis.TypeError;
    let coerced = false;
    const object = { toString() { coerced = true; return 'https://example.com/'; } };
    for (const value of [null, undefined, 1, true, Symbol(), object, new String('https://example.com/'),
      '/relative', 'not a URL', browser.document, Object.create(Origin.prototype)]) {
      expect(() => Origin.from(value)).toThrow(TypeError);
    }
    expect(coerced).toBe(false);
    const origin = new Origin();
    expect(() => { Reflect.apply(Reflect.get(origin, 'isSameOrigin'), {}, [origin]); }).toThrow(TypeError);
    expect(() => { Reflect.apply(Reflect.get(origin, 'isSameSite'), origin, [{}]); }).toThrow(TypeError);
  });

  it('does not inspect author properties or proxy traps during extraction', () => {
    const browser = new Browlet({ route: () => '' });
    const TypeError = Reflect.get(browser.window, 'TypeError') as typeof globalThis.TypeError;
    const trap = () => { throw new Error('Author code must not run'); };
    const proxy = new Proxy({}, { get: trap, getPrototypeOf: trap, has: trap });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const forged = Object.create(browser.window.HTMLAnchorElement.prototype) as object;
    const object = { get origin() { return trap(); }, extractOrigin: trap };
    for (const value of [proxy, revoked.proxy, forged, object]) {
      expect(() => browser.window.Origin.from(value)).toThrow(TypeError);
    }
  });
});
