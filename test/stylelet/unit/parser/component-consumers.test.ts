import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import { createDelimConsumer, createFunctionalNotationConsumer } from '../../../../src/stylelet/parser/component-consumers';
import { ok } from '../../../../src/stylelet/parser/component-try-consumer';
import { BlockKind, parseListOfComponentValues } from '../../../../src/stylelet/parser/syntax';
import { BadStringToken } from '../../../../src/stylelet/parser/tokens';

describe('createFunctionalNotationConsumer', () => {
  it('commits by default when the matched function has invalid components', () => {
    const c = new ComponentCursor([{
      block: BlockKind.Function,
      name: 'fn',
      value: [BadStringToken],
    }]);
    const consume = createFunctionalNotationConsumer(
      'fn',
      (arguments_) => ok(arguments_.next()),
      (value) => value,
    );

    expect(consume(c)).toMatchObject({ kind: 'bad', reason: 'invalid' });
    expect(c.pos()).toBe(1);
  });

  it('can delegate invalid-component handling to the argument consumer', () => {
    const c = new ComponentCursor([{
      block: BlockKind.Function,
      name: 'fn',
      value: [BadStringToken],
    }]);
    const consume = createFunctionalNotationConsumer(
      'fn',
      (arguments_) => ok(arguments_.next()),
      (value) => value,
      { invalidArgumentComponents: 'delegate' },
    );

    expect(consume(c)).toEqual({ kind: 'ok', value: BadStringToken });
    expect(c.pos()).toBe(1);
  });

  it('commits by default when the arguments do not match their grammar', () => {
    const c = new ComponentCursor(parseListOfComponentValues('fn(other)'));
    const consume = createFunctionalNotationConsumer(
      'fn',
      createDelimConsumer('/'),
      (value) => value,
    );

    expect(consume(c)).toMatchObject({ kind: 'bad', reason: 'invalid' });
    expect(c.pos()).toBe(1);
  });

  it('can delegate an argument-grammar mismatch to the outer caller', () => {
    const c = new ComponentCursor(parseListOfComponentValues('fn(other)'));
    const consume = createFunctionalNotationConsumer(
      'fn',
      createDelimConsumer('/'),
      (value) => value,
      { argumentGrammarMismatch: 'delegate' },
    );

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
