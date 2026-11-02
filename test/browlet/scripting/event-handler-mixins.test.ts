import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

// HTML §8.1.8.2's event types, including the case-sensitive legacy names.
const globalTypes = [
  'abort', 'auxclick', 'beforeinput', 'beforematch', 'beforetoggle', 'blur', 'cancel', 'canplay',
  'canplaythrough', 'change', 'click', 'close', 'command', 'contextlost', 'contextmenu', 'contextrestored',
  'copy', 'cuechange', 'cut', 'dblclick', 'drag', 'dragend', 'dragenter', 'dragleave', 'dragover',
  'dragstart', 'drop', 'durationchange', 'emptied', 'ended', 'error', 'focus', 'formdata', 'input',
  'invalid', 'keydown', 'keypress', 'keyup', 'load', 'loadeddata', 'loadedmetadata', 'loadstart',
  'mousedown', 'mouseenter', 'mouseleave', 'mousemove', 'mouseout', 'mouseover', 'mouseup', 'paste',
  'pause', 'play', 'playing', 'progress', 'ratechange', 'reset', 'resize', 'scroll', 'scrollend',
  'securitypolicyviolation', 'seeked', 'seeking', 'select', 'slotchange', 'stalled', 'submit', 'suspend',
  'timeupdate', 'toggle', 'volumechange', 'waiting', 'webkitAnimationEnd', 'webkitAnimationIteration',
  'webkitAnimationStart', 'webkitTransitionEnd', 'wheel',
];
const windowTypes = [
  'afterprint', 'beforeprint', 'beforeunload', 'hashchange', 'languagechange', 'message', 'messageerror', 'offline',
  'online', 'pagehide', 'pagereveal', 'pageshow', 'pageswap', 'popstate', 'rejectionhandled', 'storage',
  'unhandledrejection', 'unload',
];

