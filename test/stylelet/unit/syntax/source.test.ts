import { describe, expect, it } from 'vitest';

import { createFreeFormConsumer } from '../../../../src/stylelet/syntax/component-consumers';
import { isComponentBlock } from '../../../../src/stylelet/syntax/component-value';
import {
  parseAsComponentGrammar, parseComponentValue, parseDeclaration, parseListAsComponentGrammar,
  parseListOfComponentValues,
} from '../../../../src/stylelet/syntax/parser';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { TokenList } from '../../../../src/stylelet/syntax/token-list';
import { FirstValidValue } from '../../../../src/stylelet/values/substitution/first-valid';

describe('token-list whitespace boundaries', () => {
  it('keeps source ranges and nested whitespace intact when trimming a collected value', () => {
    const list = parseListOfComponentValues(' \t/**/ --x: fn( a ) /**/ foo\\62 ar \n/**/', {});
    list.trimWhitespace();

    expect(list.sourceText()).toBe('--x: fn( a ) /**/ foo\\62 ar');
    expect(parseDeclaration(list, {})?.originalText).toBe('fn( a ) /**/ foo\\62 ar');
  });

  it.each(['', ' \t\n', '/**/ \n/**/'])('trims empty or whitespace-only input: %j', (input) => {
    const list = TokenList.tokenize(input);
    list.trimWhitespace();

    expect(list.sourceText()).toBe('');
    expect(new TokenCursor(list, {}).eof()).toBe(true);
  });

  it('preserves whitespace escaped inside an identifier', () => {
    const list = TokenList.tokenize(' \t\\  \n');
    list.trimWhitespace();

    expect(list.sourceText()).toBe('\\ ');
    expect(new TokenCursor(list, {}).next()).toEqual({ type: TokenKind.Ident, value: ' ' });
  });
});

describe('source spelling through component parsing', () => {
  it('slices and truncates independently while preserving original source spans', () => {
    const source = parseListOfComponentValues('skip --x: fn( a ) /**/ foo\\62 ar', {});
    const list = source.slice(2);
    list.truncate(5);

    expect(parseDeclaration(list, {})?.originalText).toBe('fn( a )');
    expect(list.sourceText()).toBe('--x: fn( a ) ');
    expect(source.sourceText()).toBe('skip --x: fn( a ) /**/ foo\\62 ar');

    list.truncate(0);
    expect(list.sourceText()).toBe('');
    expect(new TokenCursor(list, {}).eof()).toBe(true);
    expect(parseDeclaration(source.slice(2), {})?.originalText).toBe('fn( a ) /**/ foo\\62 ar');
  });

  it('retains token-list source when creating another cursor', () => {
    const list = TokenList.tokenize('--x: foo\\62 ar');

    expect(parseDeclaration(list, {})?.originalText).toBe('foo\\62 ar');
  });

  it('aligns folded component ranges after consuming an existing cursor prefix', () => {
    const inputList = TokenList.tokenize('skip --x: fn(a) /**/ [b] foo\\62 ar !important');
    const input = new TokenCursor(inputList, {});
    input.next();
    const list = parseListOfComponentValues(input, input.context);
    const declaration = parseDeclaration(list, {});

    expect(declaration).toMatchObject({
      name: '--x', originalText: 'fn(a) /**/ [b] foo\\62 ar', important: true,
    });
    expect(input.eof()).toBe(true);
  });

  it.each(['{ --x: fn(a) /**/ foo\\62 ar }', '{ --x: fn(a) /**/ foo\\62 ar'])(
    'retains the source of closed and EOF-terminated block children: %s', (source) => {
      const block = parseComponentValue(source, {});
      if (block === null || !isComponentBlock(block)) throw new Error('Expected a block');

      expect(parseDeclaration(block.value, {})?.originalText)
        .toBe('fn(a) /**/ foo\\62 ar');
    },
  );

  it('retains function argument source for unicode-range retokenization', () => {
    const block = parseComponentValue('example(unicode-range: U+4??)', {});
    if (block === null || !isComponentBlock(block)) throw new Error('Expected a block');

    expect(parseDeclaration(block.value, {})?.value.tokens).toEqual([
      { type: TokenKind.UnicodeRange, start: 0x400, end: 0x4FF },
    ]);
  });

  it('carries source into component grammars and separate comma-list arms', () => {
    const consume = (c: TokenCursor) => parseDeclaration(c, c.context);

    expect(parseAsComponentGrammar('--x: fn(a) /**/ foo\\62 ar', consume, {})?.originalText)
      .toBe('fn(a) /**/ foo\\62 ar');
    expect(parseListAsComponentGrammar('--x: fn(a) foo\\62 ar, --y: [b] b\\61 z', consume, {})
      .map((declaration) => declaration?.originalText))
      .toEqual(['fn(a) foo\\62 ar', '[b] b\\61 z']);
  });

  it.each(['--x: foo\\62 ar', '{ --x: foo\\62 ar }'])(
    'preserves source through the free-form consumer: %s', (input) => {
      const consume = createFreeFormConsumer((c) => parseDeclaration(c, c.context));

      expect(parseAsComponentGrammar(input, consume, {})?.originalText).toBe('foo\\62 ar');
    },
  );

  it('retains source when a first-valid argument is collected and parsed again', () => {
    const value = FirstValidValue.parse('first-valid({ --x: fn(a) /**/ foo\\62 ar })', {});

    expect(value).not.toBeNull();
    const [argument] = value!.value;
    expect(parseDeclaration(argument.value, {})?.originalText)
      .toBe('fn(a) /**/ foo\\62 ar');
  });
});
