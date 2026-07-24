import { describe, expect, test } from 'vitest';

import {
  BlockKind,
  RuleKind,
  parseCommaSeparatedListOfComponentValues,
  parseComponentValue,
  parseDeclaration,
  parseListOfComponentValues,
  parseListOfDeclarations,
  parseListOfRules,
  parseRule,
  parseStyleBlockContents,
  parseStylesheet,
  type AtRule,
  type ComponentValue,
  type Declaration,
  type QualifiedRule,
  type Rule,
  type StyleBlockItem,
} from '../../../../src/stylelet/parser/syntax';
import { TokenKind } from '../../../../src/stylelet/parser/tokens';

function preservedKinds(values: readonly ComponentValue[]): TokenKind[] {
  return values
    .filter((value): value is ComponentValue & { kind: TokenKind; } => 'kind' in value)
    .map((value) => value.kind);
}

function expectAtRule(value?: StyleBlockItem | null): AtRule {
  expect(value).toBeTruthy();
  expect('kind' in value!).toBe(true);
  expect((value as Rule).kind).toBe(RuleKind.At);
  return value as AtRule;
}

function expectQualifiedRule(value?: StyleBlockItem | null): QualifiedRule {
  expect(value).toBeTruthy();
  expect('kind' in value!).toBe(true);
  expect((value as Rule).kind).toBe(RuleKind.Qualified);
  return value as QualifiedRule;
}

function expectDeclaration(value?: StyleBlockItem | null): Declaration {
  expect(value).toBeTruthy();
  expect('important' in value!).toBe(true);
  return value as Declaration;
}

function expectPreservedToken(
  value: ComponentValue | null | undefined,
  kind: TokenKind,
): ComponentValue & { kind: TokenKind; } {
  expect(value).toBeTruthy();
  expect('kind' in value!).toBe(true);
  expect((value as { kind: TokenKind; }).kind).toBe(kind);
  return value as ComponentValue & { kind: TokenKind; };
}

