import { afterEach, describe, expect, test, vi } from 'vitest';
import { defaultStyleletEnvironment as env } from '../../../../src/stylelet/environment';
import type { PropertyDeclaration } from '../../../../src/stylelet/css/property';
import { StylesheetContext } from '../../../../src/stylelet/cssom/parser';
import type { CSSRuleImpl } from '../../../../src/stylelet/cssom/rule';
import { CSSStyleRuleImpl, CSSNestedDeclarationsImpl } from '../../../../src/stylelet/cssom/rules';
import {
  isComponentBlock, type BlockKind, type ComponentValue, type PreservedToken,
} from '../../../../src/stylelet/syntax/component-value';
import {
  consumeBlock, discardRuleBlock, parseBlockContents, parseCommaSeparatedListOfComponentValues, parseComponentValue,
  parseDeclaration, parseListOfComponentValues, parseRule, parseStylesheetContents,
  type BlockContents, type Declaration,
} from '../../../../src/stylelet/syntax/parser';
import { tokenize, TokenKind, type TokenList } from '../../../../src/stylelet/syntax/tokens';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';

const context = new StylesheetContext(null, false, env);

afterEach(() => vi.restoreAllMocks());

function preservedKinds(list: TokenList<ComponentValue>): TokenKind[] {
  return list.tokens
    .filter((component): component is PreservedToken => !isComponentBlock(component))
    .map((token) => token.type);
}

function expectStyleRule(
  value: CSSRuleImpl | PropertyDeclaration[] | null | undefined,
): CSSStyleRuleImpl {
  if (!(value instanceof CSSStyleRuleImpl)) throw new Error('Expected a style rule');
  return value;
}

