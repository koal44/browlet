import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  DeclarationValue, OptionalDeclarationValue, type DeclarationComponent,
} from '../../../../src/stylelet/values/declaration-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import type { NonEmptyTokenList, TokenList } from '../../../../src/stylelet/syntax/token-list';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';

describe.each([
  ['DeclarationValue', DeclarationValue],
  ['OptionalDeclarationValue', OptionalDeclarationValue],
] as const)('%s', (_name, ValueClass) => {
  it('parses a nonempty sequence of declaration component values', () => {
    const list = parseListOfComponentValues('red 1px url(foo.png)', {});
    const value = ValueClass.parse(list, {});

    expect(value).toBeInstanceOf(ValueClass);
    expect(value).toEqual({
      value: list,
    });
    expect(value?.value).toBe(list);
  });

  it('consumes a nonempty declaration value', () => {
    const list = parseListOfComponentValues('red 1px url(foo.png)', {});

    const value = ValueClass.consume(new TokenCursor(list, {}));

    expect(value).toBeInstanceOf(ValueClass);
    expect(value).toEqual({
      value: list,
    });
  });

  it('rejects top-level semicolons and bangs', () => {
    expect(ValueClass.parse('a ! b', {})).toBeNull();
    expect(ValueClass.parse('a; b', {})).toBeNull();
  });

  it('allows semicolons and bangs inside blocks', () => {
    expect(ValueClass.parse('fn(a ! b; c)', {})).not.toBeNull();
    expect(ValueClass.parse('[a ! b; c]', {})).not.toBeNull();
    expect(ValueClass.parse('(a ! b; c)', {})).not.toBeNull();
  });

  it('rejects invalid component values recursively', () => {
    expect(ValueClass.parse('"x\ny"', {})).toBeNull();
    expect(ValueClass.parse('fn(url(foo"bar))', {})).toBeNull();
    expect(ValueClass.parse('fn(])', {})).toBeNull();
    expect(ValueClass.parse('[)]', {})).toBeNull();
  });

  it('retains the original component list, tokens, and source spans', () => {
    const list = parseListOfComponentValues('a /**/ fn( b )', {});
    const parsed = ValueClass.parse(list, {})!;
    const cursor = new TokenCursor(list, {});
    const consumed = ValueClass.consume(cursor)!;

    for (const declaration of [parsed, consumed]) {
      expect(declaration.value).toBe(list);
      expect(declaration.value.tokens).toBe(list.tokens);
      expect(declaration.value.sourceText()).toBe('a /**/ fn( b )');
      expect(declaration.serialize()).toBe('a  fn( b )');
    }
    expect(cursor.eof()).toBe(true);
  });

  it('retains partial source spans and leaves an unmatched closing token unread', () => {
    const list = parseListOfComponentValues('skip a /**/ fn(b)) rest', {});
    const cursor = new TokenCursor(list, {}, { position: 2 });
    const declaration = ValueClass.consume(cursor)!;

    expect(declaration.value.sourceText()).toBe('a /**/ fn(b)');
    expect(declaration.value.tokens[0]).toBe(list.tokens[2]);
    expect(cursor.pos()).toBe(6);
    expect(list.sourceText()).toBe('skip a /**/ fn(b)) rest');
  });

  it.each(['a ! b', 'a; b', ')', 'fn(])'])(
    'rejects invalid contents %j without consuming them',
    (input) => {
      const cursor = new TokenCursor(parseListOfComponentValues(input, {}), {});
      expect(ValueClass.consume(cursor)).toBeNull();
      expect(cursor.pos()).toBe(0);
    },
  );

  it('keeps opaque values unchanged at every stage', () => {
    const declaration = ValueClass.parse('var(--length, calc(1em + 2px))', {})!;
    const context = { length: { em: 16 } };
    const text = declaration.serialize();

    for (const stage of [
      ValueStage.Declared, ValueStage.Cascaded, ValueStage.Specified,
      ValueStage.Computed, ValueStage.Used, ValueStage.Actual,
    ]) {
      expect(declaration.resolve(stage, context)).toBe(declaration);
      expect(declaration.serialize()).toBe(text);
    }
  });
});

describe('DeclarationValue nonempty grammar', () => {
  it('rejects an empty production', () => {
    expect(DeclarationValue.parse('', {})).toBeNull();
    expect(DeclarationValue.consume(new TokenCursor(parseListOfComponentValues('', {}), {}))).toBeNull();
  });

  it('preserves the nonempty guarantee in parsing and resolution types', () => {
    const declaration = DeclarationValue.parse('red', {})!;

    expectTypeOf(declaration.value).toEqualTypeOf<NonEmptyTokenList<DeclarationComponent>>();
    expectTypeOf(declaration.resolve(ValueStage.Computed, {}).value)
      .toEqualTypeOf<NonEmptyTokenList<DeclarationComponent>>();
  });
});

describe('OptionalDeclarationValue optional grammar', () => {
  it('retains its own class for both empty and nonempty input', () => {
    for (const input of ['', 'red']) {
      const list = parseListOfComponentValues(input, {});
      const parsed = OptionalDeclarationValue.parse(list, {})!;
      const consumed = OptionalDeclarationValue.consume(new TokenCursor(list, {}))!;

      expect(parsed.value).toBe(list);
      for (const declaration of [parsed, consumed]) {
        expect(declaration).toBeInstanceOf(OptionalDeclarationValue);
        expect(declaration).not.toBeInstanceOf(DeclarationValue);
        expect(declaration.serialize()).toBe(input);
        expect(declaration.resolve(ValueStage.Computed, {})).toBe(declaration);
      }
    }
  });

  it('does not claim a nonempty payload', () => {
    const optional = OptionalDeclarationValue.parse('', {})!;

    expectTypeOf(optional.value).toEqualTypeOf<TokenList<DeclarationComponent>>();
    expectTypeOf(optional).not.toExtend<DeclarationValue>();
    expectTypeOf(optional.resolve(ValueStage.Computed, {})).toEqualTypeOf<OptionalDeclarationValue>();
  });
});
