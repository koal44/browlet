import { describe, expect, test } from 'vitest';
import {
  isComponentBlock, type BlockKind, type ComponentValue, type PreservedToken,
} from '../../../../src/stylelet/syntax/component-value';
import {
  parseBlockContents, parseCommaSeparatedListOfComponentValues, parseComponentValue,
  parseDeclaration, parseListOfComponentValues, parseRule, parseStylesheet,
  parseStylesheetContents,
} from '../../../../src/stylelet/syntax/parser';
import {
  type BlockAtRule, type BlockContents, type Declaration,
  type NestedDeclarationsRule, type QualifiedRule, type Rule, type StatementAtRule,
} from '../../../../src/stylelet/syntax/rule';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';

function preservedKinds(values: readonly ComponentValue[]): TokenKind[] {
  return values
    .filter((value): value is PreservedToken => !isComponentBlock(value))
    .map((value) => value.type);
}

function expectRule(value: Rule | Declaration[] | null | undefined): Rule {
  expect(value).toBeTruthy();
  expect(Array.isArray(value)).toBe(false);
  return value as Rule;
}

function expectStatementAtRule(
  value: Rule | Declaration[] | null | undefined,
): StatementAtRule {
  const rule = expectRule(value);
  expect(rule.kind).toBe('statement-at-rule');
  return rule as StatementAtRule;
}

function expectBlockAtRule(
  value: Rule | Declaration[] | null | undefined,
): BlockAtRule {
  const rule = expectRule(value);
  expect(rule.kind).toBe('block-at-rule');
  return rule as BlockAtRule;
}

function expectQualifiedRule(
  value: Rule | Declaration[] | null | undefined,
): QualifiedRule {
  const rule = expectRule(value);
  expect(rule.kind).toBe('qualified-rule');
  return rule as QualifiedRule;
}

function expectNestedDeclarationsRule(
  value: Rule | Declaration[] | null | undefined,
): NestedDeclarationsRule {
  const rule = expectRule(value);
  expect(rule.kind).toBe('nested-declarations-rule');
  return rule as NestedDeclarationsRule;
}

function expectDeclarations(
  value: Rule | Declaration[] | null | undefined,
): Declaration[] {
  expect(Array.isArray(value)).toBe(true);
  return value as Declaration[];
}

function expectDeclaration(value: Declaration | null | undefined): Declaration {
  expect(value).toBeTruthy();
  return value!;
}

function expectPreservedToken(
  value: ComponentValue | null | undefined,
  type: TokenKind,
): PreservedToken {
  expect(value).toBeTruthy();
  expect(isComponentBlock(value!)).toBe(false);
  expect(value!.type).toBe(type);
  return value as PreservedToken;
}

function expectSimpleBlock(
  value: ComponentValue | null | undefined,
  type: BlockKind,
): { type: BlockKind; value: ComponentValue[]; } {
  expect(value).toBeTruthy();
  expect(value!.type).toBe(type);
  return value as { type: BlockKind; value: ComponentValue[]; };
}

function expectFunctionBlock(
  value: ComponentValue | null | undefined,
  name: string,
): { name: string; value: ComponentValue[]; } {
  expect(value).toBeTruthy();
  expect('name' in value!).toBe(true);
  expect((value as { name: string; }).name).toBe(name);
  return value as { name: string; value: ComponentValue[]; };
}

