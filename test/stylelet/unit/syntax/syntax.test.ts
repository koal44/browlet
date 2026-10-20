import { describe, expect, test } from 'vitest';
import {
  isComponentBlock, type BlockKind, type ComponentValue, type PreservedToken,
} from '../../../../src/stylelet/syntax/component-value';
import {
  parseBlockContents, parseCommaSeparatedListOfComponentValues, parseComponentValue,
  parseDeclaration, parseListOfComponentValues, parseRule, parseStylesheetContents,
  type BlockAtRule, type BlockContents, type Declaration, type QualifiedRule,
  type Rule, type StatementAtRule,
} from '../../../../src/stylelet/syntax/parser';
import { tokenize, TokenKind, type TokenList } from '../../../../src/stylelet/syntax/tokens';
import { emptyParsingContext, TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { SyntaxParsingContext } from '../../../support/stylelet-syntax';

const syntaxContext = new SyntaxParsingContext();

function preservedKinds(list: TokenList<ComponentValue>): TokenKind[] {
  return list.tokens
    .filter((component): component is PreservedToken => !isComponentBlock(component))
    .map((token) => token.type);
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
  expect(rule.type).toBe('statement-at-rule');
  return rule as StatementAtRule;
}

function expectBlockAtRule(
  value: Rule | Declaration[] | null | undefined,
): BlockAtRule {
  const rule = expectRule(value);
  expect(rule.type).toBe('block-at-rule');
  return rule as BlockAtRule;
}

function expectQualifiedRule(
  value: Rule | Declaration[] | null | undefined,
): QualifiedRule {
  const rule = expectRule(value);
  expect(rule.type).toBe('qualified-rule');
  return rule as QualifiedRule;
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
  component: ComponentValue | null | undefined,
  type: TokenKind,
): PreservedToken {
  expect(component).toBeTruthy();
  expect(isComponentBlock(component!)).toBe(false);
  expect(component!.type).toBe(type);
  return component as PreservedToken;
}

function expectSimpleBlock(
  component: ComponentValue | null | undefined,
  type: BlockKind,
): { type: BlockKind; value: TokenList<ComponentValue>; } {
  expect(component).toBeTruthy();
  expect(component!.type).toBe(type);
  return component as { type: BlockKind; value: TokenList<ComponentValue>; };
}

function expectFunctionBlock(
  component: ComponentValue | null | undefined,
  name: string,
): { name: string; value: TokenList<ComponentValue>; } {
  expect(component).toBeTruthy();
  expect('name' in component!).toBe(true);
  expect((component as { name: string; }).name).toBe(name);
  return component as { name: string; value: TokenList<ComponentValue>; };
}

describe('5.4 parser entry points', () => {
  test('normalizes an existing token stream without restarting or copying it', () => {
    const input = new TokenCursor(tokenize('discarded color: red; width: 1px'), emptyParsingContext);
    input.next();
    const declaration = expectDeclaration(parseDeclaration(input, syntaxContext));
    expect(declaration.name).toBe('color');
    expect(input.peek().type).toBe(TokenKind.Semicolon);
    input.next();
    expect(expectDeclaration(parseDeclaration(input, syntaxContext)).name).toBe('width');
    expect(input.eof()).toBe(true);
  });

  test('consumes existing component-value streams from their current position', () => {
    const list = parseListOfComponentValues('skip fn(x)');
    const input = new TokenCursor(list, emptyParsingContext, { position: 2 });
    expect(parseComponentValue(input)).toBe(list.tokens[2]);
    expect(input.eof()).toBe(true);
  });

  test('preserves source spelling from an existing token stream', () => {
    const list = tokenize('--x: fn(a) /**/ foo\\62 ar !important; unicode-range: U+4??');
    const input = new TokenCursor(list, emptyParsingContext);

    expect(parseDeclaration(input, syntaxContext)).toMatchObject({
      name: '--x', originalText: 'fn(a) /**/ foo\\62 ar', important: true,
    });
    input.next();
    expect(parseDeclaration(input, syntaxContext)?.value.tokens).toEqual([
      { type: TokenKind.UnicodeRange, start: 0x400, end: 0x4FF },
    ]);
  });

  test('parses stylesheet contents', () => {
    const rules = parseStylesheetContents('@layer reset; .a { color: red }', syntaxContext);

    expect(rules).toHaveLength(2);
    expectStatementAtRule(rules[0]);

    const style = expectQualifiedRule(rules[1]);
    expect(expectDeclarations(style.block[0])).toHaveLength(1);
    expect(expectDeclarations(style.block[0])[0]!.name).toBe('color');
  });

  test('ignores whitespace, CDO, and CDC in stylesheet contents', () => {
    const rules = parseStylesheetContents('<!-- .a {} --> @layer x;', syntaxContext);

    expect(rules).toHaveLength(2);
    expectQualifiedRule(rules[0]);
    expectStatementAtRule(rules[1]);
  });

  test('parses block contents as ordered declaration runs and rules', () => {
    const contents = parseBlockContents(
      'color: red; width: 1px; & {} height: 2px; @x; opacity: .5', syntaxContext,
    );

    expect(contents).toHaveLength(5);
    expect(expectDeclarations(contents[0])).toHaveLength(2);
    expectQualifiedRule(contents[1]);
    expect(expectDeclarations(contents[2])[0]!.name).toBe('height');
    expectStatementAtRule(contents[3]);
    expect(expectDeclarations(contents[4])[0]!.name).toBe('opacity');
  });

  test('retains the final declaration run at EOF', () => {
    const contents = parseBlockContents('color: red; width: 1px', syntaxContext);

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual([
      'color',
      'width',
    ]);
  });

  test('parses exactly one rule with surrounding whitespace', () => {
    expectStatementAtRule(parseRule('  @layer x;  ', syntaxContext));
    expectQualifiedRule(parseRule('  .a {}  ', syntaxContext));
    expect(parseRule('', syntaxContext)).toBeNull();
    expect(parseRule('.a', syntaxContext)).toBeNull();
    expect(parseRule('.a {} .b {}', syntaxContext)).toBeNull();
  });

  test('returns null for empty component-value input', () => {
    expect(parseComponentValue('')).toBeNull();
    expect(parseComponentValue(' \n\t ')).toBeNull();
    expect(parseListOfComponentValues('').tokens).toEqual([]);
  });

  test('parses one declaration', () => {
    const declaration = expectDeclaration(parseDeclaration(' color: red !important', syntaxContext));

    expect(declaration.name).toBe('color');
    expect(declaration.important).toBe(true);
    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);

    expect(parseDeclaration('color red', syntaxContext)).toBeNull();
    expect(parseDeclaration('@x;', syntaxContext)).toBeNull();
  });

  test('parses one component value or a list', () => {
    expectPreservedToken(parseComponentValue('red'), TokenKind.Ident);
    expectSimpleBlock(parseComponentValue('[x]'), TokenKind.BracketBlock);
    expectFunctionBlock(parseComponentValue('fn(x)'), 'fn');
    expect(parseComponentValue('red blue')).toBeNull();

    const list = parseListOfComponentValues('red [x] fn(y)');
    expect(list.tokens).toHaveLength(5);
    expectSimpleBlock(list.tokens[2], TokenKind.BracketBlock);
    expectFunctionBlock(list.tokens[4], 'fn');
  });

  test('parses comma-separated component values with editor-draft edge behavior', () => {
    expect(parseCommaSeparatedListOfComponentValues('')).toEqual([]);
    expect(parseCommaSeparatedListOfComponentValues('a,')).toHaveLength(1);
    expect(parseCommaSeparatedListOfComponentValues(',a')).toHaveLength(2);
    expect(parseCommaSeparatedListOfComponentValues('a,,b')).toHaveLength(3);

    const groups = parseCommaSeparatedListOfComponentValues('fn(a, b), [c, d], e');
    expect(groups).toHaveLength(3);
    expectFunctionBlock(groups[0]!.tokens[0], 'fn');
    expectSimpleBlock(groups[1]!.tokens[1], TokenKind.BracketBlock);
  });

  test('preserves leading and consecutive empty comma groups but omits a trailing one', () => {
    const groups = parseCommaSeparatedListOfComponentValues(',a,,b,');

    expect(groups).toHaveLength(4);
    expect(groups[0]!.tokens).toEqual([]);
    expect(preservedKinds(groups[1]!)).toEqual([TokenKind.Ident]);
    expect(groups[2]!.tokens).toEqual([]);
    expect(preservedKinds(groups[3]!)).toEqual([TokenKind.Ident]);
  });
});

