import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { identToken, TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { IdentValue } from '../../../../src/stylelet/values/ident';
import { UrlModifierValue } from '../../../../src/stylelet/values/url-modifier';

describe('url-modifier', () => {
  it('parses an identifier modifier through its value grammar', () => {
    expect(UrlModifierValue.parse('cross-origin', {})?.value).toEqual(new IdentValue('cross-origin'));
  });

  it('parses unknown functional notation as a function block', () => {
    const modifier = UrlModifierValue.parse('future-modifier(value)', {})!.value;

    expect(modifier).toMatchObject({
      type: TokenKind.FunctionBlock,
      name: 'future-modifier',
    });
    if (!(modifier instanceof IdentValue) && modifier.type === TokenKind.FunctionBlock) {
      expect(modifier.value.tokens).toEqual([identToken('value')]);
      expect(modifier.value.sourceText()).toBe('value');
    }
  });

  it.each([
    [
      'cross-origin(anonymous)',
      { type: 'cross-origin-modifier', value: 'anonymous' },
    ],
    [
      'integrity("sha256-test")',
      { type: 'integrity-modifier', value: 'sha256-test' },
    ],
    [
      'referrer-policy(strict-origin)',
      { type: 'referrer-policy-modifier', value: 'strict-origin' },
    ],
  ])('parses the recognized request modifier %j', (input, expected) => {
    expect(UrlModifierValue.parse(input, {})?.value).toEqual(expected);
  });

  it.each([
    [
      'cross-origin(use-credentials)',
      'cross-origin(use-credentials)',
    ],
    [
      String.raw`integrity("sha\22 256")`,
      String.raw`integrity("sha\"256")`,
    ],
    [
      'REFERRER-POLICY(STRICT-ORIGIN)',
      'referrer-policy(strict-origin)',
    ],
  ])('serializes the request modifier %j', (input, expected) => {
    expect(UrlModifierValue.parse(input, {})!.serialize()).toBe(expected);
  });

  it.each([
    'cross-origin(unknown)',
    'CROSS-ORIGIN(unknown)',
    'integrity(unknown)',
    'integrity("sha256-test" extra)',
    'referrer-policy(unknown)',
  ])('rejects the malformed recognized request modifier %j', (input) => {
    expect(UrlModifierValue.parse(input, {})).toBeNull();
  });

  it('commits after recognizing a request modifier with invalid arguments', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('cross-origin(unknown)', {}), {},
    );

    expect(UrlModifierValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('rejects unknown functional notation containing a bad token', () => {
    const list = parseListOfComponentValues('future-modifier("bad\n)', {});

    expect(UrlModifierValue.parse(list, {})).toBeNull();

    const c = new TokenCursor(list, {});
    expect(UrlModifierValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('consumes a URL modifier through the component grammar', () => {
    const c = new TokenCursor(parseListOfComponentValues('future-modifier()', {}), {});
    const modifier = UrlModifierValue.consume(c)!.value;

    expect(modifier).toMatchObject({
      type: TokenKind.FunctionBlock,
      name: 'future-modifier',
    });
    if (!(modifier instanceof IdentValue) && modifier.type === TokenKind.FunctionBlock) {
      expect(modifier.value.tokens).toEqual([]);
      expect(modifier.value.sourceText()).toBe('');
    }
    expect(c.pos()).toBe(1);
  });

  it('returns null without advancing for anything outside the modifier syntax', () => {
    const c = new TokenCursor(parseListOfComponentValues('1px', {}), {});

    expect(UrlModifierValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
