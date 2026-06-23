import { describe, expect, it } from 'vitest';
import { ColorName, ColorSourceKind } from '../../../src/stylelet/values/color';
import { parseStylesheet } from '../../../src/stylelet/parser/stylesheet';
import { AtRuleKind, BlockItemKind, PropertyId, RuleKind } from '../../../src/stylelet/parser/types';
import { LengthUnit } from '../../../src/stylelet/values/length';

const cls = (raw: string) => ({ compound: { classes: [{ raw }] } });
const id = (raw: string) => ({ compound: { id: { raw } } });
const arm = (...parts: unknown[]) => ({ parts });

const customDecl = (
  name: string,
  value: string,
  important = false,
) => ({
  kind: BlockItemKind.Declaration,
  prop: PropertyId.Custom,
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

const invalidItem = (source: string, reason?: unknown) => ({
  kind: BlockItemKind.Invalid,
  source,
  ...(reason === undefined ? {} : { reason }),
});

const length = (value: number, unit: LengthUnit) => ({
  type: 'length',
  value,
  unit,
});

const px = (value: number) => length(value, LengthUnit.Px);
const em = (value: number) => length(value, LengthUnit.Em);
const rem = (value: number) => length(value, LengthUnit.Rem);
const vw = (value: number) => length(value, LengthUnit.Vw);
const vh = (value: number) => length(value, LengthUnit.Vh);
const zero = () => length(0, LengthUnit.None);

const auto = () => ({ type: 'auto' });
const percent = (value: number) => ({ type: 'percentage', value });

const marginSideDecl = (
  prop: PropertyId.MarginTop | PropertyId.MarginRight | PropertyId.MarginBottom | PropertyId.MarginLeft,
  value: unknown,
  important = false,
) => ({
  kind: BlockItemKind.Declaration,
  prop,
  value,
  important,
});

function expectAst<T>(actual: T, label?: string) {
  const callsite = new Error();

  return {
    toMatchObject(expected: object | any[]): void {
      try {
        expect(actual).toMatchObject(expected);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const diagnostic = formatInvalidAstDiagnostic(actual);
        const header = label ? `Case: ${label}\n\n` : '';

        if (diagnostic) {
          error.message = `${header}${diagnostic}\n\n${error.message}`;
        } else if (label) {
          error.message = `${header}${error.message}`;
        }

        const stack = callsite.stack?.split('\n').slice(2).join('\n');
        if (stack) {
          error.stack = `${error.name}: ${error.message}\n${stack}`;
        }

        throw error;
      }
    },
  };
}

function formatInvalidAstDiagnostic(value: unknown): string | undefined {
  const hits: string[] = [];

  const visit = (node: unknown, path = '$'): void => {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }

    const obj = node as Record<string, unknown>;

    const isInvalidAstNode =
      'source' in obj &&
      (
        obj.kind === BlockItemKind.Invalid ||
        obj.kind === RuleKind.Invalid
      );

    if (isInvalidAstNode) {
      const label =
        obj.kind === RuleKind.Invalid
          ? 'invalid rule'
          : obj.kind === BlockItemKind.Invalid
            ? 'invalid block item'
            : 'AST node with reason';

      hits.push(formatInvalidAstNode(label, prettyPath(path), obj));
    }

    for (const [key, child] of Object.entries(obj)) {
      visit(child, `${path}.${key}`);
    }
  };

  visit(value);

  if (hits.length === 0) return undefined;

  return [
    'Invalid AST in received stylesheet',
    '',
    ...hits,
  ].join('\n');
}

function formatInvalidAstNode(label: string, path: string, obj: Record<string, unknown>): string {
  return [
    `${path} ${label}:`,
    '  reason:',
    indent('reason' in obj ? obj.reason : '(missing reason)', '    '),
    `  source: ${JSON.stringify(obj.source)}`,
  ].join('\n');
}

function indent(value: unknown, prefix: string): string {
  return String(value).split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function prettyPath(path: string): string {
  return path === '$' ? 'stylesheet' : path.replace(/^\$\./, '');
}

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

  it('parses custom properties as raw declarations', () => {
    expect(parseStylesheet('.foo { --banana-mode: turbo; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [customDecl('--banana-mode', 'turbo')] },
      }],
    });
  });

  // it('parses important raw declarations', () => {
  //   expect(parseStylesheet('.foo { font-size: 12px !important; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selector: { arms: [arm(cls('foo'))] },
  //       block: { items: [rawDecl(PropertyId.FontSize, 'font-size', '12px', true)] },
  //     }],
  //   });
  // });

  it('recovers unknown non-custom declarations as invalid block items', () => {
    expect(parseStylesheet('.foo { banana-mode: turbo; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [invalidItem('banana-mode: turbo;')] },
      }],
    });
  });

  // it('keeps custom properties as raw declarations', () => {
  //   expect(parseStylesheet('.foo { --banana-mode: turbo; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selector: { arms: [arm(cls('foo'))] },
  //       block: { items: [rawDecl(PropertyId.Unknown, '--banana-mode', 'turbo')] },
  //     }],
  //   });
  // });

  // it('does not split declaration values on semicolons inside strings or functions', () => {
  //   expect(parseStylesheet('.foo { background-image: url("x;y"); color: red; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selector: { arms: [arm(cls('foo'))] },
  //       block: {
  //         items: [
  //           rawDecl(PropertyId.BackgroundImage, 'background-image', 'url("x;y")'),
  //           namedColorDecl(PropertyId.Color, ColorName.red),
  //         ],
  //       },
  //     }],
  //   });
  // });

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

  it('does not split at-rule preludes on semicolons inside strings', () => {
    expect(parseStylesheet('@import url("x;y.css");')).toMatchObject({
      rules: [{
        kind: RuleKind.At, at: AtRuleKind.Import,
        name: 'import', prelude: 'url("x;y.css")',
      }],
    });
  });

  it('does not split block at-rule preludes on semicolons inside strings', () => {
    expect(parseStylesheet('@supports (content: "x;y") { .foo { color: red; } }')).toMatchObject({
      rules: [{
        kind: RuleKind.At, at: AtRuleKind.Supports,
        name: 'supports', prelude: '(content: "x;y")', block: '{ .foo { color: red; } }',
      }],
    });
  });

  // it('recovers malformed declarations as invalid block items', () => {
  //   expect(parseStylesheet('.foo { color red; background: blue; }')).toMatchObject({
  //     rules: [{
  //       kind: RuleKind.Style,
  //       selector: { arms: [arm(cls('foo'))] },
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

  it('parses margin side length declarations', () => {
    expect(parseStylesheet('.foo { margin-left: 3px; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [marginSideDecl(PropertyId.MarginLeft, px(3))] },
      }],
    });
  });

  it('parses important margin side declarations', () => {
    expect(parseStylesheet('.foo { margin-left: 3px !important; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [marginSideDecl(PropertyId.MarginLeft, px(3), true)] },
      }],
    });
  });

  it('recovers empty margin side declarations as invalid block items', () => {
    expect(parseStylesheet('.foo { margin-left: ; margin-left: 3px; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: {
          items: [
            invalidItem('margin-left: ;'),
            marginSideDecl(PropertyId.MarginLeft, px(3)),
          ],
        },
      }],
    });
  });

  it('recovers invalid margin side values as invalid block items', () => {
    expect(parseStylesheet('.foo { margin-left: nonsense; margin-left: 3px; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: {
          items: [
            invalidItem('margin-left: nonsense;'),
            marginSideDecl(PropertyId.MarginLeft, px(3)),
          ],
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

  it('parses margin side length-percentage-auto values', () => {
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
          kind: RuleKind.Style,
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
      ['deferred calc function', '.foo { margin-left: calc(1px + 2px); margin-left: 3px; }', 'margin-left: calc(1px + 2px);', PropertyId.MarginLeft],
      ['deferred var function', '.foo { margin-right: var(--gap); margin-right: 3px; }', 'margin-right: var(--gap);', PropertyId.MarginRight],
      ['adjacent lengths are one invalid dimension token', '.foo { margin-left: 1em2em; margin-left: 3px; }', 'margin-left: 1em2em;', PropertyId.MarginLeft],
    ] as const;

    for (const [name, css, invalid, prop] of cases) {
      expectAst(parseStylesheet(css), name).toMatchObject({
        rules: [{
          kind: RuleKind.Style,
          block: {
            items: [
              invalidItem(invalid),
              marginSideDecl(prop, px(3)),
            ],
          },
        }],
      });
    }
  });

  it('parses final important in custom properties as declaration priority', () => {
    expect(parseStylesheet('.foo { --x: foo !important; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [customDecl('--x', 'foo', true)] },
      }],
    });
  });

  it('keeps non-final important text inside custom property values', () => {
    expect(parseStylesheet('.foo { --x: foo !important bar; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [customDecl('--x', 'foo !important bar')] },
      }],
    });
  });

  it('keeps important text inside custom property strings', () => {
    expect(parseStylesheet('.foo { --x: "foo !important"; }')).toMatchObject({
      rules: [{
        kind: RuleKind.Style,
        selector: { arms: [arm(cls('foo'))] },
        block: { items: [customDecl('--x', '"foo !important"')] },
      }],
    });
  });

});
