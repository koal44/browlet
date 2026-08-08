import { describe, expect, it } from 'vitest';

import {
  propertyRegistry,
  type BuiltInPropertyDeclaration, type CustomPropertyDeclaration,
} from '../../../../src/stylelet/css/property';
import {
  parseStylesheet, type StyleSheet,
} from '../../../../src/stylelet/css/stylesheet';
import { parseOptionalDeclarationValue } from '../../../../src/stylelet/syntax/declaration-value';
import { parseSelectorList } from '../../../../src/stylelet/syntax/selector';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { ColorKind } from '../../../../src/stylelet/values/color';

describe('CSS stylesheet', () => {
  it('retains its location and explicit base URL', () => {
    const location = new URL('https://example.com/styles/site.css');
    const baseUrl = new URL('https://cdn.example.com/assets/');

    expect(parseStylesheet('* {}', { location, baseUrl })).toMatchObject({
      location,
      baseUrl,
    });
  });

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
    const sheet: StyleSheet = {
      rules: [{
        type: 'style-rule',
        selectors: parseSelectorList('*')!,
        block: [{
          type: 'property-declaration',
          custom: false,
          name: 'color',
          value: propertyRegistry.color.parse('var(--accent)')!,
          important: false,
        }, custom],
      }],
    };

    const rule = sheet.rules[0];
    expect(rule.type).toBe('style-rule');
    if (rule.type !== 'style-rule') throw new Error('Expected a style rule');

    expect(rule.block.map((item) =>
      item.type === 'property-declaration' ? item.name : item.type
    )).toEqual(['color', '--accent']);
  });

  it('interprets valid declarations and discards invalid declarations', () => {
    const sheet = parseStylesheet(`
      * {
        COLOR: blue;
        unknown: red;
        color: definitely-not-a-color;
        --Accent: red !important;
      }
    `);

    expect(sheet.rules).toHaveLength(1);
    expect(sheet.rules[0]).toMatchObject({
      type: 'style-rule',
      block: [{
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
      }],
    });
    expect(sheet.originalText).toContain('--Accent: red !important');
    const rule = sheet.rules[0];
    expect(rule.type).toBe('style-rule');
    if (rule.type !== 'style-rule') throw new Error('Expected a style rule');

    expect(rule.block[1]).toMatchObject({
      originalText: 'red',
    });
  });

  it('discards invalid style rules and unrecognized at-rules, including @charset', () => {
    const sheet = parseStylesheet(`
      @charset "utf-8";
      @unknown example;
      , { color: red }
      * { color: blue }
    `);

    expect(sheet.rules).toHaveLength(1);
    expect(sheet.rules[0]).toMatchObject({
      type: 'style-rule',
      block: [{ name: 'color' }],
    });
  });

  it('retains substitution for later value resolution', () => {
    const sheet = parseStylesheet(`
      * { color: var(--accent) }
    `);

    expect(sheet.rules[0]).toMatchObject({
      block: [{
        custom: false,
        name: 'color',
        value: { type: 'substitution-value' },
      }],
    });
  });

  // CSS Nesting Level 1 defines nested style-rule parsing, including the `&`
  // selector and its parent-dependent semantics.
  it.skip('interprets qualified rules inside a style block as nested style rules', () => {
    const sheet = parseStylesheet(`
      .parent {
        color: blue;
        &:hover { color: red }
        --accent: green;
      }
    `);

    expect(sheet.rules[0]).toMatchObject({
      type: 'style-rule',
      block: [{
        name: 'color',
      }, {
        type: 'style-rule',
        block: [{ name: 'color' }],
      }, {
        name: '--accent',
      }],
    });
  });
});
