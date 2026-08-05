import { ComponentCursor } from '../../../../src/stylelet/syntax/component-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import {
  consumeSyntax, parseSyntax,
  type SyntaxValue,
} from '../../../../src/stylelet/values/syntax-value';
import { describe, expect, it } from 'vitest';

const lengthSyntax: SyntaxValue = {
  type: 'syntax-definition',
  components: [{ type: 'syntax-type', name: 'length' }],
};

describe('<syntax>', () => {
  it('parses the universal syntax definition', () => {
    expect(parseSyntax('*')).toEqual({ type: 'universal-syntax' });
  });

  it('distinguishes syntax types from keyword components', () => {
    expect(parseSyntax('<length> | length')).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'length' },
        { type: 'syntax-keyword', name: 'length' },
      ],
    });
  });

  it('preserves the specified order of alternatives', () => {
    expect(parseSyntax('<percentage> | <number> | auto')).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'percentage' },
        { type: 'syntax-type', name: 'number' },
        { type: 'syntax-keyword', name: 'auto' },
      ],
    });
  });

  it('parses syntax multipliers without intervening whitespace', () => {
    expect(parseSyntax('<length>+ | auto#')).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'length', multiplier: '+' },
        { type: 'syntax-keyword', name: 'auto', multiplier: '#' },
      ],
    });
  });

  it('preserves the pre-multiplied transform-list type', () => {
    expect(parseSyntax('<transform-list>')).toEqual({
      type: 'syntax-definition',
      components: [{
        type: 'syntax-type',
        name: 'transform-list',
      }],
    });
  });

  it('preserves syntax keyword case and accepts dashed custom identifiers', () => {
    expect(parseSyntax('Foo | --bar')).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-keyword', name: 'Foo' },
        { type: 'syntax-keyword', name: '--bar' },
      ],
    });
  });

  it('normalizes the historical string form to the same value', () => {
    expect(parseSyntax('"<length> | auto"')).toEqual(
      parseSyntax('<length> | auto'),
    );
  });

  it('accepts insignificant outer and combinator whitespace', () => {
    expect(parseSyntax('  <length>|auto  ')).toEqual({
      type: 'syntax-definition',
      components: [
        { type: 'syntax-type', name: 'length' },
        { type: 'syntax-keyword', name: 'auto' },
      ],
    });
  });

  it('matches type names as CSS identifiers', () => {
    expect(parseSyntax('<\\6c ength>')).toEqual(lengthSyntax);
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
    expect(parseSyntax(input)).toBeNull();
  });

  it('consumes one syntax value without consuming following input', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('<length> trailing'),
    );

    expect(consumeSyntax(c)).toEqual(lengthSyntax);
    expect(c.peek()).toMatchObject({
      type: 'token',
      kind: TokenKind.Whitespace,
    });
  });

  it('restores the cursor when the syntax does not match', () => {
    const c = new ComponentCursor(
      parseListOfComponentValues('<length >'),
    );

    expect(consumeSyntax(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