describe('5.4 parser entry points', () => {
  test('parses a stylesheet and its contents', () => {
    const sheet = parseStylesheet('@layer reset; .a { color: red }');
    const rules = parseStylesheetContents('@layer reset; .a { color: red }');

    expect(sheet.rules).toEqual(rules);
    expectStatementAtRule(rules[0]);

    const style = expectQualifiedRule(rules[1]);
    expect(style.declarations).toHaveLength(1);
    expect(style.declarations[0].name).toBe('color');
  });

  test('ignores whitespace, CDO, and CDC in stylesheet contents', () => {
    const rules = parseStylesheetContents('<!-- .a {} --> @layer x;');

    expect(rules).toHaveLength(2);
    expectQualifiedRule(rules[0]);
    expectStatementAtRule(rules[1]);
  });

  test('parses block contents as ordered declaration runs and rules', () => {
    const contents = parseBlockContents(
      'color: red; width: 1px; & {} height: 2px; @x; opacity: .5',
    );

    expect(contents).toHaveLength(5);
    expect(expectDeclarations(contents[0])).toHaveLength(2);
    expectQualifiedRule(contents[1]);
    expect(expectDeclarations(contents[2])[0].name).toBe('height');
    expectStatementAtRule(contents[3]);
    expect(expectDeclarations(contents[4])[0].name).toBe('opacity');
  });

  test('retains the final declaration run at EOF', () => {
    const contents = parseBlockContents('color: red; width: 1px');

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual([
      'color',
      'width',
    ]);
  });

  test('parses exactly one rule with surrounding whitespace', () => {
    expectStatementAtRule(parseRule('  @layer x;  '));
    expectQualifiedRule(parseRule('  .a {}  '));
    expect(parseRule('')).toBeNull();
    expect(parseRule('.a')).toBeNull();
    expect(parseRule('.a {} .b {}')).toBeNull();
  });

  test('returns null for empty component-value input', () => {
    expect(parseComponentValue('')).toBeNull();
    expect(parseComponentValue(' \n\t ')).toBeNull();
    expect(parseListOfComponentValues('')).toEqual([]);
  });

  test('parses one declaration', () => {
    const declaration = expectDeclaration(parseDeclaration(' color: red !important'));

    expect(declaration.name).toBe('color');
    expect(declaration.important).toBe(true);
    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);

    expect(parseDeclaration('color red')).toBeNull();
    expect(parseDeclaration('@x;')).toBeNull();
  });

  test('parses one component value or a list', () => {
    expectPreservedToken(parseComponentValue('red'), TokenKind.Ident);
    expectSimpleBlock(parseComponentValue('[x]'), TokenKind.BracketBlock);
    expectFunctionBlock(parseComponentValue('fn(x)'), 'fn');
    expect(parseComponentValue('red blue')).toBeNull();

    const values = parseListOfComponentValues('red [x] fn(y)');
    expect(values).toHaveLength(5);
    expectSimpleBlock(values[2], TokenKind.BracketBlock);
    expectFunctionBlock(values[4], 'fn');
  });

  test('parses comma-separated component values with editor-draft edge behavior', () => {
    expect(parseCommaSeparatedListOfComponentValues('')).toEqual([]);
    expect(parseCommaSeparatedListOfComponentValues('a,')).toHaveLength(1);
    expect(parseCommaSeparatedListOfComponentValues(',a')).toHaveLength(2);
    expect(parseCommaSeparatedListOfComponentValues('a,,b')).toHaveLength(3);

    const groups = parseCommaSeparatedListOfComponentValues('fn(a, b), [c, d], e');
    expect(groups).toHaveLength(3);
    expectFunctionBlock(groups[0][0], 'fn');
    expectSimpleBlock(groups[1][1], TokenKind.BracketBlock);
  });

  test('preserves leading and consecutive empty comma groups but omits a trailing one', () => {
    const groups = parseCommaSeparatedListOfComponentValues(',a,,b,');

    expect(groups).toHaveLength(4);
    expect(groups[0]).toEqual([]);
    expect(preservedKinds(groups[1])).toEqual([TokenKind.Ident]);
    expect(groups[2]).toEqual([]);
    expect(preservedKinds(groups[3])).toEqual([TokenKind.Ident]);
  });
});

