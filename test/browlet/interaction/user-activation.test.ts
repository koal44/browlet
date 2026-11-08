import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, DocumentState, Navigable } from '../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLObjectElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/object';
import type { HTMLFrameElementImpl } from '../../../src/browlet/dom/nodes/html/legacy/frame';
import type { UserActivation } from '../../../src/browlet/platform';
import { Duration } from '../../../src/timing/index';
import { createOpaqueOrigin } from '../../../src/url/index';
import { unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Transient activation', () => {
  it('uses the Window clock with an inclusive start and exclusive five-second expiry', async () => {
    const { window } = await fixture();
    const clock = vi.spyOn(window.env, 'currentHighResolutionTime').mockReturnValue(new Duration(100));
    expect(window.hasTransientActivation()).toBe(false);
    window.lastActivationTimestamp = 200;
    expect(window.hasTransientActivation()).toBe(false);
    clock.mockReturnValue(new Duration(200));
    expect(window.hasTransientActivation()).toBe(true);
    clock.mockReturnValue(new Duration(5199.9));
    expect(window.hasTransientActivation()).toBe(true);
    clock.mockReturnValue(new Duration(5200));
    expect(window.hasTransientActivation()).toBe(false);
    expect(window.hasStickyActivation()).toBe(true);
    expect(window.hasHistoryActionActivation()).toBe(true);
    expect(window.lastActivationTimestamp).toBe(200);
  });

  it('consumes transient activation without losing sticky activation, then permits a later activation', async () => {
    const { window } = await fixture();
    vi.spyOn(window.env, 'currentHighResolutionTime').mockReturnValue(new Duration(1000));
    window.lastActivationTimestamp = 500;
    expect(window.hasTransientActivation()).toBe(true);
    window.consumeHistoryActionUserActivation();
    expect(window.hasTransientActivation()).toBe(true);
    window.consumeUserActivation();
    expect(window.hasTransientActivation()).toBe(false);
    expect(window.hasStickyActivation()).toBe(true);
    window.lastActivationTimestamp = 1000;
    expect(window.hasTransientActivation()).toBe(true);
  });
});

describe('UserActivation interface', () => {
  it.each(['http:', 'https:'])('exposes the stable, read-only Window-owned object on %s', async (scheme) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate(`${scheme}//example.test/`);
    expect(await browser.evaluate(() => {
      const activation = navigator.userActivation;
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userActivation')!;
      let illegalConstructor = false;
      let illegalReceiver = false;
      try { Reflect.construct(UserActivation, []); } catch (error) { illegalConstructor = error instanceof TypeError; }
      try { descriptor.get!.call({}); } catch (error) { illegalReceiver = error instanceof TypeError; }
      return {
        sameObject: activation === navigator.userActivation && activation === clientInformation.userActivation,
        prototype: Object.getPrototypeOf(activation) === UserActivation.prototype,
        tag: Object.prototype.toString.call(activation),
        sticky: activation.hasBeenActive,
        transient: activation.isActive,
        getterOnly: typeof descriptor.get === 'function' && descriptor.set === undefined,
        replaced: Reflect.set(navigator, 'userActivation', {}),
        illegalConstructor, illegalReceiver,
      };
    })).toEqual({
      sameObject: true, prototype: true, tag: '[object UserActivation]', sticky: false, transient: false,
      getterOnly: true, replaced: false, illegalConstructor: true, illegalReceiver: true,
    });
  });

  it('reads live receiver state even through another Window\'s getters', async () => {
    const first = await fixture();
    const second = await fixture();
    const clock = vi.spyOn(first.window.env, 'currentHighResolutionTime').mockReturnValue(new Duration(1000));
    vi.spyOn(second.window.env, 'currentHighResolutionTime').mockReturnValue(new Duration(20_000));
    first.window.lastActivationTimestamp = 1000;
    const getActivation = Object.getOwnPropertyDescriptor(second.browser.window.Navigator.prototype, 'userActivation')!;
    const activation = getActivation.get!.call(first.browser.window.navigator) as UserActivation;
    const getActive = Object.getOwnPropertyDescriptor(second.browser.window.UserActivation.prototype, 'isActive')!;
    expect(activation).toBe(first.browser.window.navigator.userActivation);
    expect(Object.getPrototypeOf(activation)).toBe(first.browser.window.UserActivation.prototype);
    expect(getActive.get!.call(activation)).toBe(true);
    expect(second.browser.window.navigator.userActivation.isActive).toBe(false);
    clock.mockReturnValue(new Duration(6000));
    expect(getActive.get!.call(activation)).toBe(false);
    expect(activation.hasBeenActive).toBe(true);
    expect(() => { getActive.get!.call({}); }).toThrow(second.window.env.realm.TypeError);
  });

  it('retains the original Window\'s state and deadline after Document replacement', async () => {
    const { browser, window } = await fixture();
    const clock = vi.spyOn(window.env, 'currentHighResolutionTime').mockReturnValue(new Duration(1000));
    window.lastActivationTimestamp = 1000;
    const navigator = browser.window.navigator;
    const activation = navigator.userActivation;
    await browser.navigate('https://example.test/replacement');
    expect(navigator.userActivation).toBe(activation);
    expect(browser.window.navigator.userActivation).not.toBe(activation);
    expect(activation.isActive).toBe(true);
    expect(browser.window.navigator.userActivation.hasBeenActive).toBe(false);
    clock.mockReturnValue(new Duration(6000));
    expect(activation.isActive).toBe(false);
    expect(activation.hasBeenActive).toBe(true);
  });

  it('does not activate a Window through author-created input events', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      return [navigator.userActivation.isActive, navigator.userActivation.hasBeenActive];
    })).toEqual([false, false]);
  });
});

