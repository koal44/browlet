import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { parseURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Navigation identity foundation', () => {
  it('exposes a stable, nonconstructible EventTarget in the Window realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let constructible = true;
      try { Reflect.construct(Navigation, []); } catch (error) { constructible = !(error instanceof TypeError); }
      const target = navigation;
      let calls = 0;
      target.addEventListener('probe', () => { calls++; });
      target.dispatchEvent(new Event('probe'));
      return {
        stable: navigation === target,
        branded: target instanceof Navigation && target instanceof EventTarget,
        constructible, calls,
      };
    })).toEqual({ stable: true, branded: true, constructible: false, calls: 1 });
  });

  it('allows author replacement without replacing the Window-owned implementation', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).windowImplementation;
    const owned = window.navigation;
    expect(Reflect.set(browser.window, 'navigation', 'author value')).toBe(true);
    expect(Reflect.get(browser.window, 'navigation')).toBe('author value');
    expect(window.navigation).toBe(owned);
    expect(Reflect.deleteProperty(browser.window, 'navigation')).toBe(true);
    expect(browser.window.navigation).toBeUndefined();
    expect(window.navigation).toBe(owned);
  });

  it('retains Navigation across initial Window reuse and replaces it with a new Window', async () => {
    const browser = new Browlet({ route: () => '' });
    const original = browser.window.navigation;
    const window = getRelevantRealm(browser.window).windowImplementation;
    const navigable = window.navigable!;
    const params = navigable.createNavigationParamsFromSource(parseURL('about:blank?replacement').url!);
    params.origin = window.document.origin;
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', navigable.createHistoryEntry(document, params));
    expect(browser.window.navigation).toBe(original);
    await browser.navigate('https://example.test/replacement');
    expect(browser.window.navigation).not.toBe(original);
    expect(getRelevantRealm(browser.window.navigation)).toBe(getRelevantRealm(browser.window));
  });
});
