import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { defaultStyleletEnvironment as env } from '../../../../src/stylelet/environment';
import { RuleListContext } from '../../../../src/stylelet/cssom/rules/context';
import { CSSRuleListImpl } from '../../../../src/stylelet/cssom/rule-list';
import { CSSStyleRuleImpl } from '../../../../src/stylelet/cssom/rules/style';
import type { CSSRuleImpl } from '../../../../src/stylelet/cssom/rules/rule';
import {
  consumeBlock, parseBlockContents, parseDeclaration, parseDeclarationList,
  parseListOfComponentValues, parseRule, parseStylesheetContents, type BlockContents,
} from '../../../../src/stylelet/syntax/parser';
import { serializeComponentValues } from '../../../../src/stylelet/syntax/component-value';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { tokenize } from '../../../../src/stylelet/syntax/tokens';

const context = new RuleListContext(new CSSRuleListImpl(), null, false, env);

afterEach(() => vi.restoreAllMocks());

describe('stylesheet parsing context', () => {
  it.each([
    ['stylesheet', parseStylesheetContents],
    ['single rule', parseRule],
    ['block contents', parseBlockContents],
  ] as const)('requires RuleListContext in the %s signature', (_name, parse) => {
    expectTypeOf(parse).parameter(1).toEqualTypeOf<RuleListContext>();
  });

  it('preserves unsupported declaration syntax with an empty or stylesheet context', () => {
    vi.spyOn(context, 'interpretDeclaration').mockImplementation(() => {
      throw new Error('Unexpected property interpretation');
    });
    for (const selected of [{}, context]) {
      const cursor = new TokenCursor(tokenize('unknown-property: something'), selected);
      expect(parseDeclaration(cursor, selected)).toMatchObject({ name: 'unknown-property' });
      expect(cursor.context).toBe(selected);
    }
  });

  it('discards whole at-rules in declaration input without invoking rule interpretation', () => {
    const unexpected = (): never => { throw new Error('Unexpected rule interpretation'); };
    vi.spyOn(context, 'interpretStatementAtRule').mockImplementation(unexpected);
    vi.spyOn(context, 'interpretBlockAtRule').mockImplementation(unexpected);
    vi.spyOn(context, 'interpretQualifiedRule').mockImplementation(unexpected);

    const declarations = parseDeclarationList(
      '@media screen { div { color: black } } color: red; @import "ignored.css"; width: 1px',
      context,
    );
    expect(declarations.map(({ name }) => name)).toEqual(['color', 'width']);
  });

  it('retries a grammar-rejected declaration as a qualified rule before advancing', () => {
    const qualified = vi.spyOn(context, 'interpretQualifiedRule');
    const contents = parseBlockContents('example: {}; color: red', context);

    expect(qualified).toHaveBeenCalledOnce();
    expect(serializeComponentValues(qualified.mock.calls[0]![0].tokens)).toBe('example: ');
    expect(contents).toMatchObject([[{ name: 'color' }]]);
  });

  it.each([false, true])('selects child declaration grammar and restores the parent (prebuilt: %s)', (prebuilt) => {
    const inner = new RuleListContext(new CSSRuleListImpl(), null, false, env);
    const interpretOuter = context.interpretDeclaration.bind(context);
    const interpretInner = inner.interpretDeclaration.bind(inner);
    vi.spyOn(context, 'interpretDeclaration').mockImplementation((declaration) =>
      declaration.name === 'color' ? interpretOuter(declaration) : null,
    );
    vi.spyOn(inner, 'interpretDeclaration').mockImplementation((declaration) =>
      declaration.name === 'opacity' ? interpretInner(declaration) : null,
    );
    let block: BlockContents = [];
    vi.spyOn(context, 'interpretBlockAtRule').mockImplementation((_name, _prelude, _preceding, c) => {
      block = c.withContext(inner, consumeBlock);
      expect(c.context).toBe(context);
      return null;
    });
    const text = '@test { opacity: .5; color: red } color: blue';
    const list = prebuilt ? parseListOfComponentValues(text, {}) : tokenize(text);
    const original = { purpose: 'caller context' };
    const cursor = new TokenCursor(list, original);
    expectTypeOf(cursor.context).toEqualTypeOf<typeof original>();
    const contents = parseBlockContents(cursor, context);

    expect(block).toMatchObject([[{ name: 'opacity' }]]);
    expect(contents).toMatchObject([[{ name: 'color' }]]);
    expect(cursor.context).toBe(original);
    expect(cursor.eof()).toBe(true);
  });

  it('provides preceding siblings for statement placement and checks semicolon/EOF returns', () => {
    const accepted = parseRule('.accepted {}', context)!;
    vi.spyOn(context, 'interpretStatementAtRule').mockImplementation((_rule, preceding) =>
      preceding === null || preceding.length === 0 ? accepted : null,
    );

    expect(parseStylesheetContents('@first; @second', context)).toEqual([accepted]);
    expect(parseRule('@first', context)).toBe(accepted);
    let block: BlockContents = [];
    vi.spyOn(context, 'interpretBlockAtRule').mockImplementation((_name, _prelude, _preceding, c) => {
      block = c.withContext(context, consumeBlock);
      return null;
    });
    const cursor = new TokenCursor(tokenize('@test { @first } .after {}'), {});
    const rules = parseStylesheetContents(cursor, context);
    expect(block).toEqual([accepted]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toBeInstanceOf(CSSStyleRuleImpl);
    expect(cursor.eof()).toBe(true);
  });

  it('can reject a rule after consuming its block without rejecting the next rule', () => {
    const accepted = parseRule('.accepted {}', context)!;
    vi.spyOn(context, 'interpretBlockAtRule').mockImplementation((_name, _prelude, _preceding, c) => {
      const block = c.withContext(context, consumeBlock);
      return block.length === 0 ? null : accepted;
    });

    expect(parseStylesheetContents('@test {} @test { color: red }', context)).toEqual([accepted]);
  });

  it.each([
    ['stylesheet', parseStylesheetContents],
    ['single rule', parseRule],
    ['block contents', parseBlockContents],
  ] as const)('restores the caller context when a child grammar throws during %s parsing', (_name, parse) => {
    const child = new RuleListContext(new CSSRuleListImpl(), null, false, env);
    const failure = new Error('Missing descriptor grammar');
    vi.spyOn(child, 'interpretDeclaration').mockImplementation(() => { throw failure; });
    vi.spyOn(context, 'interpretBlockAtRule').mockImplementation((_name, _prelude, _preceding, c) => {
      c.withContext(child, consumeBlock);
      return null;
    });
    const original = { purpose: 'caller context' };
    const cursor = new TokenCursor(tokenize('@test { descriptor: x }'), original);

    expect(() => parse(cursor, context)).toThrow(failure);
    expect(cursor.context).toBe(original);
  });

  it('returns property declarations and CSSOM rules from block parsing', () => {
    const contents = parseBlockContents('color: red; .child { color: blue }', context);
    expectTypeOf(contents).toEqualTypeOf<BlockContents>();
    expectTypeOf(parseRule('', context)).toEqualTypeOf<CSSRuleImpl | null>();
    expectTypeOf(parseStylesheetContents('', context)).toEqualTypeOf<CSSRuleImpl[]>();

    expect(contents[0]).toMatchObject([{ type: 'property-declaration', name: 'color' }]);
    expect(contents[1]).toBeInstanceOf(CSSStyleRuleImpl);
  });
});