describe('Sticky activation', () => {
  it('compares the retained activation time with the Window clock and survives transient consumption', async () => {
    const { window } = await fixture();
    expect(window.hasStickyActivation()).toBe(false);
    window.lastActivationTimestamp = window.env.currentHighResolutionTime().milliseconds + 60_000;
    expect(window.hasStickyActivation()).toBe(false);
    window.lastActivationTimestamp = window.env.currentHighResolutionTime().milliseconds;
    expect(window.hasStickyActivation()).toBe(true);
    window.consumeUserActivation();
    expect(window.lastActivationTimestamp).toBe(-Infinity);
    expect(window.hasStickyActivation()).toBe(true);
  });
});

describe('Transient activation consumption', () => {
  it('consumes every active Window in the top-level tree while preserving never-activated and history timestamps', async () => {
    const { document, window } = await fixture();
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    const neverActivated = createChild(child.document, 'object');
    child.document.body!.appendChild(neverActivated.container);
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const shadowChild = createChild(document, 'frame');
    shadow.appendChild(shadowChild.container);
    const detached = createChild(document, 'iframe');
    const other = await fixture();
    window.lastActivationTimestamp = 12;
    window.lastHistoryActionActivationTimestamp = 7;
    child.window.lastActivationTimestamp = 5;
    child.document.origin = createOpaqueOrigin();
    shadowChild.window.lastActivationTimestamp = -Infinity;
    detached.window.lastActivationTimestamp = 20;
    other.window.lastActivationTimestamp = 30;

    child.window.consumeUserActivation();

    expect(window.lastActivationTimestamp).toBe(-Infinity);
    expect(child.window.lastActivationTimestamp).toBe(-Infinity);
    expect(shadowChild.window.lastActivationTimestamp).toBe(-Infinity);
    expect(neverActivated.window.lastActivationTimestamp).toBe(Infinity);
    expect(window.lastHistoryActionActivationTimestamp).toBe(7);
    expect(child.window.lastHistoryActionActivationTimestamp).toBe(Infinity);
    expect(detached.window.lastActivationTimestamp).toBe(20);
    expect(other.window.lastActivationTimestamp).toBe(30);
  });

  it('does not consume a retained Window after replacement removes its navigable', async () => {
    const { browser, window } = await fixture();
    window.lastActivationTimestamp = 12;
    await browser.navigate('https://example.test/replacement');

    window.consumeUserActivation();

    expect(window.lastActivationTimestamp).toBe(12);
    expect(unwrap<DocumentImpl>(browser.document).getRelevantGlobalObject()!.lastActivationTimestamp).toBe(Infinity);
  });
});