function expectDeclarations(
  value: CSSRuleImpl | PropertyDeclaration[] | null | undefined,
): PropertyDeclaration[] {
  if (!Array.isArray(value)) throw new Error('Expected a declaration run');
  return value;
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
    const input = new TokenCursor(tokenize('discarded color: red; margin-left: 1px'), {});
    input.next();
    const declaration = expectDeclaration(parseDeclaration(input, context));
    expect(declaration.name).toBe('color');
    expect(input.peek().type).toBe(TokenKind.Semicolon);
    input.next();
    expect(expectDeclaration(parseDeclaration(input, context)).name).toBe('margin-left');
    expect(input.eof()).toBe(true);
  });

  test('consumes existing component-value streams from their current position', () => {
    const list = parseListOfComponentValues('skip fn(x)', {});
    const input = new TokenCursor(list, {}, { position: 2 });
    expect(parseComponentValue(input, input.context)).toBe(list.tokens[2]);
    expect(input.eof()).toBe(true);
  });

  test('preserves source spelling from an existing token stream', () => {
    const list = tokenize('--x: fn(a) /**/ foo\\62 ar !important; unicode-range: U+4??');
    const input = new TokenCursor(list, {});

    expect(parseDeclaration(input, context)).toMatchObject({
      name: '--x', originalText: 'fn(a) /**/ foo\\62 ar', important: true,
    });
    input.next();
    expect(parseDeclaration(input, context)?.value.tokens).toEqual([
      { type: TokenKind.UnicodeRange, start: 0x400, end: 0x4FF },
    ]);
  });

  test('parses stylesheet contents', () => {
    const statement = vi.spyOn(context, 'interpretStatementAtRule').mockReturnValue(null);
    const rules = parseStylesheetContents('@layer reset; .a { color: red }', context);

    expect(statement.mock.calls[0]![0]).toMatchObject({ name: 'layer' });
    expect(rules).toHaveLength(1);
    expect(expectStyleRule(rules[0]).style.declarations).toMatchObject([{ name: 'color' }]);
  });

  test('ignores whitespace, CDO, and CDC in stylesheet contents', () => {
    const rules = parseStylesheetContents('<!-- .a {} --> .b {}', context);

    expect(rules).toHaveLength(2);
    expectStyleRule(rules[0]);
    expectStyleRule(rules[1]);
  });

  test('parses block contents as ordered declaration runs and rules', () => {
    const contents = parseBlockContents(
      'color: red; margin-left: 1px; .a {} margin-top: 2px; .b {} opacity: .5', context,
    );

    expect(contents).toHaveLength(5);
    expect(expectDeclarations(contents[0])).toHaveLength(2);
    expectStyleRule(contents[1]);
    expect(expectDeclarations(contents[2])[0]!.name).toBe('margin-top');
    expectStyleRule(contents[3]);
    expect(expectDeclarations(contents[4])[0]!.name).toBe('opacity');
  });

  test('retains the final declaration run at EOF', () => {
    const contents = parseBlockContents('color: red; margin-left: 1px', context);

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual([
      'color',
      'margin-left',
    ]);
  });

  test('parses exactly one rule with surrounding whitespace', () => {
    expectStyleRule(parseRule('  .a {}  ', context));
    expect(parseRule('', context)).toBeNull();
    expect(parseRule('.a', context)).toBeNull();
    expect(parseRule('.a {} .b {}', context)).toBeNull();
  });

  test('returns null for empty component-value input', () => {
    expect(parseComponentValue('', {})).toBeNull();
    expect(parseComponentValue(' \n\t ', {})).toBeNull();
    expect(parseListOfComponentValues('', {}).tokens).toEqual([]);
  });

  test('parses one declaration', () => {
    const declaration = expectDeclaration(parseDeclaration(' color: red !important', context));

    expect(declaration.name).toBe('color');
    expect(declaration.important).toBe(true);
    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);

    expect(parseDeclaration('color red', context)).toBeNull();
    expect(parseDeclaration('@x;', context)).toBeNull();
  });

  test('parses one component value or a list', () => {
    expectPreservedToken(parseComponentValue('red', {}), TokenKind.Ident);
    expectSimpleBlock(parseComponentValue('[x]', {}), TokenKind.BracketBlock);
    expectFunctionBlock(parseComponentValue('fn(x)', {}), 'fn');
    expect(parseComponentValue('red blue', {})).toBeNull();

    const list = parseListOfComponentValues('red [x] fn(y)', {});
    expect(list.tokens).toHaveLength(5);
    expectSimpleBlock(list.tokens[2], TokenKind.BracketBlock);
    expectFunctionBlock(list.tokens[4], 'fn');
  });

  test('parses comma-separated component values with editor-draft edge behavior', () => {
    expect(parseCommaSeparatedListOfComponentValues('', {})).toEqual([]);
    expect(parseCommaSeparatedListOfComponentValues('a,', {})).toHaveLength(1);
    expect(parseCommaSeparatedListOfComponentValues(',a', {})).toHaveLength(2);
    expect(parseCommaSeparatedListOfComponentValues('a,,b', {})).toHaveLength(3);

    const groups = parseCommaSeparatedListOfComponentValues('fn(a, b), [c, d], e', {});
    expect(groups).toHaveLength(3);
    expectFunctionBlock(groups[0]!.tokens[0], 'fn');
    expectSimpleBlock(groups[1]!.tokens[1], TokenKind.BracketBlock);
  });

  test('preserves leading and consecutive empty comma groups but omits a trailing one', () => {
    const groups = parseCommaSeparatedListOfComponentValues(',a,,b,', {});

    expect(groups).toHaveLength(4);
    expect(groups[0]!.tokens).toEqual([]);
    expect(preservedKinds(groups[1]!)).toEqual([TokenKind.Ident]);
    expect(groups[2]!.tokens).toEqual([]);
    expect(preservedKinds(groups[3]!)).toEqual([TokenKind.Ident]);
  });
});

