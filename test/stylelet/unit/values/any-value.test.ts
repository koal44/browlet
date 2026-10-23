import { describe, expect, it } from 'vitest';

import { AnyValue } from '../../../../src/stylelet/values/any-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenList } from '../../../../src/stylelet/syntax/token-list';
import { RightParenToken } from '../../../../src/stylelet/syntax/tokens';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';

describe('AnyValue', () => {
  it('retains an existing component list and its source without copying arrays', () => {
    const list = parseListOfComponentValues('a /**/ fn(b)', {});
    const value = AnyValue.parse(list, {})!;

    expect(value).toBeInstanceOf(AnyValue);
    expect(value.repr).toBe(list);
    expect(value.repr.tokens).toBe(list.tokens);
    expect(value.repr.sourceText()).toBe('a /**/ fn(b)');
    // The comment separates two whitespace tokens; serialization retains both.
    expect(value.serialize()).toBe('a  fn(b)');
  });

  it('consumes the complete source list without copying it', () => {
    const list = parseListOfComponentValues('fn( a ) foo\\62 ar', {});
    const cursor = new TokenCursor(list, {});
    const value = AnyValue.consume(cursor)!;

    expect(value.repr).toBe(list);
    expect(value.repr.sourceText()).toBe('fn( a ) foo\\62 ar');
    expect(cursor.eof()).toBe(true);
  });

  it('retains a partial run and leaves an invalid component unread', () => {
    const list = parseListOfComponentValues('skip a /**/ fn(b)) rest', {});
    const cursor = new TokenCursor(list, {}, { position: 2 });
    const value = AnyValue.consume(cursor)!;

    expect(value.repr.sourceText()).toBe('a /**/ fn(b)');
    expect(value.repr.tokens[0]).toBe(list.tokens[2]);
    expect(cursor.pos()).toBe(6);
    expect(list.sourceText()).toBe('skip a /**/ fn(b)) rest');
  });

  it.each(['', ')', 'fn(])', 'url(foo"bar)'])('rejects invalid complete input %j', (input) => {
    expect(AnyValue.parse(input, {})).toBeNull();
  });

  it('accepts whitespace and empty nested blocks as components', () => {
    expect(AnyValue.parse(' ', {})!.serialize()).toBe(' ');
    expect(AnyValue.parse('fn() []', {})!.serialize()).toBe('fn() []');
  });

  it('keeps opaque contents unchanged through every lifecycle stage', () => {
    const value = AnyValue.parse('calc(1em + 2px)', {})!;
    const context = { length: { em: 16 } };

    for (const stage of [
      ValueStage.Declared, ValueStage.Cascaded, ValueStage.Specified,
      ValueStage.Computed, ValueStage.Used, ValueStage.Actual,
    ]) {
      expect(value.resolve(stage, context)).toBe(value);
      expect(value.serialize()).toBe('calc(1em + 2px)');
    }
  });
});


describe('any-value', () => {
  it('parses a nonempty sequence of arbitrary component values', () => {
    const expected = parseListOfComponentValues('a ! b; fn() []', {});
    expect(AnyValue.parse('a ! b; fn() []', {})).toEqual({
      repr: expected,
    });
  });

  it('retains the component list and source without copying', () => {
    const list = parseListOfComponentValues('a /**/ fn( b )', {});
    const value = AnyValue.parse(list, {});

    expect(value?.repr).toBeInstanceOf(TokenList);
    expect(value?.repr).toBe(list);
    expect(value?.repr.tokens).toEqual(list.tokens);
    for (let i = 0; i < list.tokens.length; i++) {
      expect(value?.repr.tokens[i]).toBe(list.tokens[i]);
    }
    expect(value?.repr.sourceText()).toBe('a /**/ fn( b )');
  });

  it('consumes the remaining nonempty component-value sequence', () => {
    const list = parseListOfComponentValues('a fn(b)', {});
    const c = new TokenCursor(list, {});
    const value = AnyValue.consume(c);

    expect(value?.repr).toBeInstanceOf(TokenList);
    expect(value).toEqual({
      repr: list,
    });
    expect(c.pos()).toBe(list.tokens.length);
  });

  it('stops before a component that cannot belong to the production', () => {
    const list = parseListOfComponentValues('a)', {});
    const c = new TokenCursor(list, {});

    expect(AnyValue.consume(c)).toEqual({
      repr: list.slice(0, 1),
    });
    expect(c.pos()).toBe(1);
    expect(c.peek()).toBe(RightParenToken);
  });

  it('restores the cursor when its first component does not match', () => {
    const empty = new TokenCursor(parseListOfComponentValues('', {}), {});
    const invalid = new TokenCursor(parseListOfComponentValues(') a', {}), {});

    expect(AnyValue.consume(empty)).toBeNull();
    expect(empty.pos()).toBe(0);
    expect(AnyValue.consume(invalid)).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('accepts empty nested block contents', () => {
    expect(AnyValue.parse('fn()', {})).not.toBeNull();
    expect(AnyValue.parse('[]', {})).not.toBeNull();
  });

  it('rejects an empty production', () => {
    expect(AnyValue.parse('', {})).toBeNull();
  });

  it('rejects bad tokens recursively', () => {
    expect(AnyValue.parse('"x\ny"', {})).toBeNull();
    expect(AnyValue.parse('fn("x\ny")', {})).toBeNull();
    expect(AnyValue.parse('url(foo"bar)', {})).toBeNull();
    expect(AnyValue.parse('fn(url(foo"bar))', {})).toBeNull();
  });

  it('rejects unmatched closing tokens recursively', () => {
    expect(AnyValue.parse(')', {})).toBeNull();
    expect(AnyValue.parse(']', {})).toBeNull();
    expect(AnyValue.parse('}', {})).toBeNull();
    expect(AnyValue.parse('fn(])', {})).toBeNull();
    expect(AnyValue.parse('[)]', {})).toBeNull();
  });
});