describe('History-action activation', () => {
  it('starts unavailable, compares retained timestamps, and consumes independently of transient activation', async () => {
    const { window } = await fixture();
    expect(window.lastActivationTimestamp).toBe(Infinity);
    expect(window.lastHistoryActionActivationTimestamp).toBe(Infinity);
    expect(window.hasHistoryActionActivation()).toBe(false);
    window.lastActivationTimestamp = 10;
    expect(window.hasHistoryActionActivation()).toBe(true);
    window.consumeHistoryActionUserActivation();
    expect(window.hasHistoryActionActivation()).toBe(false);
    expect(window.lastActivationTimestamp).toBe(10);
    expect(window.lastHistoryActionActivationTimestamp).toBe(10);
    window.lastActivationTimestamp = 20;
    expect(window.hasHistoryActionActivation()).toBe(true);
    vi.spyOn(window.env, 'currentHighResolutionTime').mockReturnValue(new Duration(20));
    expect(window.hasTransientActivation()).toBe(true);
  });

  it('consumes across nested, cross-origin, and shadow-tree navigables in the same top-level traversable', async () => {
    const { document, window, navigable } = await fixture();
    const first = createChild(document, 'iframe');
    document.body!.appendChild(first.container);
    const nested = createChild(first.document, 'object');
    first.document.body!.appendChild(nested.container);
    nested.document.origin = createOpaqueOrigin();
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const shadowChild = createChild(document, 'frame');
    shadow.appendChild(shadowChild.container);
    const detached = createChild(document, 'iframe');
    document.body!.appendChild(document.createElement('iframe'));
    const other = await fixture();
    const included = [window, first.window, nested.window, shadowChild.window];
    for (const [index, owner] of [...included, detached.window, other.window].entries()) owner.lastActivationTimestamp = index + 1;
    expect(document.getDescendantNavigables()).toEqual([first.navigable, nested.navigable, shadowChild.navigable]);
    expect(document.getDocumentTreeChildNavigables()).toEqual([first.navigable]);
    expect(nested.navigable.topLevelTraversable).toBe(navigable);
    nested.window.consumeHistoryActionUserActivation();
    expect(included.map((owner) => owner.hasHistoryActionActivation())).toEqual([false, false, false, false]);
    expect(included.map((owner) => owner.lastActivationTimestamp)).toEqual([1, 2, 3, 4]);
    expect(detached.window.hasHistoryActionActivation()).toBe(true);
    expect(other.window.hasHistoryActionActivation()).toBe(true);
  });

  it('consumes parents before their descendants', async () => {
    const { document, window } = await fixture();
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    const grandchild = createChild(child.document, 'object');
    child.document.body!.appendChild(grandchild.container);
    const visited: string[] = [];
    for (const [name, owner] of [['top', window], ['child', child.window], ['grandchild', grandchild.window]] as const) {
      Object.defineProperty(owner, 'lastActivationTimestamp', {
        get() { visited.push(name); return 1; },
      });
    }

    window.consumeHistoryActionUserActivation();

    expect(visited).toEqual(['top', 'child', 'grandchild']);
  });

  it('retains activation when an old Window no longer has a navigable', async () => {
    const { browser, window } = await fixture();
    window.lastActivationTimestamp = 10;
    await browser.navigate('https://example.test/replacement');
    expect(window.navigable).toBeNull();
    window.consumeHistoryActionUserActivation();
    expect(window.hasHistoryActionActivation()).toBe(true);
    expect(window.lastHistoryActionActivationTimestamp).toBe(Infinity);
    expect(unwrap<DocumentImpl>(browser.document).getRelevantGlobalObject()!.hasHistoryActionActivation()).toBe(false);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  return { browser, document, window: document.getRelevantGlobalObject()!, navigable: document.getNodeNavigable()! };
}

function createChild(document: DocumentImpl, tag: 'iframe' | 'object' | 'frame') {
  const container = document.createElement(tag) as HTMLIFrameElementImpl | HTMLObjectElementImpl | HTMLFrameElementImpl;
  const [, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
  const navigable = new Navigable(DocumentState.create(childDocument), document.getNodeNavigable());
  // Child navigation/startup is unfinished; provide the association used by the actual descendant traversal.
  container.contentNavigable = navigable;
  return { container, document: childDocument, navigable, window: childDocument.getRelevantGlobalObject()! };
}