describe('5.5 rule consumers', () => {
  test('distinguishes statement and block at-rules', () => {
    const statement = expectStatementAtRule(parseRule('@media screen;'));
    const block = expectBlockAtRule(parseRule('@media screen { .a {} }'));

    expect(statement.name).toBe('media');
    expect(preservedKinds(statement.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);

    expect(block.name).toBe('media');
    expect(block.block.declarations).toEqual([]);
    expectQualifiedRule(block.block.rules[0]);
  });

  test('returns a statement at-rule at EOF without requiring a semicolon', () => {
    const rule = expectStatementAtRule(parseRule('@charset "utf-8"'));

    expect(rule.name).toBe('charset');
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.String,
    ]);
  });

  test('keeps semicolons inside at-rule prelude components', () => {
    const rule = expectStatementAtRule(parseRule('@import url("x;y.css");'));

    expect(rule.prelude).toHaveLength(2);
    expect(rule.prelude[1]).toMatchObject({
      type: TokenKind.FunctionBlock,
      name: 'url',
    });
  });

  test('preserves component values in at-rule preludes', () => {
    const rule = expectBlockAtRule(parseRule('@x foo(bar) [baz] {}'));

    expect(rule.prelude).toHaveLength(5);
    expectFunctionBlock(rule.prelude[1], 'foo');
    expectSimpleBlock(rule.prelude[3], TokenKind.BracketBlock);
  });

  test('materializes a qualified rule body into declarations and child rules', () => {
    const rule = expectQualifiedRule(parseRule(`
      .a {
        color: red;
        & { width: 1px }
        height: 2px;
        @x;
        opacity: .5;
      }
    `));

    expect(rule.declarations.map(({ name }) => name)).toEqual(['color']);
    expect(rule.rules).toHaveLength(4);
    expectQualifiedRule(rule.rules[0]);
    expect(expectNestedDeclarationsRule(rule.rules[1]).declarations[0].name).toBe('height');
    expectStatementAtRule(rule.rules[2]);
    expect(expectNestedDeclarationsRule(rule.rules[3]).declarations[0].name).toBe('opacity');
  });

  test('parses declarations inside nested qualified rules', () => {
    const outer = expectQualifiedRule(parseRule('.a { &:hover { color: blue } }'));
    const nested = expectQualifiedRule(outer.rules[0]);

    expect(nested.declarations).toHaveLength(1);
    expect(nested.declarations[0].name).toBe('color');
  });

  test('does not reinterpret a custom-property-shaped construct as a rule', () => {
    const contents = parseBlockContents('--x:hover { color: red }; width: 1px');

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual([
      '--x',
      'width',
    ]);
  });

  test('drops a nested qualified rule that reaches EOF before its block', () => {
    expect(parseBlockContents('&:hover')).toEqual([]);
  });

  test('preserves CDO and CDC when parsing an individual qualified rule', () => {
    const cdo = expectQualifiedRule(parseRule('<!--{}'));
    const cdc = expectQualifiedRule(parseRule('-->{}'));

    expect(preservedKinds(cdo.prelude)).toEqual([TokenKind.CDO]);
    expect(preservedKinds(cdc.prelude)).toEqual([TokenKind.CDC]);
  });
});

describe('5.5 declaration recovery', () => {
  test('recovers after malformed declarations', () => {
    const contents = parseBlockContents('color red; width: 10px');

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual(['width']);
  });

  test('allows a brace block as the entire non-custom value', () => {
    const declaration = expectDeclaration(parseDeclaration('foo: { bar }'));

    expect(declaration.value).toHaveLength(1);
    expectSimpleBlock(declaration.value[0], TokenKind.BraceBlock);
  });

  test('rejects a brace block mixed with another non-custom value', () => {
    expect(parseDeclaration('foo: before { bar }')).toBeNull();
    expect(parseDeclaration('foo: { bar } after')).toBeNull();
  });

  test('allows arbitrary top-level brace blocks in custom properties', () => {
    const declaration = expectDeclaration(parseDeclaration('--foo: before { bar } after'));

    expect(declaration.value).toHaveLength(5);
    expectSimpleBlock(declaration.value[2], TokenKind.BraceBlock);
  });

  test.fails('captures the original source text of a custom property value', () => {
    const declaration = expectDeclaration(parseDeclaration('--foo:foo\\62 ar'));

    expect(declaration.originalText).toBe('foo\\62 ar');
  });

  test.fails('re-tokenizes a unicode-range descriptor from its original source', () => {
    const declaration = expectDeclaration(
      parseDeclaration('unicode-range: U+400-4FF'),
    );

    expect(declaration.value).toEqual([{
      type: TokenKind.UnicodeRange,
      start: 0x400,
      end: 0x4FF,
    }]);
  });

  test('only recognizes a final important flag', () => {
    const final = expectDeclaration(parseDeclaration('color: red ! important'));
    const mixedCase = expectDeclaration(parseDeclaration('color: red ! ImPoRtAnT'));
    const nonfinal = expectDeclaration(parseDeclaration('color: red !important blue'));

    expect(final.important).toBe(true);
    expect(mixedCase.important).toBe(true);
    expect(nonfinal.important).toBe(false);
  });

  test('trims trailing whitespace from declaration values', () => {
    const declaration = expectDeclaration(parseDeclaration('color: red   \n\t'));

    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);
  });
});