function expectSimpleBlock(
  value: ComponentValue | null | undefined,
  block: BlockKind,
): { block: BlockKind; value: ComponentValue[]; } {
  expect(value).toBeTruthy();
  expect('block' in value!).toBe(true);
  expect((value as { block: BlockKind; }).block).toBe(block);
  return value as { block: BlockKind; value: ComponentValue[]; };
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

describe('5.4.1 consume a list of rules', () => {
  test('returns an empty rule list for empty or whitespace-only input', () => {
    expect(parseListOfRules('')).toEqual([]);
    expect(parseListOfRules(' \n\t ')).toEqual([]);
    expect(parseStylesheet(' \n\t ').rules).toEqual([]);
  });

  test('appends at-rules and qualified rules', () => {
    const rules = parseListOfRules('@media; .a {}');

    expect(rules).toHaveLength(2);
    expect(rules[0].kind).toBe(RuleKind.At);
    expect(rules[1].kind).toBe(RuleKind.Qualified);

    expect((rules[0] as AtRule).name).toBe('media');
    expect((rules[1] as QualifiedRule).block.block).toBe(BlockKind.Brace);
  });

  test('drops a qualified rule that reaches EOF before a block', () => {
    expect(parseListOfRules('.a')).toEqual([]);
    expect(parseListOfRules('.a @media;')).toEqual([]);
  });

  test('ignores CDO and CDC at top level', () => {
    const sheet = parseStylesheet('<!-- .a {} --> @media;');

    expect(sheet.rules).toHaveLength(2);
    expect(sheet.rules[0].kind).toBe(RuleKind.Qualified);
    expect(sheet.rules[1].kind).toBe(RuleKind.At);
    expect((sheet.rules[1] as AtRule).name).toBe('media');
  });

  test('treats CDO and CDC as qualified-rule prelude tokens when not top level', () => {
    const rules = parseListOfRules('<!--{} -->{}');

    expect(rules).toHaveLength(2);

    const first = expectQualifiedRule(rules[0]);
    const second = expectQualifiedRule(rules[1]);

    expect(preservedKinds(first.prelude)).toEqual([TokenKind.CDO]);
    expect(preservedKinds(second.prelude)).toEqual([TokenKind.CDC]);

    expect(first.block.block).toBe(BlockKind.Brace);
    expect(second.block.block).toBe(BlockKind.Brace);
  });
});

describe('5.4.2 consume an at-rule', () => {
  test('returns an at-rule when terminated by semicolon', () => {
    const rule = expectAtRule(parseRule('@media screen;'));

    expect(rule.name).toBe('media');
    expect(rule.block).toBeNull();
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);
  });

  test('returns an at-rule at EOF even without a semicolon', () => {
    const rule = expectAtRule(parseRule('@charset "utf-8"'));

    expect(rule.name).toBe('charset');
    expect(rule.block).toBeNull();
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.String,
    ]);
  });

  test('assigns a brace block when the at-rule has a block', () => {
    const rule = expectAtRule(parseRule('@media screen { .a { color: red } }'));

    expect(rule.name).toBe('media');
    expect(rule.block).not.toBeNull();
    expect(rule.block!.block).toBe(BlockKind.Brace);

    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
      TokenKind.Whitespace,
    ]);

    expect(rule.block!.value.length).toBeGreaterThan(0);
  });

  test('stores component values in the at-rule prelude before the block', () => {
    const rule = expectAtRule(parseRule('@x foo(bar) [baz] {}'));

    expect(rule.name).toBe('x');
    expect(rule.block).not.toBeNull();
    expect(rule.block!.block).toBe(BlockKind.Brace);

    expect(rule.prelude).toHaveLength(5);
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Whitespace,
      TokenKind.Whitespace,
    ]);

    expect(rule.prelude[1]).toMatchObject({
      name: 'foo',
    });

    expect(rule.prelude[3]).toMatchObject({
      block: BlockKind.Bracket,
    });
  });

  test('parseRule rejects extra input after a complete at-rule', () => {
    expect(parseRule('@media; .a {}')).toBeNull();
  });
});

describe('5.4.3 consume a qualified rule', () => {
  test('returns a qualified rule when a brace block is found', () => {
    const rule = expectQualifiedRule(parseRule('.a { color: red }'));

    expect(rule.block.block).toBe(BlockKind.Brace);
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Delim,
      TokenKind.Ident,
      TokenKind.Whitespace,
    ]);

    expect(rule.block.value.length).toBeGreaterThan(0);
  });

  test('stores component values in the qualified-rule prelude before the block', () => {
    const rule = expectQualifiedRule(parseRule('foo(bar) [baz] {}'));

    expect(rule.prelude).toHaveLength(4);
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Whitespace,
    ]);

    expect(rule.prelude[0]).toMatchObject({
      name: 'foo',
    });

    expect(rule.prelude[2]).toMatchObject({
      block: BlockKind.Bracket,
    });

    expect(rule.block.block).toBe(BlockKind.Brace);
  });

  test('returns nothing when EOF is reached before a block', () => {
    expect(parseRule('.a')).toBeNull();
    expect(parseListOfRules('.a')).toEqual([]);
  });

  test('parseRule rejects extra input after a complete qualified rule', () => {
    expect(parseRule('.a {} .b {}')).toBeNull();
  });
});

