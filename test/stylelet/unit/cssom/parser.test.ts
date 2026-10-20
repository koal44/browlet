import { describe, expect, it } from 'vitest';

import { defaultStyleletEnvironment as env } from '../../../../src/stylelet/environment';
import {
  propertyRegistry,
  type BuiltInPropertyDeclaration, type CustomPropertyDeclaration,
} from '../../../../src/stylelet/css/property';
import { parseCSSRules } from '../../../../src/stylelet/cssom/parser';
import { CSSStyleRuleImpl, CSSNestedDeclarationsImpl } from '../../../../src/stylelet/cssom/rules';
import { parseOptionalDeclarationValue } from '../../../../src/stylelet/syntax/declaration-value';
import {
  parseSelectorList, serializeSelectorList,
} from '../../../../src/stylelet/selector/parser';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { ColorKind } from '../../../../src/stylelet/values/color';

describe('CSS rule construction', () => {
  it('preserves the registry association in a built-in declaration', () => {
    const declaration: BuiltInPropertyDeclaration = {
      type: 'property-declaration',
      custom: false,
      name: 'color',
      value: propertyRegistry.color.parse('red')!,
      important: false,
    };
    const resolved = declaration.value.resolve(ValueStage.Computed, {});

    expect(resolved?.type).toBe('ordinary');
    if (resolved?.type === 'ordinary') {
      expect(resolved.value.kind).toBe(ColorKind.Absolute);
    }
  });

  it('holds built-in and custom declarations in source order', () => {
    const custom: CustomPropertyDeclaration = {
      type: 'property-declaration',
      custom: true,
      name: '--accent',
      value: parseOptionalDeclarationValue('red')!,
      important: false,
    };
    const rule = new CSSStyleRuleImpl(parseSelectorList('*')!, [{
      type: 'property-declaration',
      custom: false,
      name: 'color',
      value: propertyRegistry.color.parse('var(--accent)')!,
      important: false,
    }, custom], env);

    expect(rule.style.declarations.map((declaration) => declaration.name))
      .toEqual(['color', '--accent']);
  });

  it('interprets valid declarations and discards invalid declarations', () => {
    const rules = parseCSSRules(`
      * {
        COLOR: blue;
        unknown: red;
        color: definitely-not-a-color;
        --Accent: red !important;
      }
    `, env);

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

  it('discards invalid style rules and unrecognized at-rules, including @charset', () => {
    const rules = parseCSSRules(`
      @charset "utf-8";
      @unknown example;
      , { color: red }
      * { color: blue }
    `, env);

    expect(rules).toHaveLength(1);
    expect(rules[0]).toBeInstanceOf(CSSStyleRuleImpl);
    expect((rules[0] as CSSStyleRuleImpl).style.declarations)
      .toMatchObject([{ name: 'color' }]);
  });

  it('retains substitution for later value resolution', () => {
    const [rule] = parseCSSRules('* { color: var(--accent) }', env);

    expect((rule as CSSStyleRuleImpl).style.declarations).toMatchObject([{
      custom: false,
      name: 'color',
      value: { type: 'substitution-value' },
    }]);
  });

  // CSS Nesting Level 1 defines nested style rules and declaration runs.
  it('keeps declarations after nested rules separate from the parent style', () => {
    const [rule] = parseCSSRules(`
      .parent {
        color: blue;
        &:hover { color: red }
        --accent: green;
      }
    `, env);

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

  it('binds nested selectors recursively to their parent style rules', () => {
    const [parent] = parseCSSRules(`
      #featured, article {
        .item {
          > .label { color: red }
        }
      }
    `, env);
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