describe('5.5 component-value consumers', () => {
  test('returns preserved closing tokens directly', () => {
    expectPreservedToken(parseComponentValue('}'), TokenKind.RightBrace);
    expectPreservedToken(parseComponentValue(']'), TokenKind.RightBracket);
    expectPreservedToken(parseComponentValue(')'), TokenKind.RightParen);
  });

  test('consumes nested simple blocks and functions', () => {
    const block = expectSimpleBlock(
      parseComponentValue('{ [x] fn(y) }'),
      TokenKind.BraceBlock,
    );

    expectSimpleBlock(block.value[1], TokenKind.BracketBlock);
    expectFunctionBlock(block.value[3], 'fn');
  });

  test('automatically closes blocks and functions at EOF', () => {
    expectSimpleBlock(parseComponentValue('{ x'), TokenKind.BraceBlock);
    expectFunctionBlock(parseComponentValue('fn(x'), 'fn');
  });

  test('only the mirror token closes a simple block', () => {
    const parens = expectSimpleBlock(parseComponentValue('(x]'), TokenKind.ParensBlock);
    const brackets = expectSimpleBlock(parseComponentValue('[x)'), TokenKind.BracketBlock);

    expect(preservedKinds(parens.value)).toEqual([TokenKind.Ident, TokenKind.RightBracket]);
    expect(preservedKinds(brackets.value)).toEqual([TokenKind.Ident, TokenKind.RightParen]);
  });

  test('preserves unmatched closing tokens nested inside a block', () => {
    const block = expectSimpleBlock(parseComponentValue('{ ) ] }'), TokenKind.BraceBlock);

    expect(preservedKinds(block.value)).toEqual([
      TokenKind.Whitespace,
      TokenKind.RightParen,
      TokenKind.Whitespace,
      TokenKind.RightBracket,
      TokenKind.Whitespace,
    ]);
  });

  test('consumes nested functions and stops at the matching right parenthesis', () => {
    const fn = expectFunctionBlock(parseComponentValue('outer(inner(x))'), 'outer');
    expectFunctionBlock(fn.value[0], 'inner');

    expect(parseComponentValue('fn(x))')).toBeNull();
  });

  test('does not split on semicolons inside strings or functions', () => {
    const contents = parseBlockContents('font-family: "x;y"; x: fn(a;b); width: 1px');
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual(['font-family', 'x', 'width']);
    expect(preservedKinds(declarations[0].value)).toEqual([TokenKind.String]);
    expectFunctionBlock(declarations[1].value[0], 'fn');
  });

  test('an unterminated comment consumes the rest of the input', () => {
    const contents = parseBlockContents('width: 1px; /* unterminated height: 2px;');
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual(['width']);
  });

  test('recovers a following declaration after a bad URL token', () => {
    const contents = parseBlockContents(
      'background-image: url(foo"bar); margin-left: 4px;',
    );
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual([
      'background-image',
      'margin-left',
    ]);
    expect(preservedKinds(declarations[0].value)).toEqual([TokenKind.BadUrl]);
  });

  test('recovers after a bad string reaches a declaration boundary', () => {
    const contents = parseBlockContents(
      'font-family: "x\n; margin-left: 3px;',
    );
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual([
      'font-family',
      'margin-left',
    ]);
    expect(preservedKinds(declarations[0].value)).toContain(TokenKind.BadString);
  });

  test('does not treat a brace inside an attribute string as the rule block', () => {
    const rule = expectQualifiedRule(parseRule('.foo[data-x="{"] { color: red }'));

    expectSimpleBlock(rule.prelude[2], TokenKind.BracketBlock);
    expect(rule.declarations.map(({ name }) => name)).toEqual(['color']);
  });
});

describe('mixed token and component-value input', () => {
  test('accepts previously parsed components without rebuilding their blocks', () => {
    const components = parseListOfComponentValues('red fn(x) [y]');

    expect(parseListOfComponentValues(components)).toEqual(components);
    expect(parseComponentValue([components[2]])).toBe(components[2]);
  });

  test('parses rule bodies supplied as an existing brace block', () => {
    const components = parseListOfComponentValues('.a { color: red }');
    const rule = expectQualifiedRule(parseRule(components));

    expect(rule.declarations.map(({ name }) => name)).toEqual(['color']);
  });

  test('parses a block at-rule supplied as existing component values', () => {
    const components = parseListOfComponentValues('@media { .a {} }');
    const rule = expectBlockAtRule(parseRule(components));

    expectQualifiedRule(rule.block.rules[0]);
  });
});

function expectBlockContents(_contents: BlockContents): void {
  // Compile-time assertion that the public entry point exposes the spec shape.
}

expectBlockContents(parseBlockContents(''));