describe('5.4.4 consume a style block’s contents', () => {
  test('ignores whitespace and semicolons', () => {
    expect(parseStyleBlockContents(' ; \n\t ; ')).toEqual([]);
  });

  test('parses declarations from ident-starting input', () => {
    const items = parseStyleBlockContents('color: red; width: 10px');

    expect(items).toHaveLength(2);

    const first = expectDeclaration(items[0]);
    const second = expectDeclaration(items[1]);

    expect(first.name).toBe('color');
    expect(first.important).toBe(false);
    expect(preservedKinds(first.value)).toEqual([TokenKind.Ident]);

    expect(second.name).toBe('width');
    expect(second.important).toBe(false);
    expect(preservedKinds(second.value)).toEqual([TokenKind.Dimension]);
  });

  test('drops invalid declarations', () => {
    const items = parseStyleBlockContents('color red; width: 10px');

    expect(items).toHaveLength(1);

    const item = expectDeclaration(items[0]);
    expect(item.name).toBe('width');
    expect(preservedKinds(item.value)).toEqual([TokenKind.Dimension]);
  });

  test('parses at-rules as style block items', () => {
    const items = parseStyleBlockContents('@media screen {}; color: red');

    expect(items).toHaveLength(2);

    const first = expectAtRule(items[0]);
    const second = expectDeclaration(items[1]);

    expect(first.name).toBe('media');
    expect(first.block).not.toBeNull();

    expect(second.name).toBe('color');
    expect(preservedKinds(second.value)).toEqual([TokenKind.Ident]);
  });

  test('parses ampersand-starting nested qualified rules', () => {
    const items = parseStyleBlockContents('&:hover { color: red }; color: blue');

    expect(items).toHaveLength(2);

    const first = expectQualifiedRule(items[0]);
    const second = expectDeclaration(items[1]);

    expect(preservedKinds(first.prelude)).toEqual([
      TokenKind.Delim,
      TokenKind.Colon,
      TokenKind.Ident,
      TokenKind.Whitespace,
    ]);

    expect(first.block.block).toBe(BlockKind.Brace);

    expect(second.name).toBe('color');
    expect(preservedKinds(second.value)).toEqual([TokenKind.Ident]);
  });

  test('drops ampersand-starting qualified rules that never find a block', () => {
    const items = parseStyleBlockContents('&:hover');

    expect(items).toEqual([]);
  });

  test('drops malformed non-ident non-at-rule input through the next declaration boundary', () => {
    const items = parseStyleBlockContents('.bad { color: red }; color: green');

    expect(items).toHaveLength(1);

    const item = expectDeclaration(items[0]);
    expect(item.name).toBe('color');
    expect(preservedKinds(item.value)).toEqual([TokenKind.Ident]);
  });

  test('preserves style block item source order', () => {
    const items = parseStyleBlockContents(
      'color: red; & { color: blue } background: green',
    );

    expect(items).toHaveLength(3);

    const first = expectDeclaration(items[0]);
    const second = expectQualifiedRule(items[1]);
    const third = expectDeclaration(items[2]);

    expect(first.name).toBe('color');
    expect(second.block.block).toBe(BlockKind.Brace);
    expect(third.name).toBe('background');
  });
});

describe('5.4.5 consume a list of declarations', () => {
  test('ignores whitespace and semicolons', () => {
    expect(parseListOfDeclarations(' ; \n\t ; ')).toEqual([]);
  });

  test('parses declarations and at-rules in source order', () => {
    const items = parseListOfDeclarations('color: red; @x foo; width: 10px');

    expect(items).toHaveLength(3);

    const first = expectDeclaration(items[0]);
    const second = expectAtRule(items[1]);
    const third = expectDeclaration(items[2]);

    expect(first.name).toBe('color');
    expect(preservedKinds(first.value)).toEqual([TokenKind.Ident]);

    expect(second.name).toBe('x');
    expect(second.block).toBeNull();
    expect(preservedKinds(second.prelude)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);

    expect(third.name).toBe('width');
    expect(preservedKinds(third.value)).toEqual([TokenKind.Dimension]);
  });

  test('parses at-rules with blocks', () => {
    const items = parseListOfDeclarations('@x foo { color: red }; width: 10px');

    expect(items).toHaveLength(2);

    const first = expectAtRule(items[0]);
    const second = expectDeclaration(items[1]);

    expect(first.name).toBe('x');
    expect(first.block).not.toBeNull();
    expect(first.block!.block).toBe(BlockKind.Brace);

    expect(second.name).toBe('width');
  });

  test('drops invalid ident-starting declarations', () => {
    const items = parseListOfDeclarations('color red; width: 10px');

    expect(items).toHaveLength(1);

    const item = expectDeclaration(items[0]);
    expect(item.name).toBe('width');
    expect(preservedKinds(item.value)).toEqual([TokenKind.Dimension]);
  });

  test('drops malformed non-ident non-at-rule input through the next declaration boundary', () => {
    const items = parseListOfDeclarations('.bad { color: red }; width: 10px');

    expect(items).toHaveLength(1);

    const item = expectDeclaration(items[0]);
    expect(item.name).toBe('width');
    expect(preservedKinds(item.value)).toEqual([TokenKind.Dimension]);
  });

  test('does not parse nested qualified rules', () => {
    const items = parseListOfDeclarations('& { color: red }; color: blue');

    expect(items).toHaveLength(1);

    const item = expectDeclaration(items[0]);
    expect(item.name).toBe('color');
    expect(preservedKinds(item.value)).toEqual([TokenKind.Ident]);
  });
});

