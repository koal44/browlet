import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation/api/navigate-event';
import { NavigationDestinationImpl } from '../../../src/browlet/browsing/navigation/api/navigation-destination';
import type { NavigateEvent as BrowletNavigateEvent } from '../../../src/browlet/platform';
import { project, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('NavigateEvent interception', () => {
  it('exposes ordinary methods and a nonconstructible precommit controller', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(NavigateEvent.prototype, 'intercept')!;
      let constructorError = false;
      try { Reflect.construct(NavigationPrecommitController, []); } catch (error) { constructorError = error instanceof TypeError; }
      const controller = NavigationPrecommitController.prototype;
      return {
        interceptLength: NavigateEvent.prototype.intercept.length, scrollLength: NavigateEvent.prototype.scroll.length,
        writable: descriptor.writable, enumerable: descriptor.enumerable, configurable: descriptor.configurable,
        constructorError, redirectLength: controller.redirect.length, addHandlerLength: controller.addHandler.length,
      };
    })).toEqual({
      interceptLength: 0, scrollLength: 0, writable: true, enumerable: true, configurable: true,
      constructorError: true, redirectLength: 1, addHandlerLength: 1,
    });
  });

  it('starts with empty handler lists, no interception, and no explicit focus/scroll choices', async () => {
    const { event } = await fixture();
    expect(event).toMatchObject({
      interceptionState: 'none', navigationPrecommitHandlerList: [], navigationHandlerList: [],
      focusResetBehavior: null, scrollBehavior: null, classicHistoryAPIState: null,
    });
  });

  it('reads dictionary members in IDL order before rejecting an untrusted event', async () => {
    const { browser, event } = await fixture();
    event.isTrusted = false;
    expect(await browser.evaluate(() => {
      const event = (window as unknown as TestWindow).navigateEventForTest;
      const order: string[] = [];
      try {
        event.intercept({
          get precommitHandler() { order.push('precommitHandler'); return async () => {}; },
          get handler() { order.push('handler'); return async () => {}; },
          get focusReset() { order.push('focusReset'); return 'manual' as const; },
          get scroll() { order.push('scroll'); return 'manual' as const; },
        });
      } catch (error) { return { order, name: (error as Error).name, realm: error instanceof DOMException }; }
      return null;
    })).toEqual({ order: ['focusReset', 'handler', 'precommitHandler', 'scroll'], name: 'SecurityError', realm: true });
    expect(event.interceptionState).toBe('none');
  });

  it('rejects invalid callbacks and enums during conversion, before the event checks', async () => {
    const { browser, event } = await fixture();
    event.isTrusted = false;
    expect(await browser.evaluate(() => {
      const event = (window as unknown as TestWindow).navigateEventForTest;
      return [{ handler: null }, { handler: {} }, { precommitHandler: 1 }, { precommitHandler: null },
        { focusReset: 'invalid' }, { scroll: null }].map((options) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Invalid IDL input with the original receiver.
        try { Reflect.apply(event.intercept, event, [options]); } catch (error) { return error instanceof TypeError; }
        return false;
      });
    })).toEqual(Array<boolean>(6).fill(true));
  });

  it('checks receiver brands before converting options', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      let touched = false;
      const options = { get handler() { touched = true; return async () => {}; } };
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately invalid receiver.
      try { Reflect.apply(NavigateEvent.prototype.intercept, {}, [options]); }
      catch (error) { return { touched, typeError: error instanceof TypeError }; }
      return null;
    })).toEqual({ touched: false, typeError: true });
  });

  it('accumulates handlers, replaces only supplied choices, and does not invoke callbacks during registration', async () => {
    const { browser, navigation: navigationImpl, event } = await fixture();
    await browser.evaluate(() => {
      const fixture = window as unknown as TestWindow;
      fixture.handlerCalls = 0;
      navigation.addEventListener('navigate', (raw) => {
        const event = raw as BrowletNavigateEvent;
        const handler = () => { fixture.handlerCalls!++; return Promise.resolve(); };
        event.intercept({ handler, precommitHandler: handler, focusReset: 'manual', scroll: 'manual' });
        event.intercept({ handler, precommitHandler: handler });
        event.intercept({ focusReset: 'after-transition' });
        event.intercept({ scroll: 'after-transition' });
        event.intercept();
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Web IDL treats null as an empty dictionary.
        Reflect.apply(event.intercept, event, [null]);
      }, { once: true });
    });
    expect(navigationImpl.dispatch(event)).toBe(true);
    expect(event.interceptionState).toBe('intercepted');
    expect(event.navigationHandlerList).toHaveLength(2);
    expect(event.navigationPrecommitHandlerList).toHaveLength(2);
    expect(event.focusResetBehavior).toBe('after-transition');
    expect(event.scrollBehavior).toBe('after-transition');
    expect(await browser.evaluate(() => (window as unknown as TestWindow).handlerCalls)).toBe(0);
  });

  it('rejects a noncancelable precommit registration without changing earlier accepted state', async () => {
    const { navigation, event, platform } = await fixture();
    event.cancelable = false;
    let failure: unknown;
    navigation.addEventListener('navigate', () => {
      platform.intercept({ focusReset: 'manual', handler: async () => {} });
      try {
        platform.intercept({
          precommitHandler: async () => {}, handler: async () => {}, focusReset: 'after-transition', scroll: 'manual',
        });
      } catch (error) { failure = error; }
    });
    navigation.dispatch(event);
    expect(failure).toMatchObject({ name: 'InvalidStateError' });
    expect(event).toMatchObject({ interceptionState: 'intercepted', focusResetBehavior: 'manual', scrollBehavior: null });
    expect(event.navigationPrecommitHandlerList).toHaveLength(0);
    expect(event.navigationHandlerList).toHaveLength(1);
  });

  it('accepts an empty interception on a noncancelable event', async () => {
    const { navigation, event, platform } = await fixture();
    event.cancelable = false;
    let failure: unknown;
    navigation.addEventListener('navigate', () => { try { platform.intercept(); } catch (error) { failure = error; } });
    navigation.dispatch(event);
    expect(failure).toBeUndefined();
    expect(event.interceptionState).toBe('intercepted');
  });

  it('checks trust before cancellation, then cancellation before interceptability', async () => {
    const { event, platform } = await fixture();
    event.isTrusted = false;
    event.defaultPrevented = true;
    event.canIntercept = false;
    expect(() => platform.intercept()).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(() => platform.scroll()).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    event.isTrusted = true;
    expect(() => platform.intercept()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => platform.scroll()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    event.defaultPrevented = false;
    expect(() => platform.intercept()).toThrow(expect.objectContaining({ name: 'SecurityError' }));
  });

  it('requires dispatch even for a trusted, interceptable event', async () => {
    const { navigation, event, platform } = await fixture();
    expect(() => platform.intercept()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    navigation.addEventListener('navigate', () => { platform.intercept(); });
    navigation.dispatch(event);
    expect(event.interceptionState).toBe('intercepted');
    expect(() => platform.intercept()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('honors cancellation performed by an options getter before registration', async () => {
    const { navigation, event, platform } = await fixture();
    let failure: unknown;
    navigation.addEventListener('navigate', () => {
      try { platform.intercept({ get handler() { platform.preventDefault(); return async () => {}; } }); }
      catch (error) { failure = error; }
    });
    expect(navigation.dispatch(event)).toBe(false);
    expect(failure).toMatchObject({ name: 'InvalidStateError' });
    expect(event.interceptionState).toBe('none');
    expect(event.navigationHandlerList).toHaveLength(0);
  });

  it('checks the receiver Document activity before trust, including with a borrowed method', async () => {
    const { browser, event, platform } = await fixture();
    event.isTrusted = false;
    await browser.navigate('https://example.test/replacement');
    // The receiver belongs to the retired Window; borrowing the replacement method cannot reactivate it.
    expect(() => browser.window.NavigateEvent.prototype.intercept.call(platform))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => browser.window.NavigateEvent.prototype.scroll.call(platform))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('uses the receiver Document for checks but the borrowed method realm for its exception', async () => {
    const { navigation, event, platform } = await fixture();
    const foreign = new Browlet({ route: () => '' });
    const methodOwner = foreign.window;
    const exceptionConstructor = methodOwner.DOMException;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow across navigation and realms.
    const method = methodOwner.NavigateEvent.prototype.intercept;
    await foreign.navigate('https://example.test/other');
    let failure: unknown;
    navigation.addEventListener('navigate', () => { try { method.call(platform); } catch (error) { failure = error; } });
    navigation.dispatch(event);
    expect(failure).toBeUndefined();
    expect(event.interceptionState).toBe('intercepted');
    try { method.call(platform); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ name: 'InvalidStateError' });
    expect(failure).toBeInstanceOf(exceptionConstructor);
    expect(failure).not.toBeInstanceOf(foreign.window.DOMException);
  });
});

describe('NavigateEvent scrolling boundary', () => {
  it.each(['none', 'intercepted', 'scrolled', 'finished'] as const)('rejects the %s interception state', async (state) => {
    const { event, platform } = await fixture();
    event.interceptionState = state;
    expect(() => platform.scroll()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(event.interceptionState).toBe(state);
  });

  it('delegates committed scroll requests without checking dispatch, interception permission, or the manual choice', async () => {
    const { event, platform } = await fixture();
    event.interceptionState = 'committed';
    event.canIntercept = false;
    event.scrollBehavior = 'manual';
    const process = vi.spyOn(event, 'processScrollBehavior').mockImplementation(() => {});
    platform.scroll();
    expect(process).toHaveBeenCalledOnce();
  });

  it('marks scroll processing before reaching the explicit missing fragment-selection dependency', async () => {
    const { event, platform } = await fixture();
    event.interceptionState = 'committed';
    expect(() => platform.scroll()).toThrow('Document indicated-part selection is not implemented');
    expect(event.interceptionState).toBe('scrolled');
  });
});

type TestWindow = { navigateEventForTest: BrowletNavigateEvent; handlerCalls?: number; };

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  // Supply the unfinished event-production boundary; use real dispatch, bindings, and Document activity.
  const event = document.env.createEvent(NavigateEventImpl) as NavigateEventImpl;
  event.type = 'navigate';
  event.canIntercept = true;
  event.cancelable = true;
  event.destination = new NavigationDestinationImpl(
    document.env.parseHTMLURL('/next')!, null, document.env.serializeForStorage(undefined), true, document.env,
  );
  event.signal = document.env.createAbortController().signal;
  const platform = project(event) as BrowletNavigateEvent;
  Reflect.set(browser.window, 'navigateEventForTest', platform);
  return { browser, document, navigation, event, platform };
}