describe('5.5 rule consumers', () => {
  test('distinguishes statement and block at-rules', () => {
    const statement = expectStatementAtRule(parseRule('@media screen;', syntaxContext));
    const block = expectBlockAtRule(parseRule('@media screen { .a {} }', syntaxContext));

    expect(statement.name).toBe('media');
    expect(preservedKinds(statement.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);

    expect(block.name).toBe('media');
    expectQualifiedRule(block.block[0]);
  });

  test('returns a statement at-rule at EOF without requiring a semicolon', () => {
    const rule = expectStatementAtRule(parseRule('@charset "utf-8"', syntaxContext));

    expect(rule.name).toBe('charset');
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.String,
    ]);
  });

  test('keeps semicolons inside at-rule prelude components', () => {
    const rule = expectStatementAtRule(parseRule('@import url("x;y.css");', syntaxContext));

    expect(rule.prelude.tokens).toHaveLength(2);
    expect(rule.prelude.tokens[1]).toMatchObject({
      type: TokenKind.FunctionBlock,
      name: 'url',
    });
  });

  test('preserves component values in at-rule preludes', () => {
    const rule = expectBlockAtRule(parseRule('@x foo(bar) [baz] {}', syntaxContext));

    expect(rule.prelude.tokens).toHaveLength(5);
    expectFunctionBlock(rule.prelude.tokens[1], 'foo');
    expectSimpleBlock(rule.prelude.tokens[3], TokenKind.BracketBlock);
  });

  test('preserves a qualified rule body as ordered declaration lists and rules', () => {
    const rule = expectQualifiedRule(parseRule(`
      .a {
        color: red;
        & { width: 1px }
        height: 2px;
        @x;
        opacity: .5;
      }
    `, syntaxContext));

    expect(rule.block).toHaveLength(5);
    expect(expectDeclarations(rule.block[0]).map(({ name }) => name)).toEqual(['color']);
    expectQualifiedRule(rule.block[1]);
    expect(expectDeclarations(rule.block[2])[0]!.name).toBe('height');
    expectStatementAtRule(rule.block[3]);
    expect(expectDeclarations(rule.block[4])[0]!.name).toBe('opacity');
  });

  test('parses declarations inside nested qualified rules', () => {
    const outer = expectQualifiedRule(parseRule('.a { &:hover { color: blue } }', syntaxContext));
    const nested = expectQualifiedRule(outer.block[0]);

    expect(expectDeclarations(nested.block[0])).toHaveLength(1);
    expect(expectDeclarations(nested.block[0])[0]!.name).toBe('color');
  });

  test('does not reinterpret a custom-property-shaped construct as a rule', () => {
    const contents = parseBlockContents('--x:hover { color: red }; width: 1px', syntaxContext);

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual([
      '--x',
      'width',
    ]);
  });

  test('drops a nested qualified rule that reaches EOF before its block', () => {
    expect(parseBlockContents('&:hover', syntaxContext)).toEqual([]);
  });

  test('preserves CDO and CDC when parsing an individual qualified rule', () => {
    const cdo = expectQualifiedRule(parseRule('<!--{}', syntaxContext));
    const cdc = expectQualifiedRule(parseRule('-->{}', syntaxContext));

    expect(preservedKinds(cdo.prelude)).toEqual([TokenKind.CDO]);
    expect(preservedKinds(cdc.prelude)).toEqual([TokenKind.CDC]);
  });
});