describe('5.4.6 consume a declaration', () => {
  test('returns null when input does not start with an ident token', () => {
    expect(parseDeclaration(': red')).toBeNull();
    expect(parseDeclaration('@x red')).toBeNull();
    expect(parseDeclaration('')).toBeNull();
  });

  test('returns null when the declaration is missing a colon', () => {
    expect(parseDeclaration('color red')).toBeNull();
    expect(parseDeclaration('color')).toBeNull();
  });

  test('parses a declaration name and value', () => {
    const declaration = expectDeclaration(parseDeclaration('color: red'));

    expect(declaration.name).toBe('color');
    expect(declaration.important).toBe(false);
    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);
  });

  test('allows whitespace before and after the colon', () => {
    const declaration = expectDeclaration(parseDeclaration('color \n\t : \n\t red'));

    expect(declaration.name).toBe('color');
    expect(declaration.important).toBe(false);
    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);
  });

  test('preserves component values in declaration values', () => {
    const declaration = expectDeclaration(parseDeclaration('x: foo(bar) [baz]'));

    expect(declaration.name).toBe('x');
    expect(declaration.value).toHaveLength(3);

    expect(declaration.value[0]).toMatchObject({
      name: 'foo',
    });

    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Whitespace]);

    expect(declaration.value[2]).toMatchObject({
      block: BlockKind.Bracket,
    });
  });

  test('trims trailing whitespace from declaration values', () => {
    const declaration = expectDeclaration(parseDeclaration('color: red   \n\t'));

    expect(declaration.name).toBe('color');
    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);
  });

  test('recognizes important flags', () => {
    const spaced = expectDeclaration(parseDeclaration('color: red ! important'));
    const unspaced = expectDeclaration(parseDeclaration('color: red!important'));
    const mixedCase = expectDeclaration(parseDeclaration('color: red ! ImPoRtAnT'));

    expect(spaced.important).toBe(true);
    expect(unspaced.important).toBe(true);
    expect(mixedCase.important).toBe(true);

    expect(preservedKinds(spaced.value)).toEqual([TokenKind.Ident]);
    expect(preservedKinds(unspaced.value)).toEqual([TokenKind.Ident]);
    expect(preservedKinds(mixedCase.value)).toEqual([TokenKind.Ident]);
  });

  test('does not recognize important unless it is the final two non-whitespace tokens', () => {
    const declaration = expectDeclaration(parseDeclaration('color: red ! important extra'));

    expect(declaration.important).toBe(false);
    expect(preservedKinds(declaration.value)).toEqual([
      TokenKind.Ident,
      TokenKind.Whitespace,
      TokenKind.Delim,
      TokenKind.Whitespace,
      TokenKind.Ident,
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);
  });

  test('list parsing treats semicolon as a declaration boundary', () => {
    const items = parseListOfDeclarations('color: red; width: 10px');

    expect(items).toHaveLength(2);

    const first = expectDeclaration(items[0]);
    const second = expectDeclaration(items[1]);

    expect(first.name).toBe('color');
    expect(preservedKinds(first.value)).toEqual([TokenKind.Ident]);

    expect(second.name).toBe('width');
    expect(preservedKinds(second.value)).toEqual([TokenKind.Dimension]);
  });
});