describe('5.5 rule consumers', () => {
  test('distinguishes statement and block at-rules', () => {
    // Observe Syntax's inputs without pretending the unfinished media grammar is implemented.
    const statement = vi.spyOn(context, 'interpretStatementAtRule').mockReturnValue(null);
    let contents: BlockContents = [];
    const block = vi.spyOn(context, 'interpretBlockAtRule').mockImplementation((_name, _prelude, _preceding, c) => {
      contents = c.withContext(context, consumeBlock);
      return null;
    });
    parseRule('@media screen;', context);
    parseRule('@media screen { .a {} }', context);

    expect(statement).toHaveBeenCalledOnce();
    expect(statement.mock.calls[0]![0].name).toBe('media');
    expect(preservedKinds(statement.mock.calls[0]![0].prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);

    expect(block).toHaveBeenCalledOnce();
    expect(block.mock.calls[0]![0]).toBe('media');
    expectStyleRule(contents[0]);
  });

  test('submits a statement at-rule at EOF without requiring a semicolon', () => {
    const statement = vi.spyOn(context, 'interpretStatementAtRule').mockReturnValue(null);
    parseRule('@charset "utf-8"', context);
    const rule = statement.mock.calls[0]![0];

    expect(rule.name).toBe('charset');
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.String,
    ]);
  });

  test('keeps semicolons inside at-rule prelude components', () => {
    const statement = vi.spyOn(context, 'interpretStatementAtRule').mockReturnValue(null);
    parseRule('@import url("x;y.css");', context);
    const rule = statement.mock.calls[0]![0];

    expect(rule.prelude.tokens).toHaveLength(2);
    expect(rule.prelude.tokens[1]).toMatchObject({
      type: TokenKind.FunctionBlock,
      name: 'url',
    });
  });

  test('preserves component values in at-rule preludes', () => {
    const block = vi.spyOn(context, 'interpretBlockAtRule');
    parseRule('@x foo(bar) [baz] {}', context);
    const prelude = block.mock.calls[0]![1];

    expect(prelude.tokens).toHaveLength(5);
    expectFunctionBlock(prelude.tokens[1], 'foo');
    expectSimpleBlock(prelude.tokens[3], TokenKind.BracketBlock);
  });

  test('preserves a qualified rule body as ordered declaration lists and rules', () => {
    const rule = expectStyleRule(parseRule(`
      .a {
        color: red;
        & { margin-left: 1px }
        margin-top: 2px;
        .b {}
        opacity: .5;
      }
    `, context));

    expect(rule.style.declarations.map(({ name }) => name)).toEqual(['color']);
    expect(rule.cssRules.length).toBe(4);
    expectStyleRule(rule.cssRules.item(0));
    expectStyleRule(rule.cssRules.item(2));
    const firstRun = rule.cssRules.item(1);
    const lastRun = rule.cssRules.item(3);
    if (!(firstRun instanceof CSSNestedDeclarationsImpl) || !(lastRun instanceof CSSNestedDeclarationsImpl)) {
      throw new Error('Expected nested declaration runs');
    }
    expect(firstRun.style.declarations[0]!.name).toBe('margin-top');
    expect(lastRun.style.declarations[0]!.name).toBe('opacity');
  });

  test('parses declarations inside nested qualified rules', () => {
    const outer = expectStyleRule(parseRule('.a { &:hover { color: blue } }', context));
    const nested = expectStyleRule(outer.cssRules.item(0));

    expect(nested.style.declarations).toHaveLength(1);
    expect(nested.style.declarations[0]!.name).toBe('color');
  });

  test('does not reinterpret a custom-property-shaped construct as a rule', () => {
    const contents = parseBlockContents('--x:hover { color: red }; margin-left: 1px', context);

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual([
      '--x',
      'margin-left',
    ]);
  });

  test('drops a nested qualified rule that reaches EOF before its block', () => {
    expect(parseBlockContents('&:hover', context)).toEqual([]);
  });

  test('preserves CDO and CDC when parsing an individual qualified rule', () => {
    const qualified = vi.spyOn(context, 'interpretQualifiedRule').mockImplementation((_prelude, c) => {
      discardRuleBlock(c);
      return null;
    });
    parseRule('<!--{}', context);
    parseRule('-->{}', context);

    expect(qualified).toHaveBeenCalledTimes(2);
    expect(preservedKinds(qualified.mock.calls[0]![0])).toEqual([TokenKind.CDO]);
    expect(preservedKinds(qualified.mock.calls[1]![0])).toEqual([TokenKind.CDC]);
  });
});

