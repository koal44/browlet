import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';

describe('Pointer Events §7.1: touch-action through CSSOM and computed style', () => {
  it('exposes camel-cased and dashed attributes through the existing declaration binding', async () => {
    const browser = new Browlet({ route: () => '<div></div>' });
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(() => {
      const element = document.querySelector('div')!;
      element.style.touchAction = 'pan-y pan-left';
      const before = [element.style.touchAction, Reflect.get(element.style, 'touch-action'), element.getAttribute('style')];
      Reflect.set(element.style, 'touch-action', 'pinch-zoom pan-up');
      const computed = getComputedStyle(element);
      return {
        before,
        after: [element.style.touchAction, computed.touchAction, computed.getPropertyValue('touch-action')],
        listed: Array.from({ length: element.style.length }, (_, index) => element.style.item(index)),
        removed: element.style.removeProperty('touch-action'),
        empty: element.style.touchAction,
        initial: getComputedStyle(element).touchAction,
      };
    })).toEqual({
      before: ['pan-left pan-y', 'pan-left pan-y', 'touch-action: pan-left pan-y;'],
      after: ['pan-up pinch-zoom', 'pan-up pinch-zoom', 'pan-up pinch-zoom'],
      listed: ['touch-action'], removed: 'pan-up pinch-zoom', empty: '', initial: 'auto',
    });
  });

  it('does not inherit by default, but honors explicit inheritance and CSS-wide defaulting', async () => {
    const browser = new Browlet({ route: () => '<main style="touch-action: none"><span></span></main>' });
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(() => {
      const element = document.querySelector('span')!;
      return ['', 'inherit', 'unset', 'initial'].map((value) => {
        element.style.touchAction = value;
        return getComputedStyle(element).touchAction;
      });
    })).toEqual(['auto', 'none', 'auto', 'auto']);
  });

  it('substitutes custom properties before validating and ordering the complete grammar', async () => {
    const browser = new Browlet({ route: () => '<div></div>' });
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(() => {
      const element = document.querySelector('div')!;
      element.style.cssText = '--action: pinch-zoom pan-up pan-left; touch-action: var(--action)';
      const first = [element.style.touchAction, getComputedStyle(element).touchAction];
      element.style.setProperty('--action', 'pan-x pan-left');
      const invalid = getComputedStyle(element).touchAction;
      element.style.touchAction = 'var(--missing, pan-y)';
      return { first, invalid, fallback: getComputedStyle(element).touchAction };
    })).toEqual({ first: ['var(--action)', 'pan-left pan-up pinch-zoom'], invalid: 'auto', fallback: 'pan-y' });
  });

  it('retains the previous declaration for invalid assignments and honors importance', async () => {
    const browser = new Browlet({ route: () => '<div></div>' });
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(() => {
      const element = document.querySelector('div')!;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('div { touch-action: pan-y !important; }');
      document.adoptedStyleSheets = [sheet];
      element.style.touchAction = 'none';
      element.style.touchAction = 'pan-x pan-left';
      const invalid = element.style.touchAction;
      const importantRule = getComputedStyle(element).touchAction;
      element.style.setProperty('touch-action', 'pan-x', 'important');
      return {
        invalid, importantRule, importantInline: getComputedStyle(element).touchAction,
        priority: element.style.getPropertyPriority('touch-action'),
      };
    })).toEqual({ invalid: 'none', importantRule: 'pan-y', importantInline: 'pan-x', priority: 'important' });
  });

  it('retains the explicit pan/zoom combination rather than computing it to manipulation', async () => {
    const browser = new Browlet({ route: () => '<div></div>' });
    await browser.navigate('https://example.test/');
    expect(await browser.evaluate(() => {
      const element = document.querySelector('div')!;
      element.style.touchAction = 'pan-y pinch-zoom pan-x';
      const combined = [element.style.touchAction, getComputedStyle(element).touchAction];
      element.style.touchAction = 'manipulation';
      return { combined, alias: getComputedStyle(element).touchAction };
    })).toEqual({ combined: ['pan-x pan-y pinch-zoom', 'pan-x pan-y pinch-zoom'], alias: 'manipulation' });
  });
});