describe('5.4.7 consume a component value', () => {
  test('returns preserved tokens directly', () => {
    expectPreservedToken(parseComponentValue('red'), TokenKind.Ident);
    expectPreservedToken(parseComponentValue('}'), TokenKind.RightBrace);
    expectPreservedToken(parseComponentValue(']'), TokenKind.RightBracket);
    expectPreservedToken(parseComponentValue(')'), TokenKind.RightParen);
  });

  test('consumes opening block tokens into simple blocks', () => {
    expectSimpleBlock(parseComponentValue('{}'), BlockKind.Brace);
    expectSimpleBlock(parseComponentValue('[]'), BlockKind.Bracket);
    expectSimpleBlock(parseComponentValue('()'), BlockKind.Parens);
  });

  test('consumes function tokens into function blocks', () => {
    const value = expectFunctionBlock(parseComponentValue('foo()'), 'foo');

    expect(value.value).toEqual([]);
  });

  test('parseComponentValue rejects multiple top-level component values', () => {
    expect(parseComponentValue('red blue')).toBeNull();
    expect(parseComponentValue('{} []')).toBeNull();
  });
});

describe('5.4.8 consume a simple block', () => {
  test('returns empty simple blocks when the ending token is next', () => {
    expect(expectSimpleBlock(parseComponentValue('{}'), BlockKind.Brace).value).toEqual([]);
    expect(expectSimpleBlock(parseComponentValue('[]'), BlockKind.Bracket).value).toEqual([]);
    expect(expectSimpleBlock(parseComponentValue('()'), BlockKind.Parens).value).toEqual([]);
  });

  test('consumes nested component values inside a simple block', () => {
    const block = expectSimpleBlock(parseComponentValue('{ [x] foo(bar) }'), BlockKind.Brace);

    expect(block.value).toHaveLength(5);
    expect(preservedKinds(block.value)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Whitespace,
      TokenKind.Whitespace,
    ]);

    expectSimpleBlock(block.value[1], BlockKind.Bracket);
    expectFunctionBlock(block.value[3], 'foo');
  });

  test('returns the block at EOF when the ending token is missing', () => {
    const block = expectSimpleBlock(parseComponentValue('{ color: red'), BlockKind.Brace);

    expect(preservedKinds(block.value)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
      TokenKind.Colon,
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);
  });

  test('only the mirror ending token closes a simple block', () => {
    const parens = expectSimpleBlock(parseComponentValue('(x]'), BlockKind.Parens);
    const brackets = expectSimpleBlock(parseComponentValue('[x)'), BlockKind.Bracket);

    expect(preservedKinds(parens.value)).toEqual([
      TokenKind.Ident,
      TokenKind.RightBracket,
    ]);

    expect(preservedKinds(brackets.value)).toEqual([
      TokenKind.Ident,
      TokenKind.RightParen,
    ]);
  });

  test('preserves nested unmatched closing tokens inside the block value', () => {
    const block = expectSimpleBlock(parseComponentValue('{ ) ] }'), BlockKind.Brace);

    expect(preservedKinds(block.value)).toEqual([
      TokenKind.Whitespace,
      TokenKind.RightParen,
      TokenKind.Whitespace,
      TokenKind.RightBracket,
      TokenKind.Whitespace,
    ]);
  });
});

