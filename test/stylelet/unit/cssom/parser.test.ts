import { describe, expect, it } from 'vitest';

import { defaultStyleletEnvironment as env } from '../../../../src/stylelet/environment';
import {
  propertyRegistry,
  type BuiltInPropertyDeclaration, type CustomPropertyDeclaration,
} from '../../../../src/stylelet/css/property';
import { StylesheetContext } from '../../../../src/stylelet/cssom/parser';
import { parseListOfComponentValues, parseStylesheetContents } from '../../../../src/stylelet/syntax/parser';
import { CSSStyleRuleImpl, CSSNestedDeclarationsImpl } from '../../../../src/stylelet/cssom/rules';
import { parseOptionalDeclarationValue } from '../../../../src/stylelet/syntax/declaration-value';
import {
  parseSelectorList, serializeSelectorList,
} from '../../../../src/stylelet/selector/parser';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { ColorKind } from '../../../../src/stylelet/values/color';

const context = new StylesheetContext(null, false, env);

describe('CSS rule construction', () => {
  it('preserves the registry association in a built-in declaration', () => {
    const declaration: BuiltInPropertyDeclaration = {
      type: 'property-declaration',
      custom: false,
      name: 'color',
      value: propertyRegistry.color.definition.parse('red', {})!,
      important: false,
    };
    const resolved = propertyRegistry[declaration.name].definition.resolve(
      declaration.value, ValueStage.Computed, {},
    );

    expect(resolved.type).toBe('ordinary');
    if (resolved.type === 'ordinary') {
      expect(resolved.value.kind).toBe(ColorKind.Absolute);
    }
  });

  it('holds built-in and custom declarations in source order', () => {
    const custom: CustomPropertyDeclaration = {
      type: 'property-declaration',
      custom: true,
      name: '--accent',
      value: parseOptionalDeclarationValue('red', {})!,
      important: false,
    };
    const rule = new CSSStyleRuleImpl(parseSelectorList('*', {})!, [{
      type: 'property-declaration',
      custom: false,
      name: 'color',
      value: propertyRegistry.color.definition.parse('var(--accent)', {})!,
      important: false,
    }, custom], env);

    expect(rule.style.declarations.map((declaration) => declaration.name))
      .toEqual(['color', '--accent']);
  });

  it('interprets valid declarations and discards invalid declarations', () => {
    const rules = parseStylesheetContents(`
      * {
        COLOR: blue;
        unknown: red;
        color: definitely-not-a-color;
        --Accent: red !important;
      }
    `, context);

    expect(rules).toHaveLength(1);
    const rule = rules[0]!;
    expect(rule).toBeInstanceOf(CSSStyleRuleImpl);
    if (!(rule instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');
    expect(rule.style.declarations).toMatchObject([{
      custom: false,
      name: 'color',
      value: {
        type: 'ordinary',
        value: {
          kind: ColorKind.Named,
          name: 'blue',
        },
      },
      important: false,
    }, {
      custom: true,
      name: '--Accent',
      important: true,
      originalText: 'red',
    }]);
  });

  it('carries supplied namespaces through nested rule contexts', () => {
    const namespaceContext = new StylesheetContext(null, false, env);
    namespaceContext.namespacePrefixes = new Map([['svg', 'http://www.w3.org/2000/svg']]);
    namespaceContext.defaultNamespace = 'http://www.w3.org/1999/xhtml';

    const [parent] = parseStylesheetContents(
      'svg|a { > span { > svg|text { color: red; } } }',
      namespaceContext,
    );
    if (!(parent instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');
    const child = parent.cssRules.item(0);
    if (!(child instanceof CSSStyleRuleImpl)) throw new Error('Expected a nested style rule');

    expect(parent.selectors.arms[0]!.parts[0]!.unit.compound?.typeSelector)
      .toMatchObject({ name: 'a', namespaceURI: 'http://www.w3.org/2000/svg' });
    expect(child.selectors.arms[0]!.parts[1]!.unit.compound?.typeSelector)
      .toMatchObject({ name: 'span', namespaceURI: 'http://www.w3.org/1999/xhtml' });

    const grandchild = child.cssRules.item(0);
    if (!(grandchild instanceof CSSStyleRuleImpl)) throw new Error('Expected a nested style rule');
    expect(grandchild.selectors.arms[0]!.parts[1]!.unit.compound?.typeSelector)
      .toMatchObject({ name: 'text', namespaceURI: 'http://www.w3.org/2000/svg' });
  });

  // TODO: @namespace interpretation and CSSNamespaceRule construction are not implemented.
  // https://drafts.csswg.org/css-namespaces-3/#scope
  it.fails('applies @namespace declarations to parent and nested selectors', () => {
    const rules = parseStylesheetContents(`
      @namespace svg "http://www.w3.org/2000/svg";
      svg|a { > svg|b { color: red; } }
    `, context);

    expect(rules).toHaveLength(2);
    const parent = rules[1];
    if (!(parent instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');
    const child = parent.cssRules.item(0);
    if (!(child instanceof CSSStyleRuleImpl)) throw new Error('Expected a nested style rule');

    expect(serializeSelectorList(parent.selectors)).toBe('svg|a');
    expect(serializeSelectorList(child.selectors)).toBe('& > svg|b');
    expect(parent.selectors.arms[0]!.parts[0]!.unit.compound?.typeSelector)
      .toMatchObject({ name: 'a', namespaceURI: 'http://www.w3.org/2000/svg' });
    expect(child.selectors.arms[0]!.parts[1]!.unit.compound?.typeSelector)
      .toMatchObject({ name: 'b', namespaceURI: 'http://www.w3.org/2000/svg' });
  });

  it('discards invalid style rules and unrecognized at-rules, including @charset', () => {
    const rules = parseStylesheetContents(`
      @charset "utf-8";
      @unknown example;
      , { color: red }
      * { color: blue }
    `, context);

    expect(rules).toHaveLength(1);
    expect(rules[0]).toBeInstanceOf(CSSStyleRuleImpl);
    expect((rules[0] as CSSStyleRuleImpl).style.declarations)
      .toMatchObject([{ name: 'color' }]);
  });

  it('does not interpret the children of an invalid or unknown rule', () => {
    const rules = parseStylesheetContents(`
      , { @media screen {} }
      @unknown { @font-face {} }
      .kept { color: blue }
    `, context);

    expect(rules).toHaveLength(1);
    expect(rules[0]).toBeInstanceOf(CSSStyleRuleImpl);
  });

  // These are implementation boundaries, not assertions of CSS conformance.
  // Replace them with grammar/consumer acceptance tests as the owning rules are implemented.
  it.each([
    ['@media screen { .a {} }', '@media prelude, placement, and block grammar'],
    ['.a { @supports (color: red) {} }', '@supports prelude, placement, and block grammar'],
    ['@font-face { font-family: Example }', '@font-face prelude, placement, and block grammar'],
    ['@layer reset;', '@layer statement grammar and CSSOM construction'],
  ])('exposes the missing dependency for %s', (input, dependency) => {
    expect(() => parseStylesheetContents(input, context)).toThrow(dependency);
  });

  it('accepts comment-separated whitespace in selectors and declaration values', () => {
    const [rule] = parseStylesheetContents('div /**/ span { color: rgb(10 /**/ 20 /**/ 30); --text: a /**/ b }', context);
    if (!(rule instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');

    expect(serializeSelectorList(rule.selectors)).toBe('div span');
    expect(rule.style.declarations).toMatchObject([
      { name: 'color', custom: false },
      { name: '--text', custom: true, originalText: 'a /**/ b' },
    ]);
  });

  it('preserves custom-property spelling in prebuilt nested rule blocks', () => {
    const list = parseListOfComponentValues('.parent { --x: fn(a) /**/ foo\\62 ar; & .child { --y: [b] b\\61 z } }', {});
    const [rule] = parseStylesheetContents(list, context);
    if (!(rule instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');
    const child = rule.cssRules.item(0);
    if (!(child instanceof CSSStyleRuleImpl)) throw new Error('Expected a nested style rule');

    expect(rule.style.getPropertyValue('--x')).toBe('fn(a) /**/ foo\\62 ar');
    expect(child.style.getPropertyValue('--y')).toBe('[b] b\\61 z');
  });

  it('retains substitution for later value resolution', () => {
    const [rule] = parseStylesheetContents('* { color: var(--accent) }', context);

    expect((rule as CSSStyleRuleImpl).style.declarations).toMatchObject([{
      custom: false,
      name: 'color',
      value: { type: 'substitution-value' },
    }]);
  });

  // CSS Nesting Level 1 defines nested style rules and declaration runs.
  it('keeps declarations after nested rules separate from the parent style', () => {
    const [rule] = parseStylesheetContents(`
      .parent {
        color: blue;
        &:hover { color: red }
        --accent: green;
      }
    `, context);

    if (!(rule instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');
    expect(rule.style.declarations).toMatchObject([{ name: 'color' }]);
    expect(rule.cssRules.length).toBe(2);
    const nested = rule.cssRules.item(0)!;
    const following = rule.cssRules.item(1)!;
    if (!(nested instanceof CSSStyleRuleImpl)) throw new Error('Expected a nested style rule');
    if (!(following instanceof CSSNestedDeclarationsImpl)) throw new Error('Expected nested declarations');

    expect(nested.style.declarations).toMatchObject([{ name: 'color' }]);
    expect(following.style.declarations).toMatchObject([{ name: '--accent' }]);
    expect(serializeSelectorList(nested.selectors)).toBe('&:hover');
    expect(nested.parentRule).toBe(rule);
    expect(following.parentRule).toBe(rule);
    expect(following.style.parentRule).toBe(following);
    expect(nested.parentStyleSheet).toBeNull();
  });

  // SPEC_CLASH(css-invalid-rule-declaration-runs): Match all three browsers.
  // https://github.com/w3c/csswg-drafts/issues/11271
  it.each(['& + {}', '@unknown;'])('merges initial declarations across discarded %s', (invalidRule) => {
    const [rule] = parseStylesheetContents(`.parent { color: red; ${invalidRule} color: blue; }`, context);
    if (!(rule instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');

    expect(rule.style.declarations).toHaveLength(1);
    expect(rule.style.getPropertyValue('color')).toBe('blue');
    expect(rule.cssRules.length).toBe(0);
  });

  it.each(['& + {}', '@unknown;'])('merges nested declarations across discarded %s', (invalidRule) => {
    const [rule] = parseStylesheetContents(`.parent { & {} color: red; ${invalidRule} color: blue; }`, context);
    if (!(rule instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');

    expect(rule.style.declarations).toHaveLength(0);
    expect(rule.cssRules.length).toBe(2);
    const following = rule.cssRules.item(1);
    if (!(following instanceof CSSNestedDeclarationsImpl)) throw new Error('Expected nested declarations');
    expect(following.style.declarations).toMatchObject([{ name: 'color' }]);
    expect(following.style.getPropertyValue('color')).toBe('blue');
    expect(following.parentRule).toBe(rule);
  });

  it('binds nested selectors recursively to their parent style rules', () => {
    const [parent] = parseStylesheetContents(`
      #featured, article {
        .item {
          > .label { color: red }
        }
      }
    `, context);
    if (!(parent instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');
    const child = parent.cssRules.item(0)!;
    if (!(child instanceof CSSStyleRuleImpl)) throw new Error('Expected a nested style rule');
    const grandchild = child.cssRules.item(0)!;
    if (!(grandchild instanceof CSSStyleRuleImpl)) throw new Error('Expected a nested style rule');

    expect(serializeSelectorList(child.selectors)).toBe('& .item');
    expect(child.selectors.specificity).toEqual({ a: 1, b: 1, c: 0 });
    expect(serializeSelectorList(grandchild.selectors)).toBe('& > .label');
    expect(grandchild.selectors.specificity).toEqual({ a: 1, b: 2, c: 0 });
  });
});