describe('5.5 declaration recovery', () => {
  test('recovers after malformed declarations', () => {
    const contents = parseBlockContents('color red; margin-left: 10px', context);

    expect(contents).toHaveLength(1);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual(['margin-left']);
  });

  test('allows a brace block as the entire non-custom value', () => {
    const declaration = expectDeclaration(parseDeclaration('foo: { bar }', context));

    expect(declaration.value.tokens).toHaveLength(1);
    expectSimpleBlock(declaration.value.tokens[0], TokenKind.BraceBlock);
  });

  test('rejects a brace block mixed with another non-custom value', () => {
    expect(parseDeclaration('foo: before { bar }', context)).toBeNull();
    expect(parseDeclaration('foo: { bar } after', context)).toBeNull();
  });

  test('allows arbitrary top-level brace blocks in custom properties', () => {
    const declaration = expectDeclaration(parseDeclaration('--foo: before { bar } after', context));

    expect(declaration.value.tokens).toHaveLength(5);
    expectSimpleBlock(declaration.value.tokens[2], TokenKind.BraceBlock);
  });

  test('captures the original source text of a custom property value', () => {
    const declaration = expectDeclaration(parseDeclaration('--foo:foo\\62 ar', context));

    expect(declaration.originalText).toBe('foo\\62 ar');
  });

  test('re-tokenizes a unicode-range descriptor from its original source', () => {
    const declaration = expectDeclaration(
      parseDeclaration('unicode-range: U+400-4FF', context),
    );

    expect(declaration.value.tokens).toEqual([{
      type: TokenKind.UnicodeRange,
      start: 0x400,
      end: 0x4FF,
    }]);
  });

  test('re-tokenizes the entire unicode-range value before descriptor validation', () => {
    const declaration = expectDeclaration(parseDeclaration('UNICODE-RANGE: U+4?? !important', context));

    expect(declaration.important).toBe(true);
    expect(declaration.value.tokens).toEqual([
      { type: TokenKind.UnicodeRange, start: 0x400, end: 0x4FF },
      { type: TokenKind.Whitespace },
      { type: TokenKind.Delim, value: '!' },
      { type: TokenKind.Ident, value: 'important' },
    ]);
  });

  test('leaves unicode-range bounds and ordering for the descriptor grammar', () => {
    const declaration = expectDeclaration(parseDeclaration('unicode-range: U+500-400, U+110000', context));
    expect(declaration.value.tokens).toEqual([
      { type: TokenKind.UnicodeRange, start: 0x500, end: 0x400 },
      { type: TokenKind.Comma },
      { type: TokenKind.Whitespace },
      { type: TokenKind.UnicodeRange, start: 0x110000, end: 0x110000 },
    ]);
  });

  test('only recognizes a final important flag', () => {
    const final = expectDeclaration(parseDeclaration('color: red ! important', context));
    const mixedCase = expectDeclaration(parseDeclaration('color: red ! ImPoRtAnT', context));
    const nonfinal = expectDeclaration(parseDeclaration('color: red !important blue', context));

    expect(final.important).toBe(true);
    expect(mixedCase.important).toBe(true);
    expect(nonfinal.important).toBe(false);
  });

  test('trims trailing whitespace from declaration values', () => {
    const declaration = expectDeclaration(parseDeclaration('color: red   \n\t', context));

    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);
  });
});