describe('HTML event-handler mixins', () => {
  it.each(['Window', 'Document', 'HTMLElement', 'SVGElement', 'MathMLElement'])(
    'connects every GlobalEventHandlers attribute on %s', async (kind) => {
      const browser = await createBrowser();
      expect(await browser.evaluate(({ kind, types }: { kind: string; types: string[]; }) => {
        const targets: Record<string, EventTarget> = {
          Window: window, Document: document, HTMLElement: document.createElement('div'),
          SVGElement: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
          MathMLElement: document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi'),
        };
        const target = targets[kind]!;
        return types.map((type) => {
          const name = `on${type.toLowerCase()}`;
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
          return [name, initiallyNull, identity, canceled, receiver, calls, Reflect.get(target, name) === null];
        });
      }, { kind, types: globalTypes })).toEqual(globalTypes.map((type) => [
        // HTML activates an ordinary listener; DOM defaults wheel to passive on Window and Document.
        `on${type.toLowerCase()}`, true, true, !(type === 'wheel' && (kind === 'Window' || kind === 'Document')), true, 1, true,
      ]));
    },
  );

  it.each(['window', 'body', 'frameset'])(
    'connects WindowEventHandlers through %s without sharing ordinary element handlers', async (kind) => {
      const browser = await createBrowser();
      expect(await browser.evaluate(({ kind, types }: { kind: string; types: string[]; }) => {
        const target = kind === 'window' ? window : document.createElement(kind);
        const element = document.createElement('div');
        return types.map((type) => {
          const name = `on${type}`;
          let calls = 0;
          const callback = function(this: Window, event: Event) {
            if (this === window && event.currentTarget === window) calls++;
          };
          const initiallyNull = Reflect.get(target, name) === null;
          Reflect.set(target, name, callback);
          const shared = Reflect.get(window, name) === callback && Reflect.get(target, name) === callback;
          if (target !== window) target.dispatchEvent(new Event(type));
          window.dispatchEvent(new Event(type));
          Reflect.set(target, name, null);
          return [initiallyNull, shared, calls, Reflect.get(window, name) === null, name in element];
        });
      }, { kind, types: windowTypes })).toEqual(windowTypes.map(() => [true, true, 1, true, false]));
    },
  );

  it('keeps Document-only handlers off elements and Window', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      document.onvisibilitychange = (event) => { trace.push(event.type); };
      document.onreadystatechange = (event) => { trace.push(event.type); };
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('readystatechange'));
      return [trace, 'onvisibilitychange' in window, 'onreadystatechange' in window,
        'onvisibilitychange' in document.createElement('div'), 'onreadystatechange' in document.createElement('script')];
    })).toEqual([['visibilitychange', 'readystatechange'], false, false, false, false]);
  });

  it('applies LegacyLenientThis only to mouseenter, mouseleave, and readystatechange', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const wrong = {};
      const results = [
        [HTMLElement.prototype, 'onmouseenter'], [HTMLElement.prototype, 'onmouseleave'],
        [Document.prototype, 'onreadystatechange'],
      ].map(([prototype, name]) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the accessors with an explicit receiver.
        const { get, set } = Object.getOwnPropertyDescriptor(prototype, name as string)!;
        return [Reflect.apply(get!, wrong, []) === undefined, Reflect.apply(set!, wrong, [null]) === undefined];
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the accessor with an explicit receiver.
      const { get } = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onmousedown')!;
      let rejects = false;
      try { Reflect.apply(get!, wrong, []); } catch (error) { rejects = error instanceof TypeError; }
      return [results, rejects, Object.keys(wrong)];
    })).toEqual([[[true, true], [true, true], [true, true]], true, []]);
  });

  it('compiles new content handlers, preserves legacy event-type case, and forwards body load', async () => {
    const browser = new Browlet({
      route: () => '<body onload="globalThis.loaded = this === window;">' +
        '<div id="target" oninput="this.title = event.type; return false;" ' +
        'onwebkitanimationend="this.title = event.type;"></div></body>', reporting: false,
    });
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(() => {
      const element = document.getElementById('target')!;
      const result = element.dispatchEvent(new Event('input', { cancelable: true }));
      const input = element.getAttribute('title');
      element.dispatchEvent(new Event('webkitanimationend'));
      const wrongCase = element.getAttribute('title');
      element.dispatchEvent(new Event('webkitAnimationEnd'));
      dispatchEvent(new Event('load'));
      return [result, input, wrongCase, element.getAttribute('title'), Reflect.get(window, 'loaded') as unknown,
        document.body.onload === window.onload];
    })).toEqual([false, 'input', 'input', 'webkitAnimationEnd', true, true]);
  });

  it.each(['http://www.w3.org/2000/svg', 'http://www.w3.org/1998/Math/MathML'])(
    'compiles, clears, and adopts content handlers in %s', async (namespace) => {
      const browser = await createBrowser();
      expect(await browser.evaluate((namespace: string) => {
        const inactive = document.implementation.createHTMLDocument();
        const element = inactive.createElementNS(namespace, 'a');
        element.setAttribute('oninput', 'this.setAttribute("result", event.type); return false;');
        const dormant = Reflect.get(element, 'oninput') === null;
        document.adoptNode(element);
        const result = element.dispatchEvent(new Event('input', { cancelable: true }));
        const callback = Reflect.get(element, 'oninput') as (event: Event) => unknown;
        const cloned = element.cloneNode() as Element;
        const cloneResult = cloned.dispatchEvent(new Event('input', { cancelable: true }));
        element.removeAttribute('oninput');
        return [dormant, result, element.getAttribute('result'), callback.name,
          Object.getPrototypeOf(callback) === Function.prototype,
          Reflect.get(element, 'oninput') === null, cloneResult, cloned.getAttribute('result')];
      }, namespace)).toEqual([true, false, 'input', 'oninput', true, true, false, 'input']);
    },
  );
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/');
  return browser;
}
