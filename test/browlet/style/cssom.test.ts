import { serializeURL } from '../../../src/url/core/index';
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { CSSStyleRule as PlatformCSSStyleRule, CSSStyleSheet } from '../../../src/browlet/platform';
import { CSSStyleSheetImpl } from '../../../src/stylelet/cssom/css-stylesheet';
import { reference } from '../../../src/web-idl/index';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../test-runtime';

/* eslint-disable @typescript-eslint/unbound-method -- Borrowed methods receive explicit receivers. */

describe('CSSOM sheet bindings', () => {
  it('constructs the exposed hierarchy and leaves abstract interfaces unconstructible', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const sheet = new CSSStyleSheet({ media: 'SCREEN', disabled: true });
      let illegal = false;
      try { Reflect.construct(StyleSheet, []); }
      catch (error) { illegal = error instanceof TypeError; }
      return {
        illegal,
        sheet: sheet instanceof CSSStyleSheet,
        base: sheet instanceof StyleSheet,
        media: sheet.media instanceof MediaList,
        type: sheet.type, href: sheet.href, title: sheet.title,
        owner: sheet.ownerNode, parent: sheet.parentStyleSheet, ownerRule: sheet.ownerRule,
        disabled: sheet.disabled, queries: String(sheet.media),
        readonly: Reflect.set(sheet, 'type', 'changed'),
      };
    })).toEqual({
      illegal: true, sheet: true, base: true, media: true,
      type: 'text/css', href: null, title: null, owner: null, parent: null, ownerRule: null,
      disabled: true, queries: 'screen', readonly: false,
    });
  });

  it('clones MediaList input and forwards media assignment to the retained list', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const original = new CSSStyleSheet({ media: 'screen' });
      const clone = new CSSStyleSheet({ media: original.media });
      const media = clone.media;
      Reflect.set(clone, 'media', 'print');
      return [clone.media === media, clone.media !== original.media, String(media), String(original.media)];
    })).toEqual([true, true, 'print', 'screen']);
  });

  it('rejects an invalid constructor base URL with a projected NotAllowedError', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      try { new CSSStyleSheet({ baseURL: 'http://[' }); }
      catch (error) {
        return { projected: error instanceof DOMException, name: (error as DOMException).name };
      }
      return null;
    })).toEqual({ projected: true, name: 'NotAllowedError' });
  });

  it('projects a live rule tree and declaration identities through replacement', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const sheet = new CSSStyleSheet();
      const rules = sheet.cssRules;
      sheet.replaceSync('.parent { color: red; .child { opacity: .2 } opacity: .7 }');
      const parent = rules[0] as CSSStyleRule;
      const child = parent.cssRules[0]!;
      const declarations = parent.cssRules[1]!;
      const before = {
        live: sheet.rules === rules && rules === sheet.cssRules,
        indexed: rules.item(0) === parent && [...rules][0] === parent,
        absent: rules[1] === undefined && rules.item(1) === null,
        rule: parent instanceof CSSStyleRule && parent instanceof CSSRule,
        parent: parent.parentStyleSheet === sheet && parent.parentRule === null,
        nested: child.parentRule === parent && child.parentStyleSheet === sheet,
        declarations: declarations.constructor.name,
        style: parent.style instanceof CSSStyleDeclaration && parent.style.constructor.name,
        styleParent: parent.style.parentRule === parent,
        color: parent.style.color,
        constants: [
          CSSRule.STYLE_RULE, parent.STYLE_RULE, CSSRule.KEYFRAMES_RULE, CSSRule.KEYFRAME_RULE,
          CSSRule.COUNTER_STYLE_RULE, CSSRule.SUPPORTS_RULE, CSSRule.FONT_FEATURE_VALUES_RULE,
        ],
        readonlyIndex: Reflect.set(rules, '0', child),
      };
      parent.cssText = 'ignored {}';
      sheet.replaceSync('');
      return { before, after: [rules.length, parent.parentStyleSheet, child.parentStyleSheet, child.parentRule === parent] };
    })).toEqual({
      before: {
        live: true, indexed: true, absent: true, rule: true, parent: true, nested: true,
        declarations: 'CSSNestedDeclarations', style: 'CSSStyleProperties', styleParent: true,
        color: 'red', constants: [1, 1, 7, 8, 11, 12, 14], readonlyIndex: false,
      },
      after: [0, null, null, true],
    });
  });

  it('converts arguments and keeps property attributes on the platform object', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.insertRule('.example {}', 2 ** 32);
      const style = (sheet.cssRules[0] as CSSStyleRule).style;
      style.marginTop = '2px';
      Reflect.set(style, 'margin-left', '3px');
      Reflect.apply(style.setProperty, style, ['color', { toString: () => 'red' }, null]);
      const before = [style.marginTop, style.getPropertyValue('margin-left'), style.color, [...style], style.item(99)];
      Reflect.set(style, 'marginTop', null);
      Reflect.set(sheet.cssRules[0]!, 'style', 'opacity: .5');
      let illegal = false;
      try { Reflect.apply(sheet.deleteRule, {}, [0]); }
      catch (error) { illegal = error instanceof TypeError; }
      return { before, after: [style.opacity, [...style], style[1] === undefined], illegal };
    })).toEqual({
      before: ['2px', '3px', 'red', ['margin-top', 'margin-left', 'color'], ''],
      after: ['0.5', ['opacity'], true], illegal: true,
    });
  });

  it('realizes borrowed failures at the binding and retains the receiver promise realm', async () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const sheet = new browser.window.CSSStyleSheet();
    let error: unknown;
    try { Reflect.apply(other.window.CSSStyleSheet.prototype.deleteRule, sheet, [0]); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(other.window.DOMException);
    expect(error).not.toBeInstanceOf(browser.window.DOMException);
    expect(error).toMatchObject({ name: 'IndexSizeError' });
    const result: Promise<CSSStyleSheet> = Reflect.apply(other.window.CSSStyleSheet.prototype.replace, sheet, ['.one {}']);
    expect(result).toBeInstanceOf(getRelevantRealm(browser.window).intrinsics.promise.constructor);
    expect(result).not.toBeInstanceOf(getRelevantRealm(other.window).intrinsics.promise.constructor);
    expect(() => sheet.replaceSync('')).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    await expect(result).resolves.toBe(sheet);
    expect(sheet.cssRules).toHaveLength(1);
  });

  it('checks origin cleanliness on all rule access and mutation aliases', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const implementation = new CSSStyleSheetImpl({
      location: null, parentStyleSheet: null, ownerNode: null, ownerRule: null,
      media: '', title: '', alternate: false, originClean: false,
    }, env);
    const sheet = getBindingContext(env.realm).implToJS(implementation, reference(CSSStyleSheetImpl)) as CSSStyleSheet;
    for (const read of [
      () => sheet.cssRules, () => sheet.rules, () => sheet.insertRule('invalid', 1),
      () => sheet.deleteRule(0), () => sheet.addRule(), () => sheet.removeRule(),
    ]) {
      expect(read).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    }
    expect(implementation.ruleList).toHaveLength(0);
    expect(() => sheet.replaceSync('')).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    const rejected = observeBrowletPromise(browser.window, sheet.replace(''));
    performTestMicrotaskCheckpoint(browser.window);
    await expect(rejected).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('projects style-element sheets and keeps attribute input synchronized with live indices', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('style');
      element.textContent = '.example { color: red }';
      document.head.append(element);
      const sheet = element.sheet!;
      const media = sheet.media;
      element.media = 'print';
      const target = document.createElement('div');
      const style = target.style;
      target.setAttribute('style', 'color: red; opacity: .5');
      const names = Object.keys(style);
      target.removeAttribute('style');
      return {
        projected: sheet instanceof CSSStyleSheet,
        listed: document.styleSheets instanceof StyleSheetList && document.styleSheets[0] === sheet,
        owner: sheet.ownerNode === element,
        media: sheet.media === media && media.mediaText,
        names, cleared: Object.keys(style),
      };
    })).toEqual({ projected: true, listed: true, owner: true, media: 'print', names: ['0', '1'], cleared: [] });
  });

  it('keeps constructor documents and base URLs on the implementation without exposing them', () => {
    const browser = new Browlet({ route: () => '' });
    const sheet = new browser.window.CSSStyleSheet({ baseURL: 'https://example.test/styles/' });
    const implementation = unwrap<CSSStyleSheetImpl>(sheet);
    expect(serializeURL(implementation.baseURL!)).toBe('https://example.test/styles/');
    expect(implementation.isConstructedFor(getRelevantRealm(browser.window).getAssociatedDocument())).toBe(true);
    expect(Reflect.get(sheet, 'baseURL')).toBeUndefined();
    expect(Reflect.get(sheet, 'ruleList')).toBeUndefined();
    sheet.replaceSync('.example { color: red }');
    const style = (sheet.cssRules[0] as PlatformCSSStyleRule).style;
    expect(Reflect.get(unwrap(style), 'color')).toBeUndefined();
  });
});