describe('5.5 component-value consumers', () => {
  test('returns preserved closing tokens directly', () => {
    expectPreservedToken(parseComponentValue('}', {}), TokenKind.RightBrace);
    expectPreservedToken(parseComponentValue(']', {}), TokenKind.RightBracket);
    expectPreservedToken(parseComponentValue(')', {}), TokenKind.RightParen);
  });

  test('consumes nested simple blocks and functions', () => {
    const block = expectSimpleBlock(
      parseComponentValue('{ [x] fn(y) }', {}),
      TokenKind.BraceBlock,
    );

    expectSimpleBlock(block.value.tokens[1], TokenKind.BracketBlock);
    expectFunctionBlock(block.value.tokens[3], 'fn');
  });

  test('automatically closes blocks and functions at EOF', () => {
    expectSimpleBlock(parseComponentValue('{ x', {}), TokenKind.BraceBlock);
    expectFunctionBlock(parseComponentValue('fn(x', {}), 'fn');
  });

  test('only the mirror token closes a simple block', () => {
    const parens = expectSimpleBlock(parseComponentValue('(x]', {}), TokenKind.ParensBlock);
    const brackets = expectSimpleBlock(parseComponentValue('[x)', {}), TokenKind.BracketBlock);

    expect(preservedKinds(parens.value)).toEqual([TokenKind.Ident, TokenKind.RightBracket]);
    expect(preservedKinds(brackets.value)).toEqual([TokenKind.Ident, TokenKind.RightParen]);
  });

  test('preserves unmatched closing tokens nested inside a block', () => {
    const block = expectSimpleBlock(parseComponentValue('{ ) ] }', {}), TokenKind.BraceBlock);

    expect(preservedKinds(block.value)).toEqual([
      TokenKind.Whitespace,
      TokenKind.RightParen,
      TokenKind.Whitespace,
      TokenKind.RightBracket,
      TokenKind.Whitespace,
    ]);
  });

  test('consumes nested functions and stops at the matching right parenthesis', () => {
    const fn = expectFunctionBlock(parseComponentValue('outer(inner(x))', {}), 'outer');
    expectFunctionBlock(fn.value.tokens[0], 'inner');

    expect(parseComponentValue('fn(x))', {})).toBeNull();
  });

  test('does not split on semicolons inside strings or functions', () => {
    const interpret = vi.spyOn(context, 'interpretDeclaration');
    parseBlockContents('font-family: "x;y"; x: fn(a;b); margin-left: 1px', context);
    const declarations = interpret.mock.calls.map(([declaration]) => declaration);

    expect(declarations.map(({ name }) => name)).toEqual(['font-family', 'x', 'margin-left']);
    expect(preservedKinds(declarations[0]!.value)).toEqual([TokenKind.String]);
    expectFunctionBlock(declarations[1]!.value.tokens[0], 'fn');
  });

  test('an unterminated comment consumes the rest of the input', () => {
    const contents = parseBlockContents('margin-left: 1px; /* unterminated margin-top: 2px;', context);
    const declarations = expectDeclarations(contents[0]);

    expect(declarations.map(({ name }) => name)).toEqual(['margin-left']);
  });

  test('recovers a following declaration after a bad URL token', () => {
    const interpret = vi.spyOn(context, 'interpretDeclaration');
    const contents = parseBlockContents(
      'background-image: url(foo"bar); margin-left: 4px;', context,
    );
    const declarations = interpret.mock.calls.map(([declaration]) => declaration);

    expect(declarations.map(({ name }) => name)).toEqual([
      'background-image',
      'margin-left',
    ]);
    expect(preservedKinds(declarations[0]!.value)).toEqual([TokenKind.BadUrl]);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual(['margin-left']);
  });

  test('recovers after a bad string reaches a declaration boundary', () => {
    const interpret = vi.spyOn(context, 'interpretDeclaration');
    const contents = parseBlockContents(
      'font-family: "x\n; margin-left: 3px;', context,
    );
    const declarations = interpret.mock.calls.map(([declaration]) => declaration);

    expect(declarations.map(({ name }) => name)).toEqual([
      'font-family',
      'margin-left',
    ]);
    expect(preservedKinds(declarations[0]!.value)).toContain(TokenKind.BadString);
    expect(expectDeclarations(contents[0]).map(({ name }) => name)).toEqual(['margin-left']);
  });

  test('does not treat a brace inside an attribute string as the rule block', () => {
    const qualified = vi.spyOn(context, 'interpretQualifiedRule');
    const rule = expectStyleRule(parseRule('.foo[data-x="{"] { color: red }', context));

    expectSimpleBlock(qualified.mock.calls[0]![0].tokens[2], TokenKind.BracketBlock);
    expect(rule.style.declarations.map(({ name }) => name)).toEqual(['color']);
  });
});

describe('mixed token and component-value input', () => {
  test('accepts previously parsed components without rebuilding their blocks', () => {
    const list = parseListOfComponentValues('red fn(x) [y]', {});

    expect(parseListOfComponentValues(list, {})).toEqual(list);
    const functionInput = {
      tokens: list.tokens.slice(2, 3),
      text: list.text,
      ranges: list.ranges.slice(2, 3),
    };
    expect(parseComponentValue(functionInput, {})).toBe(list.tokens[2]);
  });

  test('parses rule bodies supplied as an existing brace block', () => {
    const list = parseListOfComponentValues('.a { color: red }', {});
    const rule = expectStyleRule(parseRule(list, context));

    expect(rule.style.declarations.map(({ name }) => name)).toEqual(['color']);
  });

  test('parses a block at-rule supplied as existing component values', () => {
    const list = parseListOfComponentValues('@media { .a {} }', {});
    let contents: BlockContents = [];
    vi.spyOn(context, 'interpretBlockAtRule').mockImplementation((_name, _prelude, _preceding, c) => {
      contents = c.withContext(context, consumeBlock);
      return null;
    });
    parseRule(list, context);

    expectStyleRule(contents[0]);
  });
});

function expectBlockContents(_contents: BlockContents): void {
  // Compile-time assertion that the public entry point exposes the spec shape.
}

expectBlockContents(parseBlockContents('', context));
