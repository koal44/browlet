import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { CSSImportRule } from '../../../src/browlet/platform';
import { CSSImportRuleImpl } from '../../../src/stylelet/cssom/rules/import';
import { RuleListContext } from '../../../src/stylelet/cssom/rules/context';
import { CSSRuleListImpl } from '../../../src/stylelet/cssom/rule-list';
import { parseRule } from '../../../src/stylelet/syntax/parser';
import { getBindingContext, getRelevantRealm } from '../../support/browlet-binding';
import { exerciseRules, ruleExpectations } from '../../stylelet/rules.contracts';

describe('CSSOM rule bindings', () => {
  it.each(['style', 'mutation', 'namespace', 'detached', 'namespace-error-order', 'declaration-order', 'important-order'] as const)('%s operations preserve the rule contracts', async (kind) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(exerciseRules, kind)).toEqual(ruleExpectations[kind]);
  });

  it('exposes the required rule/descriptor interfaces without author constructors', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const names = ['CSSImportRule', 'CSSNamespaceRule', 'CSSPageRule', 'CSSPageDescriptors', 'CSSMarginRule', 'CSSMarginDescriptors'];
      return names.map((name) => {
        const ctor = Reflect.get(globalThis, name) as new () => object;
        let illegal = false;
        try { new ctor(); }
        catch (error) { illegal = error instanceof TypeError; }
        const parent = Object.getPrototypeOf(ctor.prototype) as { constructor: { name: string; }; };
        return [name, typeof ctor, illegal, parent.constructor.name];
      });
    })).toEqual([
      ['CSSImportRule', 'function', true, 'CSSRule'],
      ['CSSNamespaceRule', 'function', true, 'CSSRule'],
      ['CSSPageRule', 'function', true, 'CSSGroupingRule'],
      ['CSSPageDescriptors', 'function', true, 'CSSStyleDeclaration'],
      ['CSSMarginRule', 'function', true, 'CSSRule'],
      ['CSSMarginDescriptors', 'function', true, 'CSSStyleDeclaration'],
    ]);
  });

  it('projects an unassociated import and forwards media edits through its retained list', () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    const rule = parseRule('@import "../theme.css" screen;', new RuleListContext(new CSSRuleListImpl(), null, false, realm.env)) as CSSImportRuleImpl;
    const platform = getBindingContext(realm).project(CSSImportRuleImpl, rule) as unknown as CSSImportRule;
    const media = platform.media;
    expect(platform.href).toBe('../theme.css');
    expect([platform.styleSheet, platform.layerName, platform.supportsText]).toEqual([null, null, null]);
    Reflect.set(platform, 'media', 'print');
    expect(platform.media).toBe(media);
    expect(platform.media.mediaText).toBe('print');
    expect(platform.cssText).toBe('@import url("../theme.css") print;');
    expect(Reflect.set(platform, 'href', 'changed')).toBe(false);
  });
});