describe('5.4.9 consume a function', () => {
  test('returns an empty function block when the ending paren is next', () => {
    const fn = expectFunctionBlock(parseComponentValue('foo()'), 'foo');

    expect(fn.value).toEqual([]);
  });

  test('consumes nested component values inside a function', () => {
    const fn = expectFunctionBlock(parseComponentValue('foo(bar, [baz])'), 'foo');

    expect(fn.value).toHaveLength(4);
    expect(preservedKinds(fn.value)).toEqual([
      TokenKind.Ident,
      TokenKind.Comma,
      TokenKind.Whitespace,
    ]);

    expectSimpleBlock(fn.value[3], BlockKind.Bracket);
  });

  test('returns the function at EOF when the ending paren is missing', () => {
    const fn = expectFunctionBlock(parseComponentValue('foo(bar [baz]'), 'foo');

    expect(preservedKinds(fn.value)).toEqual([
      TokenKind.Ident,
      TokenKind.Whitespace,
    ]);

    expectSimpleBlock(fn.value[2], BlockKind.Bracket);
  });

  test('consumes nested functions as component values', () => {
    const fn = expectFunctionBlock(parseComponentValue('foo(bar(baz))'), 'foo');
    const nested = expectFunctionBlock(fn.value[0], 'bar');

    expect(preservedKinds(nested.value)).toEqual([TokenKind.Ident]);
  });

  test('stops at the first matching right paren', () => {
    const values = parseListOfComponentValues('foo())');

    expect(values).toHaveLength(2);

    expectFunctionBlock(values[0], 'foo');
    expectPreservedToken(values[1], TokenKind.RightParen);
  });
});

describe('5.3.5 parse a rule', () => {
  test('returns null for empty or whitespace-only input', () => {
    expect(parseRule('')).toBeNull();
    expect(parseRule(' \n\t ')).toBeNull();
  });

  test('allows leading and trailing whitespace around one at-rule', () => {
    const rule = expectAtRule(parseRule(' \n\t @media screen; \n\t '));

    expect(rule.name).toBe('media');
    expect(rule.block).toBeNull();
  });

  test('allows leading and trailing whitespace around one qualified rule', () => {
    const rule = expectQualifiedRule(parseRule(' \n\t .a {} \n\t '));

    expect(rule.block.block).toBe(BlockKind.Brace);
    expect(preservedKinds(rule.prelude)).toEqual([
      TokenKind.Delim,
      TokenKind.Ident,
      TokenKind.Whitespace,
    ]);
  });

  test('returns null when qualified-rule parsing returns nothing', () => {
    expect(parseRule('.a')).toBeNull();
  });

  test('rejects extra non-whitespace input after one at-rule', () => {
    expect(parseRule('@media; .a {}')).toBeNull();
  });

  test('rejects extra non-whitespace input after one qualified rule', () => {
    expect(parseRule('.a {} .b {}')).toBeNull();
  });
});

describe('5.3.6 parse a declaration', () => {
  test('allows leading whitespace before a declaration', () => {
    const declaration = expectDeclaration(parseDeclaration(' \n\t color: red'));

    expect(declaration.name).toBe('color');
    expect(preservedKinds(declaration.value)).toEqual([TokenKind.Ident]);
  });

  test('parses only declarations, not at-rules', () => {
    expect(parseDeclaration('@x foo;')).toBeNull();
  });

  test('returns null when declaration parsing returns nothing', () => {
    expect(parseDeclaration('color red')).toBeNull();
  });
});

describe('5.3.7 and 5.3.8 style-block contents vs declaration list', () => {
  test('style block contents allow nested qualified rules, declaration lists do not', () => {
    const styleItems = parseStyleBlockContents('& { color: red }; color: blue');
    const declarationItems = parseListOfDeclarations('& { color: red }; color: blue');

    expect(styleItems).toHaveLength(2);
    expectQualifiedRule(styleItems[0]);
    expectDeclaration(styleItems[1]);

    expect(declarationItems).toHaveLength(1);
    expectDeclaration(declarationItems[0]);
  });
});

