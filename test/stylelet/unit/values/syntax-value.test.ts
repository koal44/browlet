import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import {
  SyntaxValue,
} from '../../../../src/stylelet/values/syntax-value';
import { describe, expect, it } from 'vitest';

const lengthSyntax = new SyntaxValue({
  type: 'syntax-definition',
  components: [{ type: 'syntax-type', name: 'length' }],
});

describe('<syntax>', () => {
  it('parses the universal syntax definition', () => {
    expect(SyntaxValue.parse('*', {})?.repr).toEqual({ type: 'universal-syntax' });
  });

  it('distinguishes syntax types from keyword components', () => {
    expect(SyntaxValue.parse('<length> | length', {})?.repr).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'length' },
        { type: 'syntax-keyword', name: 'length' },
      ],
    });
  });

  it('preserves the specified order of alternatives', () => {
    expect(SyntaxValue.parse('<percentage> | <number> | auto', {})?.repr).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'percentage' },
        { type: 'syntax-type', name: 'number' },
        { type: 'syntax-keyword', name: 'auto' },
      ],
    });
  });

  it('parses syntax multipliers without intervening whitespace', () => {
    expect(SyntaxValue.parse('<length>+ | auto#', {})?.repr).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'length', multiplier: '+' },
        { type: 'syntax-keyword', name: 'auto', multiplier: '#' },
      ],
    });
  });

  it('preserves the pre-multiplied transform-list type', () => {
    expect(SyntaxValue.parse('<transform-list>', {})?.repr).toEqual({
      type: 'syntax-definition',
      components: [{
        type: 'syntax-type',
        name: 'transform-list',
      }],
    });
  });

  it('preserves syntax keyword case and accepts dashed custom identifiers', () => {
    expect(SyntaxValue.parse('Foo | --bar', {})?.repr).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-keyword', name: 'Foo' },
        { type: 'syntax-keyword', name: '--bar' },
      ],
    });
  });

  it('normalizes the historical string form to the same value', () => {
    expect(SyntaxValue.parse('"<length> | auto"', {})).toEqual(
      SyntaxValue.parse('<length> | auto', {}),
    );
  });

  it('accepts insignificant outer and combinator whitespace', () => {
    expect(SyntaxValue.parse('  <length>|auto  ', {})?.repr).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'length' },
        { type: 'syntax-keyword', name: 'auto' },
      ],
    });
  });

  it('matches type names as CSS identifiers', () => {
    expect(SyntaxValue.parse('<\\6c ength>', {})).toEqual(lengthSyntax);
  });

  it.each([
    '',
    '   ',
    '<unknown>',
    '<LENGTH>',
    '< length>',
    '<length >',
    '<length> +',
    'auto #',
    '<transform-list>+',
    '<transform-list>#',
    '* | auto',
    '| auto',
    'auto |',
    'auto || <length>',
    'auto other',
    '<length>++',
    '"<length> +"',
    'initial',
    'default',
  ])('rejects %j as a complete syntax definition', (input) => {
    expect(SyntaxValue.parse(input, {})).toBeNull();
  });

  it('consumes one syntax value without consuming following input', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('<length> trailing', {}), {},
    );

    expect(SyntaxValue.consume(c)).toEqual(lengthSyntax);
    expect(c.peek()).toMatchObject({
      type: TokenKind.Whitespace,
    });
  });

  it('restores the cursor when the syntax does not match', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('<length >', {}), {},
    );

    expect(SyntaxValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
