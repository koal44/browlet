import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  consumeBlock, discardRuleBlock, parseBlockContents, parseDeclaration, parseDeclarationList,
  parseListOfComponentValues, parseRule, parseStylesheetContents,
  type ParsingContext,
} from '../../../../src/stylelet/syntax/parser';
import { serializeComponentValues } from '../../../../src/stylelet/syntax/component-value';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { tokenize } from '../../../../src/stylelet/syntax/tokens';
import { SyntaxParsingContext } from '../../../support/stylelet-syntax';

describe('rule parsing context', () => {
  it.each([
    ['stylesheet', parseStylesheetContents],
    ['single rule', parseRule],
    ['block contents', parseBlockContents],
  ] as const)('requires ParsingContext in the %s signature', (_name, parse) => {
    expectTypeOf(parse).parameter(1).toEqualTypeOf<ParsingContext>();
  });

  it('preserves unsupported declaration syntax with an empty or complete context', () => {
    const full = new SyntaxParsingContext();
    full.interpretDeclaration = () => { throw new Error('Unexpected property interpretation'); };
    for (const context of [{}, full]) {
      const cursor = new TokenCursor(tokenize('unknown-property: something'), context);
      expect(parseDeclaration(cursor, context)).toMatchObject({ name: 'unknown-property' });
      expect(cursor.context).toBe(context);
    }
  });

  it('discards whole at-rules in declaration input without invoking rule interpretation', () => {
    const context = new SyntaxParsingContext();
    const unexpected = (): never => { throw new Error('Unexpected rule interpretation'); };
    context.interpretStatementAtRule = unexpected;
    context.interpretBlockAtRule = unexpected;
    context.interpretQualifiedRule = unexpected;

    const declarations = parseDeclarationList(
      '@media screen { div { color: black } } color: red; @import "ignored.css"; width: 1px',
      context,
    );
    expect(declarations.map(({ name }) => name)).toEqual(['color', 'width']);
  });

  it('retries a grammar-rejected declaration as a qualified rule before advancing', () => {
    const context = new SyntaxParsingContext();
    context.interpretDeclaration = (declaration) => declaration.name === 'color' ? declaration : null;

    const contents = parseBlockContents('example: {}; color: red', context);

    expect(contents).toHaveLength(2);
    const rule = contents[0];
    if (Array.isArray(rule) || rule?.type !== 'qualified-rule') throw new Error('Expected a qualified rule');
    expect(serializeComponentValues(rule.prelude.tokens)).toBe('example: ');
    expect(rule.block).toEqual([]);
    expect(contents[1]).toMatchObject([{ name: 'color' }]);
  });

  it.each([false, true])('selects child declaration grammar and restores the parent (prebuilt: %s)', (prebuilt) => {
    const outer = new SyntaxParsingContext();
    const inner = new SyntaxParsingContext();
    outer.interpretDeclaration = (declaration) => declaration.name === 'color' ? declaration : null;
    inner.interpretDeclaration = (declaration) => declaration.name === 'descriptor' ? declaration : null;
    outer.interpretBlockAtRule = (name, prelude, _preceding, c) => ({
      type: 'block-at-rule', name, prelude, block: c.withContext(inner, consumeBlock),
    });
    // Reuse the component block path without giving it access to any CSSOM grammar.
    const text = '@test { descriptor: x; color: red } color: blue';
    const list = prebuilt ? parseListOfComponentValues(text) : tokenize(text);
    const original = { purpose: 'caller context' };
    const cursor = new TokenCursor(list, original);
    expectTypeOf(cursor.context).toEqualTypeOf<typeof original>();
    const contents = parseBlockContents(cursor, outer);

    expect(contents).toMatchObject([
      { type: 'block-at-rule', block: [[{ name: 'descriptor' }]] },
      [{ name: 'color' }],
    ]);
    expect(cursor.context).toBe(original);
    expect(cursor.eof()).toBe(true);
  });

  it('provides preceding siblings for statement placement and checks semicolon/EOF returns', () => {
    const context = new SyntaxParsingContext();
    context.interpretStatementAtRule = (rule, preceding) => preceding.length === 0 ? rule : null;

    expect(parseStylesheetContents('@first; @second', context)).toMatchObject([
      { type: 'statement-at-rule', name: 'first' },
    ]);
    expect(parseRule('@first', context)).toMatchObject({ name: 'first' });
    expect(parseRule('@test { @first }', context)).toMatchObject({
      block: [{ type: 'statement-at-rule', name: 'first' }],
    });
  });

  it('can reject a rule after consuming its block without rejecting the next rule', () => {
    const context = new SyntaxParsingContext();
    context.interpretBlockAtRule = (name, prelude, _preceding, c) => {
      const block = c.withContext(context, consumeBlock);
      return block.length === 0 ? null : { type: 'block-at-rule', name, prelude, block };
    };

    expect(parseStylesheetContents('@test {} @test { color: red }', context)).toMatchObject([
      { name: 'test', block: [[{ name: 'color' }]] },
    ]);
  });

  it.each([
    ['stylesheet', parseStylesheetContents],
    ['single rule', parseRule],
    ['block contents', parseBlockContents],
  ] as const)('restores the caller context when a child grammar throws during %s parsing', (_name, parse) => {
    const context = new SyntaxParsingContext();
    const child = new SyntaxParsingContext();
    const failure = new Error('Missing descriptor grammar');
    child.interpretDeclaration = () => { throw failure; };
    context.interpretBlockAtRule = (_name, _prelude, _preceding, c) => {
      c.withContext(child, consumeBlock);
      return null;
    };
    const original = { purpose: 'caller context' };
    const cursor = new TokenCursor(tokenize('@test { descriptor: x }'), original);

    expect(() => parse(cursor, context)).toThrow(failure);
    expect(cursor.context).toBe(original);
  });

  it('allows a block to use a declaration type different from its parent grammar', () => {
    const descriptors: ParsingContext<never, string> = {
      interpretDeclaration: (declaration) => declaration.name === 'descriptor'
        ? serializeComponentValues(declaration.value.tokens) : null,
      interpretStatementAtRule: () => null,
      interpretBlockAtRule(_name, _prelude, _preceding, c) {
        discardRuleBlock(c);
        return null;
      },
      interpretQualifiedRule(_prelude, c) {
        discardRuleBlock(c);
        return null;
      },
    };
    const context = new SyntaxParsingContext();
    context.interpretBlockAtRule = (_name, _prelude, _preceding, c) => {
      const block = c.withContext(descriptors, consumeBlock);
      expectTypeOf(block).toEqualTypeOf<string[][]>();
      expect(block).toEqual([['example']]);
      return null;
    };

    expect(parseBlockContents('@test { descriptor: example } color: blue', context))
      .toMatchObject([[{ name: 'color' }]]);
  });
});