describe('5.3.9 parse a component value', () => {
  test('returns null for empty or whitespace-only input', () => {
    expect(parseComponentValue('')).toBeNull();
    expect(parseComponentValue(' \n\t ')).toBeNull();
  });

  test('allows leading and trailing whitespace around one component value', () => {
    expectPreservedToken(parseComponentValue(' \n\t red \n\t '), TokenKind.Ident);
    expectSimpleBlock(parseComponentValue(' \n\t [x] \n\t '), BlockKind.Bracket);
    expectFunctionBlock(parseComponentValue(' \n\t foo(x) \n\t '), 'foo');
  });

  test('rejects extra non-whitespace after one component value', () => {
    expect(parseComponentValue('red blue')).toBeNull();
    expect(parseComponentValue('red, blue')).toBeNull();
    expect(parseComponentValue('[x] foo')).toBeNull();
  });
});

describe('5.3.10 parse a list of component values', () => {
  test('returns an empty list for empty input', () => {
    expect(parseListOfComponentValues('')).toEqual([]);
  });

  test('returns all component values and preserves whitespace tokens', () => {
    const values = parseListOfComponentValues(' red [x] foo(y) ');

    expect(values).toHaveLength(7);

    expect(preservedKinds(values)).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
      TokenKind.Whitespace,
      TokenKind.Whitespace,
      TokenKind.Whitespace,
    ]);

    expectSimpleBlock(values[3], BlockKind.Bracket);
    expectFunctionBlock(values[5], 'foo');
  });
});

describe('5.3.11 parse a comma-separated list of component values', () => {
  test('returns one empty component-value list for empty input', () => {
    expect(parseCommaSeparatedListOfComponentValues('')).toEqual([[]]);
  });

  test('splits on top-level commas and excludes the comma tokens', () => {
    const lists = parseCommaSeparatedListOfComponentValues('a, b, c');

    expect(lists).toHaveLength(3);

    expect(preservedKinds(lists[0])).toEqual([TokenKind.Ident]);
    expect(preservedKinds(lists[1])).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);
    expect(preservedKinds(lists[2])).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);
  });

  test('preserves empty items from leading, trailing, and consecutive commas', () => {
    const lists = parseCommaSeparatedListOfComponentValues(',a,,b,');

    expect(lists).toHaveLength(5);

    expect(lists[0]).toEqual([]);
    expect(preservedKinds(lists[1])).toEqual([TokenKind.Ident]);
    expect(lists[2]).toEqual([]);
    expect(preservedKinds(lists[3])).toEqual([TokenKind.Ident]);
    expect(lists[4]).toEqual([]);
  });

  test('does not split on commas inside simple blocks or functions', () => {
    const lists = parseCommaSeparatedListOfComponentValues('foo(a, b), [c, d], e');

    expect(lists).toHaveLength(3);

    const fn = expectFunctionBlock(lists[0][0], 'foo');
    const block = expectSimpleBlock(lists[1][1], BlockKind.Bracket);

    expect(preservedKinds(fn.value)).toEqual([
      TokenKind.Ident,
      TokenKind.Comma,
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);

    expect(preservedKinds(block.value)).toEqual([
      TokenKind.Ident,
      TokenKind.Comma,
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);

    expect(preservedKinds(lists[2])).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
    ]);
  });

  test('preserves whitespace around list items', () => {
    const lists = parseCommaSeparatedListOfComponentValues(' a , b ');

    expect(lists).toHaveLength(2);

    expect(preservedKinds(lists[0])).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
      TokenKind.Whitespace,
    ]);

    expect(preservedKinds(lists[1])).toEqual([
      TokenKind.Whitespace,
      TokenKind.Ident,
      TokenKind.Whitespace,
    ]);
  });
});

