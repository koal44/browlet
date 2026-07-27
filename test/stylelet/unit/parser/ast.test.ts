import { describe, expect, it } from 'vitest';
import { ColorKind, type ColorName } from '../../../../src/stylelet/values/color';
import { parseStylesheet } from '../../../../src/stylelet/parser/ast';
import {
  AtRuleKindAst, BlockItemAstKind, PropertyId,
  RuleKindAst,
} from '../../../../src/stylelet/parser/types';
import type { LengthUnit } from '../../../../src/stylelet/values/numeric-literal/length';
import { TokenKind } from '../../../../src/stylelet/parser/tokens';

const cls = (name: string) => ({ unit: { compound: { subclasses: [{ name }] } } });
const id = (name: string) => ({ unit: { compound: { subclasses: [{ name }] } } });
const arm = (...parts: unknown[]) => ({ parts });

const ident = (value: string) => ({ kind: TokenKind.Ident, value });
// const ws = () => ({ kind: TokenKind.Whitespace });
// const delim = (value: string) => ({ kind: TokenKind.Delim, value });
const str = (value: string) => ({ kind: TokenKind.String, value });

const customDecl = (
  name: string,
  value: readonly unknown[],
  important = false,
) => ({
  kind: BlockItemAstKind.Declaration,
  prop: PropertyId.Custom,
  name,
  value,
  important,
});

const namedColorDecl = (prop: PropertyId.Color | PropertyId.BackgroundColor, name: ColorName, important = false) => ({
  kind: BlockItemAstKind.Declaration,
  prop,
  value: {
    kind: ColorKind.Named,
    name,
  },
  important,
});

const length = (value: number, unit: LengthUnit) => ({ type: 'length', value, unit });
const px = (value: number) => length(value, 'px');
const em = (value: number) => length(value, 'em');
const rem = (value: number) => length(value, 'rem');
const vw = (value: number) => length(value, 'vw');
const vh = (value: number) => length(value, 'vh');
const zero = () => ({ type: 'length', value: 0, unit: '' });
const auto = () => ({ type: 'auto' });
const percent = (value: number) => ({ type: 'percentage', value });

const marginSideDecl = (
  prop: PropertyId.MarginTop | PropertyId.MarginRight | PropertyId.MarginBottom | PropertyId.MarginLeft,
  value: unknown,
  important = false,
) => ({
  kind: BlockItemAstKind.Declaration,
  prop,
  value,
  important,
});

function expectAst<T>(actual: T, _label?: string) {
  const callsite = new Error();

  return {
    toMatchObject(expected: object | any[]): void {
      try {
        expect(actual).toMatchObject(expected);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const stack = callsite.stack?.split('\n').slice(2).join('\n');
        if (stack) {
          error.stack = `${error.name}: ${error.message}\n${stack}`;
        }

        throw error;
      }
    },
  };
}