describe('5.5 declaration recovery', () => {
  test('recovers after malformed declarations', () => {
    const contents = parseBlockContents('color red; width: 10px', syntaxContext);

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual(['width']);
  });

  test('allows a brace block as the entire non-custom value', () => {
    const declaration = expectDeclaration(parseDeclaration('foo: { bar }', syntaxContext));

    expect(declaration.value.tokens).toHaveLength(1);
    expectSimpleBlock(declaration.value.tokens[0], TokenKind.BraceBlock);
  });

  test('rejects a brace block mixed with another non-custom value', () => {
    expect(parseDeclaration('foo: before { bar }', syntaxContext)).toBeNull();
    expect(parseDeclaration('foo: { bar } after', syntaxContext)).toBeNull();
  });

  test('allows arbitrary top-level brace blocks in custom properties', () => {
    const declaration = expectDeclaration(parseDeclaration('--foo: before { bar } after', syntaxContext));

    expect(declaration.value.tokens).toHaveLength(5);
    expectSimpleBlock(declaration.value.tokens[2], TokenKind.BraceBlock);
  });

  test('captures the original source text of a custom property value', () => {
    const declaration = expectDeclaration(parseDeclaration('--foo:foo\\62 ar', syntaxContext));

    expect(declaration.originalText).toBe('foo\\62 ar');
  });

  test('re-tokenizes a unicode-range descriptor from its original source', () => {
    const declaration = expectDeclaration(
      parseDeclaration('unicode-range: U+400-4FF', syntaxContext),
    );

    expect(declaration.value.tokens).toEqual([{
      type: TokenKind.UnicodeRange,
      start: 0x400,
      end: 0x4FF,
    }]);
  });

  test('re-tokenizes the entire unicode-range value before descriptor validation', () => {
    const declaration = expectDeclaration(parseDeclaration('UNICODE-RANGE: U+4?? !important', syntaxContext));

    expect(declaration.important).toBe(true);
    expect(declaration.value.tokens).toEqual([
      { type: TokenKind.UnicodeRange, start: 0x400, end: 0x4FF },
      { type: TokenKind.Whitespace },
      { type: TokenKind.Delim, value: '!' },
      { type: TokenKind.Ident, value: 'important' },
    ]);
  });

  test('leaves unicode-range bounds and ordering for the descriptor grammar', () => {
    const declaration = expectDeclaration(parseDeclaration('unicode-range: U+500-400, U+110000', syntaxContext));
    expect(declaration.value.tokens).toEqual([
      { type: TokenKind.UnicodeRange, start: 0x500, end: 0x400 },
      { type: TokenKind.Comma },
      { type: TokenKind.Whitespace },
      { type: TokenKind.UnicodeRange, start: 0x110000, end: 0x110000 },
    ]);
  });

  test('only recognizes a final important flag', () => {
    const final = expectDeclaration(parseDeclaration('color: red ! important', syntaxContext));
    const mixedCase = expectDeclaration(parseDeclaration('color: red ! ImPoRtAnT', syntaxContext));
    const nonfinal = expectDeclaration(parseDeclaration('color: red !important blue', syntaxContext));

    expect(final.important).toBe(true);
    expect(mixedCase.important).toBe(true);
    expect(nonfinal.important).toBe(false);
  });

  test('trims trailing whitespace from declaration values', () => {
    const declaration = expectDeclaration(parseDeclaration('color: red   \n\t', syntaxContext));

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

    expectSimpleBlock(block.value.tokens[1], TokenKind.BracketBlock);
    expectFunctionBlock(block.value.tokens[3], 'fn');
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
    expectFunctionBlock(fn.value.tokens[0], 'inner');

    expect(parseComponentValue('fn(x))')).toBeNull();
  });

  test('does not split on semicolons inside strings or functions', () => {
    const contents = parseBlockContents('font-family: "x;y"; x: fn(a;b); width: 1px', syntaxContext);
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual(['font-family', 'x', 'width']);
    expect(preservedKinds(declarations[0]!.value)).toEqual([TokenKind.String]);
    expectFunctionBlock(declarations[1]!.value.tokens[0], 'fn');
  });

  test('an unterminated comment consumes the rest of the input', () => {
    const contents = parseBlockContents('width: 1px; /* unterminated height: 2px;', syntaxContext);
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual(['width']);
  });

  test('recovers a following declaration after a bad URL token', () => {
    const contents = parseBlockContents(
      'background-image: url(foo"bar); margin-left: 4px;', syntaxContext,
    );
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual([
      'background-image',
      'margin-left',
    ]);
    expect(preservedKinds(declarations[0]!.value)).toEqual([TokenKind.BadUrl]);
  });

  test('recovers after a bad string reaches a declaration boundary', () => {
    const contents = parseBlockContents(
      'font-family: "x\n; margin-left: 3px;', syntaxContext,
    );
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual([
      'font-family',
      'margin-left',
    ]);
    expect(preservedKinds(declarations[0]!.value)).toContain(TokenKind.BadString);
  });

  test('does not treat a brace inside an attribute string as the rule block', () => {
    const rule = expectQualifiedRule(parseRule('.foo[data-x="{"] { color: red }', syntaxContext));

    expectSimpleBlock(rule.prelude.tokens[2], TokenKind.BracketBlock);
    expect(expectDeclarations(rule.block[0]).map(({ name }) => name)).toEqual(['color']);
  });
});

describe('mixed token and component-value input', () => {
  test('accepts previously parsed components without rebuilding their blocks', () => {
    const list = parseListOfComponentValues('red fn(x) [y]');

    expect(parseListOfComponentValues(list)).toEqual(list);
    const functionInput = {
      tokens: list.tokens.slice(2, 3),
      text: list.text,
      ranges: list.ranges.slice(2, 3),
    };
    expect(parseComponentValue(functionInput)).toBe(list.tokens[2]);
  });

  test('parses rule bodies supplied as an existing brace block', () => {
    const list = parseListOfComponentValues('.a { color: red }');
    const rule = expectQualifiedRule(parseRule(list, syntaxContext));

    expect(expectDeclarations(rule.block[0]).map(({ name }) => name)).toEqual(['color']);
  });

  test('parses a block at-rule supplied as existing component values', () => {
    const list = parseListOfComponentValues('@media { .a {} }');
    const rule = expectBlockAtRule(parseRule(list, syntaxContext));

    expectQualifiedRule(rule.block[0]);
  });
});

function expectBlockContents(_contents: BlockContents): void {
  // Compile-time assertion that the public entry point exposes the spec shape.
}

expectBlockContents(parseBlockContents('', syntaxContext));
