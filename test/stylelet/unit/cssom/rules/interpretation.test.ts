import { describe, expect, it } from 'vitest';

import { defaultStyleletEnvironment as env } from '../../../../../src/stylelet/environment';
import { RuleListContext } from '../../../../../src/stylelet/cssom/rules/context';
import { CSSRuleListImpl } from '../../../../../src/stylelet/cssom/rule-list';
import type { CSSStyleRuleImpl } from '../../../../../src/stylelet/cssom/rules/style';
import { CSSImportRuleImpl } from '../../../../../src/stylelet/cssom/rules/import';
import { CSSNamespaceRuleImpl } from '../../../../../src/stylelet/cssom/rules/namespace';
import { parseRule, parseStylesheetContents } from '../../../../../src/stylelet/syntax/parser';

describe('CSSOM rule interpretation and editing', () => {
  it('updates descendant selector bindings and specificity without changing rule identities', () => {
    const parent = parseRule('#old { .child { > span {} } }', new RuleListContext(new CSSRuleListImpl(), null, false, env)) as CSSStyleRuleImpl;
    const child = parent.cssRules.item(0) as CSSStyleRuleImpl;
    const grandchild = child.cssRules.item(0) as CSSStyleRuleImpl;
    expect(grandchild.selectors.specificity).toEqual({ a: 1, b: 1, c: 1 });

    parent.selectorText = 'article';
    expect(child.selectors.specificity).toEqual({ a: 0, b: 1, c: 1 });
    expect(grandchild.selectors.specificity).toEqual({ a: 0, b: 1, c: 2 });
    expect(parent.cssRules.item(0)).toBe(child);
    expect(child.cssRules.item(0)).toBe(grandchild);
    expect(grandchild.selectorText).toBe('& > span');
  });

  it('retains child namespace bindings when an unattached parent selector changes', () => {
    const rules = parseStylesheetContents('@namespace x "urn:x"; a { x|b {} }', new RuleListContext(new CSSRuleListImpl(), null, false, env));
    const parent = rules[1] as CSSStyleRuleImpl;
    const child = parent.cssRules.item(0) as CSSStyleRuleImpl;
    parent.selectorText = 'article';
    expect(child.selectorText).toBe('& x|b');
    expect(child.selectors.specificity).toEqual({ a: 0, b: 0, c: 2 });
  });

  it('uses the last namespace declaration and discards misplaced declarations', () => {
    const context = new RuleListContext(new CSSRuleListImpl(), null, false, env);
    const rules = parseStylesheetContents('@namespace x "urn:old"; @namespace x "urn:new"; x|a {} @namespace y "urn:late"; y|b {}', context);
    expect(rules).toHaveLength(3);
    expect(context.namespacePrefixes).toEqual(new Map([['x', 'urn:new']]));
    expect((rules[2] as CSSStyleRuleImpl).selectorText).toBe('x|a');
  });

  it.each([
    ['@namespace "";', '', '', '@namespace url("");'],
    ['@namespace x url(relative);', 'relative', 'x', '@namespace x url("relative");'],
    ['@namespace x URL( "urn:example" );', 'urn:example', 'x', '@namespace x url("urn:example");'],
    ['@namespace \\31  "urn:x";', 'urn:x', '1', '@namespace \\31  url("urn:x");'],
  ])('retains namespace names without URL resolution: %s', (input, uri, prefix, text) => {
    const rule = parseRule(input, new RuleListContext(new CSSRuleListImpl(), null, false, env)) as CSSNamespaceRuleImpl;
    expect(rule).toBeInstanceOf(CSSNamespaceRuleImpl);
    expect([rule.namespaceURI, rule.prefix, rule.cssText]).toEqual([uri, prefix, text]);
  });

  it.each(['@namespace;', '@namespace prefix;', '@namespace "urn:x" extra;', '@namespace url("a" "b");'])('rejects an invalid namespace: %s', (input) => {
    expect(parseRule(input, new RuleListContext(new CSSRuleListImpl(), null, false, env))).toBeNull();
  });

  it.each([
    ['@import "../theme.css";', '../theme.css', '', '@import url("../theme.css");'],
    ['@import url( theme.css ) SCREEN;', 'theme.css', 'screen', '@import url("theme.css") screen;'],
    ['@import URL( "theme.css" ) print, screen;', 'theme.css', 'print, screen', '@import url("theme.css") print, screen;'],
  ])('retains import URL spelling and canonical media: %s', (input, href, media, text) => {
    const rule = parseRule(input, new RuleListContext(new CSSRuleListImpl(), null, false, env)) as CSSImportRuleImpl;
    expect(rule).toBeInstanceOf(CSSImportRuleImpl);
    expect([rule.href, rule.media.mediaText, rule.cssText]).toEqual([href, media, text]);
    expect([rule.styleSheet, rule.layerName, rule.supportsText]).toEqual([null, null, null]);
  });

  it.each(['url', 'src'])('retains request modifiers on an import %s()', (notation) => {
    const input = `@import ${notation}("theme.css" cross-origin(anonymous) integrity("sha256-test") referrer-policy(no-referrer)) screen;`;
    const rule = parseRule(input, new RuleListContext(new CSSRuleListImpl(), null, false, env)) as CSSImportRuleImpl;
    expect(rule).toBeInstanceOf(CSSImportRuleImpl);
    expect(rule.href).toBe('theme.css');
    expect(rule.cssText).toBe(input);
  });

  it.each(['@import var(--sheet);', '@import src(var(--sheet));'])('rejects custom-property substitution in %s', (input) => {
    expect(parseRule(input, new RuleListContext(new CSSRuleListImpl(), null, false, env))).toBeNull();
  });

  it('checks import syntax before rejecting a valid nested import for placement', () => {
    const rule = parseRule('.a {}', new RuleListContext(new CSSRuleListImpl(), null, false, env)) as CSSStyleRuleImpl;
    expect(() => rule.insertRule('@import invalid;')).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(() => rule.insertRule('@import "x.css";')).toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(rule.cssRules.length).toBe(0);
  });

  // These test explicit implementation boundaries, not successful feature support.
  it.each([
    ['@import "x.css" layer(foo);', 'Import layer/supports grammar and applicability'],
    ['@import "x.css" supports(display: grid);', 'Import layer/supports grammar and applicability'],
    ['@page :left { margin: 1cm }', 'Page selector, descriptor, and margin-rule parsing'],
  ])('reports the remaining dependency for %s', (input, dependency) => {
    expect(() => parseRule(input, new RuleListContext(new CSSRuleListImpl(), null, false, env))).toThrow(dependency);
  });
});