describe('parseStylesheet', () => {
  it('parses an empty stylesheet', () => {
    expect(parseStylesheet('')).toMatchObject({ rules: [] });
  });

  it('parses a style rule with a typed color declaration', () => {
    expect(parseStylesheet('.foo { color: red; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: { items: [namedColorDecl(PropertyId.Color, 'red')] },
      }],
    });
  });

  it('parses selector lists before style blocks', () => {
    expect(parseStylesheet('.foo, #bar { color: red; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo')), arm(id('bar'))] },
        block: { items: [namedColorDecl(PropertyId.Color, 'red')] },
      }],
    });
  });

  it('parses custom properties as raw declarations', () => {
    expect(parseStylesheet('.foo { --banana-mode: turbo; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: { items: [customDecl('--banana-mode', [ident('turbo')])] },
      }],
    });
  });

  // it('parses important raw declarations', () => {
  //   expect(parseStylesheet('.foo { font-size: 12px !important; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selectorList: { arms: [arm(cls('foo'))] },
  //       block: { items: [rawDecl(PropertyId.FontSize, 'font-size', '12px', true)] },
  //     }],
  //   });
  // });

  it('recovers unknown non-custom declarations as invalid block items', () => {
    expect(parseStylesheet('.foo { banana-mode: turbo; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: { items: [] },
      }],
    });
  });

  // it('keeps custom properties as raw declarations', () => {
  //   expect(parseStylesheet('.foo { --banana-mode: turbo; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selectorList: { arms: [arm(cls('foo'))] },
  //       block: { items: [rawDecl(PropertyId.Unknown, '--banana-mode', 'turbo')] },
  //     }],
  //   });
  // });

  // it('does not split declaration values on semicolons inside strings or functions', () => {
  //   expect(parseStylesheet('.foo { background-image: url("x;y"); color: red; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selectorList: { arms: [arm(cls('foo'))] },
  //       block: {
  //         items: [
  //           rawDecl(PropertyId.BackgroundImage, 'background-image', 'url("x;y")'),
  //           namedColorDecl(PropertyId.Color, 'red'),
  //         ],
  //       },
  //     }],
  //   });
  // });

  it.skip('parses semicolon at-rules', () => {
    expect(parseStylesheet('@import url("x.css");')).toMatchObject({
      rules: [{
        kind: RuleKindAst.At,
        at: AtRuleKindAst.Import,
        name: 'import',
        prelude: 'url("x.css")',
      }],
    });
  });

  it.skip('parses block at-rules as raw blocks for now', () => {
    expect(parseStylesheet('@media screen { .foo { color: red; } }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.At,
        at: AtRuleKindAst.Media,
        name: 'media',
        prelude: 'screen',
        block: '{ .foo { color: red; } }',
      }],
    });
  });

  it.skip('does not split at-rule preludes on semicolons inside strings', () => {
    expect(parseStylesheet('@import url("x;y.css");')).toMatchObject({
      rules: [{
        kind: RuleKindAst.At, at: AtRuleKindAst.Import,
        name: 'import', prelude: 'url("x;y.css")',
      }],
    });
  });

  it.skip('does not split block at-rule preludes on semicolons inside strings', () => {
    expect(parseStylesheet('@supports (content: "x;y") { .foo { color: red; } }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.At, at: AtRuleKindAst.Supports,
        name: 'supports', prelude: '(content: "x;y")', block: '{ .foo { color: red; } }',
      }],
    });
  });

  // it('recovers malformed declarations as invalid block items', () => {
  //   expect(parseStylesheet('.foo { color red; background: blue; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selectorList: { arms: [arm(cls('foo'))] },
  //       block: {
  //         items: [
  //           {
  //             kind: BlockItemKind.Invalid,
  //             source: 'color red;',
  //           },
  //           rawDecl(PropertyId.Background, 'background', 'blue'),
  //         ],
  //       },
  //     }],
  //   });
  // });

  it('recovers unclosed style blocks at EOF', () => {
    expect(parseStylesheet('.foo { color: red;')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        block: { items: [namedColorDecl(PropertyId.Color, 'red')] },
      }],
    });
  });

  it.skip('recovers invalid selector preludes as invalid rules', () => {
    expect(parseStylesheet('.foo, { color: red; }')).toMatchObject({
      rules: [],
    });
  });

  it('parses margin side length declarations', () => {
    expect(parseStylesheet('.foo { margin-left: 3px; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: { items: [marginSideDecl(PropertyId.MarginLeft, px(3))] },
      }],
    });
  });

  it('parses important margin side declarations', () => {
    expect(parseStylesheet('.foo { margin-left: 3px !important; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: { items: [marginSideDecl(PropertyId.MarginLeft, px(3), true)] },
      }],
    });
  });

  it('recovers empty margin side declarations', () => {
    expect(parseStylesheet('.foo { margin-left: ; margin-left: 3px; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: {
          items: [marginSideDecl(PropertyId.MarginLeft, px(3))],
        },
      }],
    });
  });

  it('recovers invalid margin side values', () => {
    expect(parseStylesheet('.foo { margin-left: nonsense; margin-left: 3px; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: {
          items: [marginSideDecl(PropertyId.MarginLeft, px(3))],
        },
      }],
    });
  });

  it('parses margin side auto declarations', () => {
    expect(parseStylesheet('.foo { margin-left: auto; }')).toMatchObject({
      rules: [{
        block: { items: [marginSideDecl(PropertyId.MarginLeft, auto())] },
      }],
    });
  });

  it('parses margin side percentage declarations', () => {
    expect(parseStylesheet('.foo { margin-left: 10%; }')).toMatchObject({
      rules: [{
        block: { items: [marginSideDecl(PropertyId.MarginLeft, percent(10))] },
      }],
    });
  });

  it('parses negative margin side percentage declarations', () => {
    expectAst(parseStylesheet('.foo { margin-left: -10%; }')).toMatchObject({
      rules: [{
        block: { items: [marginSideDecl(PropertyId.MarginLeft, percent(-10))] },
      }],
    });
  });

  it('parses margin side math functions', () => {
    expect(parseStylesheet('.foo { margin-left: calc(1px + 2px); }'))
      .toMatchObject({
        rules: [{
          block: {
            items: [marginSideDecl(PropertyId.MarginLeft, {
              type: 'math',
              calculation: {
                type: 'dimension',
                value: 3,
                unit: 'px',
              },
            })],
          },
        }],
      });
  });

  it('parses margin side values', () => {
    const cases = [
      ['px length', '.foo { margin-left: 3px; }', [marginSideDecl(PropertyId.MarginLeft, px(3))]],
      ['negative em length', '.foo { margin-top: -2em; }', [marginSideDecl(PropertyId.MarginTop, em(-2))]],
      ['rem decimal length', '.foo { margin-right: .5rem; }', [marginSideDecl(PropertyId.MarginRight, rem(0.5))]],
      ['viewport length', '.foo { margin-bottom: 10vh; }', [marginSideDecl(PropertyId.MarginBottom, vh(10))]],
      ['viewport length', '.foo { margin-bottom: 10vw; }', [marginSideDecl(PropertyId.MarginBottom, vw(10))]],
      ['unitless zero', '.foo { margin-left: 0; }', [marginSideDecl(PropertyId.MarginLeft, zero())]],
      ['positive percentage', '.foo { margin-top: 10%; }', [marginSideDecl(PropertyId.MarginTop, percent(10))]],
      ['negative percentage', '.foo { margin-bottom: -10%; }', [marginSideDecl(PropertyId.MarginBottom, percent(-10))]],
      ['auto keyword', '.foo { margin-right: auto; }', [marginSideDecl(PropertyId.MarginRight, auto())]],
      ['case-insensitive keyword/unit', '.foo { margin-left: AUTO; margin-right: 3PX; }', [
        marginSideDecl(PropertyId.MarginLeft, auto()),
        marginSideDecl(PropertyId.MarginRight, px(3)),
      ]],
    ] as const;

    for (const [name, css, items] of cases) {
      expectAst(parseStylesheet(css), name).toMatchObject({
        rules: [{
          kind: RuleKindAst.Style,
          block: { items },
        }],
      });
    }
  });

  it('recovers invalid margin side values', () => {
    const cases = [
      ['empty value', '.foo { margin-left: ; margin-left: 3px; }', 'margin-left: ;', PropertyId.MarginLeft],
      ['unknown ident', '.foo { margin-top: nonsense; margin-top: 3px; }', 'margin-top: nonsense;', PropertyId.MarginTop],
      ['unsupported unit', '.foo { margin-right: 3foo; margin-right: 3px; }', 'margin-right: 3foo;', PropertyId.MarginRight],
      ['nonzero unitless number', '.foo { margin-bottom: 3; margin-bottom: 3px; }', 'margin-bottom: 3;', PropertyId.MarginBottom],
      ['deferred var function', '.foo { margin-right: var(--gap); margin-right: 3px; }', 'margin-right: var(--gap);', PropertyId.MarginRight],
      ['adjacent lengths are one invalid dimension token', '.foo { margin-left: 1em2em; margin-left: 3px; }', 'margin-left: 1em2em;', PropertyId.MarginLeft],
    ] as const;

    for (const [name, css, _source, prop] of cases) {
      expectAst(parseStylesheet(css), name).toMatchObject({
        rules: [{
          kind: RuleKindAst.Style,
          block: {
            items: [marginSideDecl(prop, px(3))],
          },
        }],
      });
    }
  });

  it('parses final important in custom properties as declaration priority', () => {
    expect(parseStylesheet('.foo { --x: foo !important; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: { items: [customDecl('--x', [ident('foo')], true)] },
      }],
    });
  });

  it('drops non-final important text in custom property values', () => {
    expect(parseStylesheet('.foo { --x: foo !important bar; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        block: { items: [] },
      }],
    });
  });

  it('keeps important text inside custom property strings', () => {
    expect(parseStylesheet('.foo { --x: "foo !important"; }')).toMatchObject({
      rules: [{
        kind: RuleKindAst.Style,
        selectorList: { arms: [arm(cls('foo'))] },
        block: { items: [customDecl('--x', [str('foo !important')])] },
      }],
    });
  });

});
