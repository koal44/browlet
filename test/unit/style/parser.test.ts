import { describe, expect, it } from 'vitest';
import { ColorName, ColorSourceKind } from '../../../src/stylelet/parser/color';
import { parseStylesheet } from '../../../src/stylelet/parser/stylesheet';
import { AtRuleKind, BlockItemKind, PropertyId, RuleKind } from '../../../src/stylelet/parser/types';

const cls = (raw: string) => ({ compound: { classes: [{ raw }] } });
const id = (raw: string) => ({ compound: { id: { raw } } });
const arm = (...parts: unknown[]) => ({ parts });

const rawDecl = (
  prop: PropertyId,
  name: string,
  value: string,
  important = false,
) => ({
  kind: BlockItemKind.Declaration,
  raw: true,
  prop,
  name,
  value,
  important,
});

const namedColorDecl = (
  prop: PropertyId.Color | PropertyId.BackgroundColor,
  name: ColorName,
  important = false,
) => ({
  kind: BlockItemKind.Declaration,
  prop,
  value: {
    source: {
      kind: ColorSourceKind.Named,
      name,
    },
  },
  important,
});

describe('parseStylesheet', () => {
  it('parses an empty stylesheet', () => {
    expect(parseStylesheet('')).toMatchObject({ rules: [] });
  });

  it('parses a style rule with a typed color declaration', () => {
    expect(parseStylesheet('.foo { color: red; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [namedColorDecl(PropertyId.Color, ColorName.red)] },
      }],
    });
  });

  it('parses selector lists before style blocks', () => {
    expect(parseStylesheet('.foo, #bar { color: red; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo')), arm(id('bar'))] },
        block: { items: [namedColorDecl(PropertyId.Color, ColorName.red)] },
      }],
    });
  });

  it('parses important raw declarations', () => {
    expect(parseStylesheet('.foo { font-size: 12px !important; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [rawDecl(PropertyId.FontSize, 'font-size', '12px', true)] },
      }],
    });
  });

  it('keeps unknown declarations as raw declarations', () => {
    expect(parseStylesheet('.foo { banana-mode: turbo; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [rawDecl(PropertyId.Unknown, 'banana-mode', 'turbo')] },
      }],
    });
  });

  it('does not split declaration values on semicolons inside strings or functions', () => {
    expect(parseStylesheet('.foo { background-image: url("x;y"); color: red; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: {
          items: [
            rawDecl(PropertyId.BackgroundImage, 'background-image', 'url("x;y")'),
            namedColorDecl(PropertyId.Color, ColorName.red),
          ],
        },
      }],
    });
  });

  it('parses semicolon at-rules', () => {
    expect(parseStylesheet('@import url("x.css");')).toMatchObject({
      rules: [{
        kind: RuleKind.At,
        at: AtRuleKind.Import,
        name: 'import',
        prelude: 'url("x.css")',
      }],
    });
  });

  it('parses block at-rules as raw blocks for now', () => {
    expect(parseStylesheet('@media screen { .foo { color: red; } }')).toMatchObject({
      rules: [{
        kind: RuleKind.At,
        at: AtRuleKind.Media,
        name: 'media',
        prelude: 'screen',
        block: '{ .foo { color: red; } }',
      }],
    });
  });

  it('recovers malformed declarations as invalid block items', () => {
    expect(parseStylesheet('.foo { color red; background: blue; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: {
          items: [
            {
              kind: BlockItemKind.Invalid,
              source: 'color red;',
            },
            rawDecl(PropertyId.Background, 'background', 'blue'),
          ],
        },
      }],
    });
  });

  it('throws on unclosed style blocks', () => {
    expect(() => parseStylesheet('.foo { color: red;')).toThrow();
  });

  it('recovers invalid selector preludes as invalid rules', () => {
    expect(parseStylesheet('.foo, { color: red; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Invalid,
        source: '.foo, { color: red; }',
      }],
    });
  });
});