describe('oracle-derived syntax recovery behavior', () => {
  test('unterminated comment consumes the rest of the declaration list input', () => {
    const items = parseStyleBlockContents(`
      margin-left: 1px;
      /* unterminated
      margin-right: 2px;
    `);

    expect(items).toHaveLength(1);

    const first = expectDeclaration(items[0]);

    expect(first.name).toBe('margin-left');
    expect(preservedKinds(first.value)).toEqual([TokenKind.Dimension]);
  });

  test('semicolon inside a string does not split a declaration value', () => {
    const items = parseStyleBlockContents(`
      font-family: "x;y";
      margin-left: 3px;
    `);

    expect(items).toHaveLength(2);

    const first = expectDeclaration(items[0]);
    const second = expectDeclaration(items[1]);

    expect(first.name).toBe('font-family');
    expect(preservedKinds(first.value)).toEqual([TokenKind.String]);

    expect(second.name).toBe('margin-left');
    expect(preservedKinds(second.value)).toEqual([TokenKind.Dimension]);
  });

  test('newline in string swallows a later same-block declaration into the malformed declaration value', () => {
    const items = parseStyleBlockContents(`
      margin-right: 5px;
      font-family: "x
      y";
      margin-left: 3px;
    `);

    expect(items).toHaveLength(2);

    const first = expectDeclaration(items[0]);
    const second = expectDeclaration(items[1]);

    expect(first.name).toBe('margin-right');
    expect(preservedKinds(first.value)).toEqual([TokenKind.Dimension]);

    expect(second.name).toBe('font-family');
    expect(preservedKinds(second.value)).toContain(TokenKind.BadString);
    expect(preservedKinds(second.value)).toContain(TokenKind.Ident);
    expect(preservedKinds(second.value)).toContain(TokenKind.Dimension);

    expect(items.some((item) => (
      'important' in item && item.name === 'margin-left'
    ))).toBe(false);
  });

  test('newline in string followed by bare semicolon recovers the following declaration', () => {
    const items = parseStyleBlockContents(`
      margin-right: 5px;
      font-family: "x
      ;
      margin-left: 3px;
    `);

    expect(items).toHaveLength(3);

    const first = expectDeclaration(items[0]);
    const second = expectDeclaration(items[1]);
    const third = expectDeclaration(items[2]);

    expect(first.name).toBe('margin-right');
    expect(preservedKinds(first.value)).toEqual([TokenKind.Dimension]);

    expect(second.name).toBe('font-family');
    expect(preservedKinds(second.value)).toContain(TokenKind.BadString);

    expect(third.name).toBe('margin-left');
    expect(preservedKinds(third.value)).toEqual([TokenKind.Dimension]);
  });

  test('bad url remains in the current declaration value and recovers the following declaration', () => {
    const items = parseStyleBlockContents(`
      background-image: url(foo"bar);
      margin-left: 4px;
    `);

    expect(items).toHaveLength(2);

    const first = expectDeclaration(items[0]);
    const second = expectDeclaration(items[1]);

    expect(first.name).toBe('background-image');
    expect(preservedKinds(first.value)).toEqual([TokenKind.BadUrl]);

    expect(second.name).toBe('margin-left');
    expect(preservedKinds(second.value)).toEqual([TokenKind.Dimension]);
  });

  test('brace inside quoted attribute value is not treated as the qualified-rule block boundary', () => {
    const rule = expectQualifiedRule(parseRule('.foo[data-x="{"] {}'));

    expect(rule.block.block).toBe(BlockKind.Brace);

    expect(rule.prelude.length).toBeGreaterThan(2);
    expectSimpleBlock(rule.prelude[2], BlockKind.Bracket);
  });

  test('nested ampersand item order is preserved in style block contents', () => {
    const after = parseStyleBlockContents(`
      background-color: rgb(0, 255, 0);

      & {
        background-color: rgb(255, 0, 0);
      }
    `);

    expect(after).toHaveLength(2);
    expectDeclaration(after[0]);
    expectQualifiedRule(after[1]);

    const before = parseStyleBlockContents(`
      & {
        background-color: rgb(255, 0, 0);
      }

      background-color: rgb(0, 255, 0);
    `);

    expect(before).toHaveLength(2);
    expectQualifiedRule(before[0]);
    expectDeclaration(before[1]);
  });
});
