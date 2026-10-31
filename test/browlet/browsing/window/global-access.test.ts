/* eslint-disable @typescript-eslint/unbound-method -- Deliberately inspect and borrow Window accessors and methods. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import { serializeURL } from '../../../../src/url/index';
import { itPassesWith } from '../../../test-runtime';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

// Approved addon-disabled gaps: automatic caller selection and native global ownership.
const testWindow = itPassesWith('nativeGlobals');

describe('native Window guard through real HTML bindings', () => {
  for (const warmed of [false, true]) {
    testWindow(`denies direct and borrowed foreign Document access with ${warmed ? 'warm' : 'cold'} ordinary lookup`, async () => {
      const { caller, target } = await pair();
      if (warmed) {
        expect(await target.evaluate(() => {
          let result = 0;
          for (let i = 0; i < 1000; i++) result = window.document.nodeType;
          return result;
        })).toBe(9);
      }
      expect(await caller.evaluate(() => {
        const target = Reflect.get(window, 'foreignWindow') as Window;
        const getter = Object.getOwnPropertyDescriptor(window, 'document')!.get!;
        const outcome = (read: () => unknown) => {
          try { read(); return ['returned', false]; }
          catch (error) { return [(error as Error).name, error instanceof DOMException]; }
        };
        return [outcome(() => target.document), outcome(() => Reflect.apply(getter, target, []))];
      })).toEqual([['SecurityError', true], ['SecurityError', true]]);
    });
  }

  testWindow('permits foreign methods and caller-owned accessor descriptors while hiding expandos', async () => {
    const { caller, target } = await pair();
    await target.evaluate(() => { Reflect.set(window, 'secret', 42); });
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as Window;
      const descriptor = Object.getOwnPropertyDescriptor(foreign, 'self')!;
      let error = '';
      try { Reflect.get(foreign, 'secret'); } catch (value) { error = (value as Error).name; }
      return [typeof foreign.postMessage, Object.getPrototypeOf(foreign.postMessage) === Function.prototype,
        Object.getPrototypeOf(descriptor.get) === Function.prototype, descriptor.configurable,
        Reflect.ownKeys(foreign).includes('secret'), error];
    })).toEqual(['function', true, true, true, false, 'SecurityError']);
  });

  it('preserves allowed author accessor and data-property receivers', async () => {
    const { caller, target } = await pair('https://same.test/one', 'https://same.test/two');
    await target.evaluate(() => {
      Object.defineProperty(window, 'authorReceiver', {
        get(this: object) { return this; }, set(this: object, value: unknown) { Reflect.set(this, 'seen', value); }, configurable: true,
      });
      Reflect.set(window, 'data', 3);
    });
    expect(await caller.evaluate((): unknown[] => {
      const foreign = Reflect.get(window, 'foreignWindow') as Window;
      const receiver = {};
      Reflect.set(foreign, 'authorReceiver', 7, receiver);
      Reflect.set(foreign, 'data', 9, receiver);
      const derived = Object.create(foreign) as object;
      return [Reflect.get(foreign, 'authorReceiver', receiver) === receiver,
        Reflect.get(receiver, 'seen'), Reflect.get(receiver, 'data'), Reflect.get(foreign, 'data'),
        Reflect.get(derived, 'authorReceiver') === derived];
    })).toEqual([true, 7, 9, 3, true]);
  });

  testWindow('reevaluates live origin policy when a stable WindowProxy is navigated', async () => {
    const { caller, target } = await pair();
    const proxy = target.window;
    expect(await caller.evaluate(() => {
      try { void (Reflect.get(window, 'foreignWindow') as Window).document; return true; }
      catch (error) { return (error as Error).name; }
    })).toBe('SecurityError');
    await target.navigate('https://caller.test/now-shared');
    expect(target.window).toBe(proxy);
    Reflect.set(caller.window, 'expectedDocument', target.document);
    expect(await caller.evaluate(() =>
      (Reflect.get(window, 'foreignWindow') as Window).document === Reflect.get(window, 'expectedDocument'))).toBe(true);
  });

  testWindow('keeps retired bare bindings when the public WindowProxy becomes foreign', async () => {
    const browser = new Browlet({ route: () => '' });
    const originalDocument = browser.document;
    const originalRealm = getRelevantRealm(originalDocument);
    // Exercise the old global environment record, including data and IDL attributes.
    const retained = originalRealm.evaluate(`
      var ownerCount = 1;
      ({ increment: () => ++ownerCount, document: () => document, proxy: () => globalThis });
    `, 'retired-bindings.js') as { increment(): number; document(): Document; proxy(): object; };
    await browser.navigate('https://replacement.test/');

    expect(retained.increment()).toBe(2);
    expect(retained.document()).toBe(originalDocument);
    expect(retained.proxy()).toBe(browser.window);
  });

  it('selects the executing B realm when A calls B to access C', async () => {
    const { caller, target } = await pair();
    const intermediary = new Browlet({ route: () => '' });
    await intermediary.navigate('https://target.test/intermediary');
    Reflect.set(intermediary.window, 'foreignWindow', target.window);
    await intermediary.evaluate(() => {
      Reflect.set(window, 'readForeign', () => (Reflect.get(window, 'foreignWindow') as Window).document.URL);
    });
    Reflect.set(caller.window, 'readForeign', Reflect.get(intermediary.window, 'readForeign'));
    expect(await caller.evaluate(() => (Reflect.get(window, 'readForeign') as () => string)())).toBe('https://target.test/');
  });

  it('selects borrowed B Reflect.get rather than A or target C', async () => {
    const { caller } = await pair();
    const intermediary = new Browlet({ route: () => '' });
    await intermediary.navigate('https://target.test/intermediary');
    Reflect.set(caller.window, 'borrowedGet', getRelevantRealm(intermediary.document).evaluate('Reflect.get', 'borrowed-reflect.js'));
    expect(await caller.evaluate(() => {
      const get = Reflect.get(window, 'borrowedGet') as typeof Reflect.get;
      return (get(Reflect.get(window, 'foreignWindow') as object, 'document') as Document).URL;
    })).toBe('https://target.test/');
  });

  it('returns the foreign public WindowProxy through its self accessor', async () => {
    const { caller } = await pair();
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as Window;
      return foreign.self === foreign;
    })).toBe(true);
  });

  // SPEC_CLASH(window-foreign-receiver): Follow Chromium's target receiver for
  // foreign property access; HTML/Firefox/WebKit use the supplied receiver.
  testWindow('uses the target for foreign getters with explicit receivers', async () => {
    const { caller } = await pair();
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as Window;
      return [window, {}, Object.create(foreign) as object, 17, null, undefined]
        .map((receiver) => Reflect.get(foreign, 'self', receiver) === foreign);
    })).toEqual([true, true, true, true, true, true]);
  });

  testWindow.each(['implicit', 'window', 'object', 'derived', 'primitive', 'null', 'undefined'] as const)(
    'hands a foreign Location write to its target with receiver kind %s', async (kind) => {
      const { caller, target } = await pair();
      const callerDocument = unwrap<DocumentImpl>(caller.document);
      const targetDocument = unwrap<DocumentImpl>(target.document);
      // Definite navigation is unfinished; observe its real implementation entry point.
      const callerNavigate = vi.spyOn(callerDocument.getNodeNavigable()!, 'navigate').mockImplementation(() => {});
      const targetNavigate = vi.spyOn(targetDocument.getNodeNavigable()!, 'navigate').mockImplementation(() => {});
      expect(await caller.evaluate((kind) => {
        const foreign = Reflect.get(window, 'foreignWindow') as Window;
        if (kind === 'implicit') return Reflect.set(foreign, 'location', 'https://destination.test/next');
        const receiver = {
          window, object: {}, derived: Object.create(foreign) as object, primitive: 17, null: null, undefined,
        }[kind];
        return Reflect.set(foreign, 'location', 'https://destination.test/next', receiver);
      }, kind)).toBe(true);
      expect(callerNavigate).not.toHaveBeenCalled();
      expect(targetNavigate).toHaveBeenCalledOnce();
      const [url, source, options] = targetNavigate.mock.calls[0]!;
      expect(serializeURL(url)).toBe('https://destination.test/next');
      expect(source).toBe(callerDocument);
      expect(options).toMatchObject({ exceptionsEnabled: true });
    },
  );

  testWindow('preserves the receiver and brand checks when a reflected foreign getter is called', async () => {
    const { caller } = await pair();
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as Window;
      const getter = Object.getOwnPropertyDescriptor(foreign, 'self')!.get!;
      const ownWindow = Reflect.apply(getter, window, []) === window;
      try { Reflect.apply(getter, {}, []); }
      catch (error) { return [ownWindow, (error as Error).name, error instanceof TypeError]; }
      return [ownWindow, 'returned', false];
    })).toEqual([true, 'TypeError', true]);
  });

  it.each(['same-origin property', 'reflected foreign setter'] as const)(
    'preserves the supplied Window receiver for a %s', async (kind) => {
      const { caller, target } = await pair('https://caller.test/',
        kind === 'same-origin property' ? 'https://caller.test/other' : 'https://target.test/');
      const callerDocument = unwrap<DocumentImpl>(caller.document);
      const targetDocument = unwrap<DocumentImpl>(target.document);
      const callerNavigate = vi.spyOn(callerDocument.getNodeNavigable()!, 'navigate').mockImplementation(() => {});
      const targetNavigate = vi.spyOn(targetDocument.getNodeNavigable()!, 'navigate').mockImplementation(() => {});
      await caller.evaluate((kind) => {
        const foreign = Reflect.get(window, 'foreignWindow') as Window;
        if (kind === 'same-origin property') Reflect.set(foreign, 'location', 'https://destination.test/next', window);
        else Reflect.apply(Object.getOwnPropertyDescriptor(foreign, 'location')!.set!, window, ['https://destination.test/next']);
      }, kind);
      expect(targetNavigate).not.toHaveBeenCalled();
      expect(callerNavigate).toHaveBeenCalledOnce();
      expect(serializeURL(callerNavigate.mock.calls[0]![0])).toBe('https://destination.test/next');
      expect(callerNavigate.mock.calls[0]![1]).toBe(callerDocument);
    },
  );

  testWindow('exposes a null foreign prototype and remains extensible', async () => {
    const { caller } = await pair();
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as object;
      return [Reflect.getPrototypeOf(foreign), Reflect.isExtensible(foreign)];
    })).toEqual([null, true]);
  });

  // SPEC_CLASH(window-foreign-prototype): Follow Chromium's SecurityError for
  // foreign mutations. HTML/Firefox/WebKit accept null and reject prevention with false.
  testWindow.each(['reflect-null', 'reflect-object', 'object-null', 'object-object',
    'reflect-prevent', 'object-prevent', 'seal', 'freeze'] as const)(
    'rejects foreign %s with a caller-owned SecurityError', async (operation) => {
      const { caller } = await pair();
      expect(await caller.evaluate((operation) => {
        const foreign = Reflect.get(window, 'foreignWindow') as object;
        try {
          switch (operation) {
            case 'reflect-null': Reflect.setPrototypeOf(foreign, null); break;
            case 'reflect-object': Reflect.setPrototypeOf(foreign, {}); break;
            case 'object-null': Object.setPrototypeOf(foreign, null); break;
            case 'object-object': Object.setPrototypeOf(foreign, {}); break;
            case 'reflect-prevent': Reflect.preventExtensions(foreign); break;
            case 'object-prevent': Object.preventExtensions(foreign); break;
            case 'seal': Object.seal(foreign); break;
            case 'freeze': Object.freeze(foreign); break;
          }
        } catch (error) {
          return [(error as Error).name, error instanceof DOMException,
            Object.getPrototypeOf(error) === DOMException.prototype,
            Reflect.getPrototypeOf(foreign), Reflect.isExtensible(foreign)];
        }
        return ['returned'];
      }, operation)).toEqual(['SecurityError', true, true, null, true]);
    },
  );

  testWindow.each(['setPrototypeOf', 'preventExtensions'] as const)(
    'uses borrowed B Reflect.%s for the denial realm when called from A', async (operation) => {
      const { caller } = await pair();
      const intermediary = new Browlet({ route: () => '' });
      await intermediary.navigate('https://intermediary.test/');
      Reflect.set(caller.window, 'borrowedReflect', Reflect.get(intermediary.window, 'Reflect'));
      Reflect.set(caller.window, 'borrowedDOMException', intermediary.window.DOMException);
      expect(await caller.evaluate((operation) => {
        const foreign = Reflect.get(window, 'foreignWindow') as object;
        const borrowed = Reflect.get(window, 'borrowedReflect') as typeof Reflect;
        const Exception = Reflect.get(window, 'borrowedDOMException') as typeof DOMException;
        try {
          if (operation === 'setPrototypeOf') borrowed.setPrototypeOf(foreign, null);
          else borrowed.preventExtensions(foreign);
        } catch (error) {
          return [(error as Error).name, Object.getPrototypeOf(error) === Exception.prototype,
            Object.getPrototypeOf(error) === DOMException.prototype];
        }
        return ['returned'];
      }, operation)).toEqual(['SecurityError', true, false]);
    },
  );
});

async function pair(callerURL = 'https://caller.test/', targetURL = 'https://target.test/') {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  await caller.navigate(callerURL);
  await target.navigate(targetURL);
  Reflect.set(caller.window, 'foreignWindow', target.window);
  return { caller, target };
}
