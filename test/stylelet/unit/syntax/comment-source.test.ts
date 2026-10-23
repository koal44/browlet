import { describe, expect, it } from 'vitest';

import { CSSStyleDeclarationImpl } from '../../../../src/stylelet/cssom/declarations/style-declaration';
import { defaultStyleletEnvironment } from '../../../../src/stylelet/environment';
import { parseDeclaration, parseDeclarationList } from '../../../../src/stylelet/syntax/parser';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { TokenList } from '../../../../src/stylelet/syntax/token-list';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { guaranteedInvalidValue, GuaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { SubstitutionValue } from '../../../../src/stylelet/values/substitution-value';

describe('retained comment boundaries', () => {
  it.each([
    ['--x:/**/red/**/;', '/**/red/**/'],
    ['--x:/*only*/;', '/*only*/'],
    ['--x:/*only*/!important;', '/*only*/'],
    ['--x: /*before*/ red /*after*/ !/**/important /*priority*/;', '/*before*/ red /*after*/'],
    ['--x: /*only*/ ;', '/*only*/'],
    ['--x: /*unfinished ', '/*unfinished '],
    ['--x: \\  ;', '\\ '],
  ])('preserves the value in %s', (input, expected) => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = input;
    expect(style.getPropertyValue('--x')).toBe(expected);
  });

  it('distinguishes comment-only declarations sharing the same input', () => {
    const source = TokenList.tokenize('--first:/*one*/;--second:/*two*/;');
    for (const [position, expected] of [[3, '/*two*/'], [0, '/*one*/'], [3, '/*two*/']] as const) {
      const declaration = parseDeclaration(new TokenCursor(source, {}, { position }), {})!;
      expect(declaration.value.tokens).toEqual([]);
      expect(declaration.value.sourceText()).toBe(expected);
    }
    const declarations = parseDeclarationList('--first:/*one*/;--second:/*two*/;', {});
    expect(declarations.map(({ value }) => value.sourceText())).toEqual(['/*one*/', '/*two*/']);
  });

  it.each(['unrelated', TokenList.tokenize('unrelated')])('does not recover source from an empty builder: %j', (source) => {
    const list = new TokenList(source);
    expect(list.slice(0).sourceText()).toBe('');
  });

  it.each([
    ['var(--absent,/*only*/)', '/*only*/'],
    ['var(--absent,{/*only*/})', '/*only*/'],
    ['var(--absent, /*only*/ )', '/*only*/'],
    ['var(--absent,{ /*only*/ })', '/*only*/'],
    ['var(--absent, /*before*/ green/**/)', '/*before*/green/**/'],
    ['var(...var(--args))', '/**/green/**/'],
    ['var(...var(--empty-args))', '/*only*/'],
    ['var(...var(--spaced-empty-args))', '/*only*/'],
    ['var(...var(--empty-args)/*outer*/)', '/*only*//*outer*/'],
    ['var(...var(--empty-args), blue)', '/*only*/, blue'],
    ['fn(/*before*/var(--empty)/*after*/)', 'fn(/*before*//*after*/)'],
    ['one var(--comment)two', 'one /*only*/two'],
    ['var(--value)two', '/**/green/**/two'],
    ['var(--punct)*', '*//**/*'],
    ['one/**/var(--comment)two', 'one/**//*only*/two'],
    ['one/**/var(--value)/**/two', 'one/**//**/green/**//**/two'],
  ])('preserves comments through %s', (input, expected) => {
    const values: Record<string, string> = {
      '--args': '--absent,/**/green/**/',
      '--empty-args': '--absent,/*only*/',
      '--spaced-empty-args': '--absent, /*only*/ ',
      '--empty': '', '--comment': '/*only*/', '--value': '/**/green/**/', '--punct': '*/',
    };
    const original = OptionalDeclarationValue.parse(input, {})!;
    const result = new SubstitutionValue(original).substitute((name) =>
      Object.hasOwn(values, name) ? OptionalDeclarationValue.parse(values[name]!, {})! : guaranteedInvalidValue,
    );
    if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
    expect(result.sourceText()).toBe(expected);
    expect(original.repr.sourceText()).toBe(input);
  });

  it.each([
    ['--absent,/**/var(--color)/**/', '/**/green/**/'],
    ['--absent,/*left*/ var(--color) /*right*/', '/*left*/green /*right*/'],
    ['--absent, /*left*/ var(--empty) /*right*/ ', '/*left*//*right*/'],
  ])('retains a fallback sliced out of another computed value: %s', (input, expected) => {
    const source = OptionalDeclarationValue.parse(input, {})!;
    const computed = new SubstitutionValue(source).substitute((name) => OptionalDeclarationValue.parse(name === '--color' ? 'green' : '', {})!);
    if (computed instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
    const result = new SubstitutionValue(OptionalDeclarationValue.parse('var(...var(--args))', {})!)
      .substitute((name) => name === '--args' ? OptionalDeclarationValue.parse(computed, {})! : guaranteedInvalidValue);
    if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
    expect(result.sourceText()).toBe(expected);
  });
});
