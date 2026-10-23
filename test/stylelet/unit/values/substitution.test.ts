import { describe, expect, it, vi } from 'vitest';

import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { serializeComponentValues } from '../../../../src/stylelet/syntax/component-value';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { GuaranteedInvalidValue, guaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { SubstitutionValue } from '../../../../src/stylelet/values/substitution-value';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';
import { ColorValue } from '../../../../src/stylelet/values/color';
import { LengthValue } from '../../../../src/stylelet/values/length';
import { InterpretedDeclaration } from '../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import { TokenList } from '../../../../src/stylelet/syntax/token-list';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';

describe('arbitrary substitution', () => {
  it('finishes substitution and argument parsing before reading any source text', () => {
    const original = OptionalDeclarationValue.parse('calc(var(...var(--args), var(--tail)))', {})!;
    const values = new Map([
      ['--args', OptionalDeclarationValue.parse('--missing, 01.00e+0', {})!],
      ['--tail', OptionalDeclarationValue.parse('02px', {})!],
    ]);
    const read = vi.spyOn(TokenList.prototype, 'sourceText');
    try {
      const result = new SubstitutionValue(original).substitute((name) => values.get(name) ?? guaranteedInvalidValue);
      if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
      expect(OptionalDeclarationValue.parse(result, {})).not.toBeNull();
      expect(read).not.toHaveBeenCalled();
      expect(result.sourceText()).toBe('calc(01.00e+0, 02px)');
      expect(original.repr.sourceText()).toBe('calc(var(...var(--args), var(--tail)))');
    } finally {
      read.mockRestore();
    }
  });

  it.each(['var()', 'var(, red)', 'var({})', 'var(--x, {red} extra)', 'fn(var())'])(
    'rejects malformed var arguments in custom and ordinary declarations: %s', (input) => {
      expect(InterpretedDeclaration.parse('--x', input, false, {})).toBeNull();
      expect(WholeValue.parse(input, {}, ColorValue.parse)).toBeNull();
    },
  );

  it.each([
    ['var(var(--name))', '01.00e+0EM'],
    ['var({--value})', '01.00e+0EM'],
    ['var(not-a-custom-name, fallback)', 'fallback'],
    ['var(--, fallback)', 'fallback'],
    ['var(--absent, red, blue)', 'red, blue'],
    ['var(--absent, {red, blue})', 'red, blue'],
    ['var(--absent, {{red, blue}})', '{red, blue}'],
    ['var(--absent,)', ''],
    ['var(--absent,/*only*/)', '/*only*/'],
    ['var(--absent,{/*only*/})', '/*only*/'],
    ['var(--empty, fallback)', ''],
    ['var(--value, var(--unused))', '01.00e+0EM'],
    ['var(--value, var(...var(--unused)))', '01.00e+0EM'],
    ['calc(var(--value) * 2) [var(--name)]', 'calc(01.00e+0EM * 2) [--value]'],
    ['fn(var(--empty)/**/x)', 'fn(/**/x)'],
    ['fn(x/**/var(--empty))', 'fn(x/**/)'],
    ['var(--absent, {fn(...var(--empty)/**/var(--value))})', 'fn(/**/01.00e+0EM)'],
    ['var(--value)px', '01.00e+0EM/**/px'],
    ['var(--number)var(--unit)/**/tail', '01.00e+0/**/EM/**/tail'],
    ['one/**/var(--empty)two', 'one/**/two'],
    ['one var(--empty)two', 'one two'],
    ['var(--empty)var(--empty)/**/one', '/**/one'],
    ['one/**/var(--empty)var(--empty)', 'one/**/'],
    ['var(--empty)/* keep */var(--empty)', '/* keep */'],
    ['one/**/var(--empty)var(--empty)/**/two', 'one/**//**/two'],
    ['var(--number)var(--empty)var(--unit)', '01.00e+0/**/EM'],
    ['fn(var(--empty)var(--empty)/**/)', 'fn(/**/)'],
    ['c\\61 lc(/**/var(--number)/**/)', 'c\\61 lc(/**/01.00e+0/**/)'],
    ['var(...var(--args))', 'green'],
    ['var(...var(--args), blue)', 'green, blue'],
    ['var(...var(--commented-args))', '/**/green/**/'],
    ['var(...var(--comment-only-args))', '/*only*/'],
    ['var(...var(--spaced-comment-only-args))', '/*only*/'],
    ['var(...var(--comment-only-args)/*outer*/)', '/*only*//*outer*/'],
    ['var(...var(--comment-only-args), blue)', '/*only*/, blue'],
    ['var(...var(--name))', '01.00e+0EM'],
    ['...var(--name)', '...--value'],
    ['var(... var(--args), not-spread)', 'not-spread'],
    ['var(. . .var(--args), not-spread)', 'not-spread'],
  ])('substitutes %s as %s', (input, expected) => {
    const values: Record<string, string> = {
      '--name': '--value', '--value': '01.00e+0EM', '--number': '01.00e+0', '--unit': 'EM',
      '--args': '--absent, green', '--empty': '',
      '--commented-args': '--absent,/**/green/**/',
      '--comment-only-args': '--absent,/*only*/',
      '--spaced-comment-only-args': '--absent, /*only*/ ',
    };
    const queried: string[] = [];
    const value = OptionalDeclarationValue.parse(input, {})!;
    expect(SubstitutionValue.hasValidVarArguments(value.repr)).toBe(true);
    const result = new SubstitutionValue(value).substitute((name) => {
      queried.push(name);
      return Object.hasOwn(values, name) ? OptionalDeclarationValue.parse(values[name]!, {})! : guaranteedInvalidValue;
    });

    expect(result).not.toBeInstanceOf(GuaranteedInvalidValue);
    if (result instanceof GuaranteedInvalidValue) return;
    expect(result.sourceText()).toBe(expected);
    expect(value.repr.sourceText()).toBe(input);
    expect(queried).not.toContain('--unused');
    // Reparse only in the test: serialization must keep the same token boundaries.
    expect(serializeComponentValues(parseListOfComponentValues(result.sourceText(), {}).tokens))
      .toBe(serializeComponentValues(result.tokens));
  });

  it('evaluates spread functions even in an unused fallback, before argument selection', () => {
    const value = OptionalDeclarationValue.parse('var(--present, fn(...var(--early)))', {})!;
    const queried: string[] = [];
    const result = new SubstitutionValue(value).substitute((name) => {
      queried.push(name);
      return name === '--present' ? OptionalDeclarationValue.parse('yes', {})! : guaranteedInvalidValue;
    });

    expect(result).toBe(guaranteedInvalidValue);
    expect(queried).toEqual(['--early']);
  });

  it('continues visiting references after an earlier replacement fails', () => {
    const value = OptionalDeclarationValue.parse('var(--missing) fn(var(--later))', {})!;
    const queried: string[] = [];
    const result = new SubstitutionValue(value).substitute((name) => {
      queried.push(name);
      return guaranteedInvalidValue;
    });

    expect(result).toBe(guaranteedInvalidValue);
    expect(queried).toEqual(['--missing', '--later']);
  });

  it('keeps source and list identity when there is nothing to substitute', () => {
    const value = OptionalDeclarationValue.parse('foo\\62 ar(01.00e+0EM)', {})!;
    expect(new SubstitutionValue(value).substitute(() => guaranteedInvalidValue)).toBe(value.repr);
  });

  it('keeps replacements separate across computations of the same declaration', () => {
    const original = OptionalDeclarationValue.parse('calc(var(--x) + var(--x))', {})!;
    const value = new SubstitutionValue(original);
    const first = value.substitute(() => OptionalDeclarationValue.parse('01px', {})!);
    const second = value.substitute(() => OptionalDeclarationValue.parse('2em', {})!);
    if (first instanceof GuaranteedInvalidValue || second instanceof GuaranteedInvalidValue) throw new Error('Expected substitutions');

    expect(first.sourceText()).toBe('calc(01px + 01px)');
    expect(second.sourceText()).toBe('calc(2em + 2em)');
    expect(original.repr.sourceText()).toBe('calc(var(--x) + var(--x))');
  });

  it.each([
    ['--absent,/**/var(--value)/**/', 'green', '/**/green/**/'],
    ['--absent, /*only*/ var(--value)', '', '/*only*/'],
  ])('retains comments when a spread fallback comes from computed %s', (input, value, expected) => {
    const original = InterpretedDeclaration.parseBlock(`--args: ${input};`, {})[0]!;
    if (!original.custom) throw new Error('Expected a custom declaration');
    const computed = original.value.resolve(ValueStage.Computed, {
      getCustomProperty: () => OptionalDeclarationValue.parse(value, {})!,
    }).ordinaryValue();
    const result = new SubstitutionValue(OptionalDeclarationValue.parse('var(...var(--args))', {})!)
      .substitute((name) => name === '--args' ? computed : guaranteedInvalidValue);
    if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
    expect(result.sourceText()).toBe(expected);
  });

  it.each([
    ['calc(1px/**/var(--missing, /*before*/ + 2px))', 'calc(1px/**//*before*/+ 2px)', false],
    ['calc(1px/**/var(--missing, { /*before*/ + 2px}))', 'calc(1px/**//*before*/+ 2px)', false],
    ['calc(1px/**/var(...var(--args)))', 'calc(1px/**//*before*/+ 2px)', false],
    ['calc(1px/**/var(--missing, /* before */ /* after */ + 2px))', 'calc(1px/**//* before *//* after */+ 2px)', false],
    ['calc(1px var(--missing, /*before*/ + 2px))', 'calc(1px /*before*/+ 2px)', true],
  ])('keeps fallback meaning when retained source is reparsed: %s', (input, text, valid) => {
    const args = new SubstitutionValue(OptionalDeclarationValue.parse('--missing, /*before*/ var(--empty) + 2px', {})!)
      .substitute(() => OptionalDeclarationValue.parse('', {})!);
    if (args instanceof GuaranteedInvalidValue) throw new Error('Expected computed arguments');
    const computedArgs = OptionalDeclarationValue.parse(args, {})!;
    const result = new SubstitutionValue(OptionalDeclarationValue.parse(input, {})!)
      .substitute((name) => name === '--args' ? computedArgs : guaranteedInvalidValue);
    if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');

    expect(result.sourceText()).toBe(text);
    expect(LengthValue.parse(result, {}) !== null).toBe(valid);
    expect(LengthValue.parse(result.sourceText(), {}) !== null).toBe(valid);
  });

  it('preserves declared spelling without restoring trimmed whitespace in its replacement', () => {
    const declaration = InterpretedDeclaration.parseBlock('--term: /*before*/ + 2px;', {})[0]!;
    if (!declaration.custom) throw new Error('Expected a custom declaration');
    const value = declaration.value.resolve(ValueStage.Computed, {}).ordinaryValue();
    const result = new SubstitutionValue(OptionalDeclarationValue.parse('calc(1px/**/var(--term))', {})!)
      .substitute(() => value);
    if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');

    expect(declaration.serializeValue()).toBe('/*before*/ + 2px');
    expect(result.sourceText()).toBe('calc(1px/**//*before*/+ 2px)');
    expect(LengthValue.parse(result, {})).toBeNull();
    expect(LengthValue.parse(result.sourceText(), {})).toBeNull();
  });

  it('invalidates computed source text when a derived list changes', () => {
    const value = new SubstitutionValue(OptionalDeclarationValue.parse('var(--x)', {})!);
    const result = value.substitute(() => OptionalDeclarationValue.parse('01px', {})!);
    if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');

    const list = result.slice(0);
    expect(list.sourceText()).toBe('01px');
    list.truncate(0);
    expect(list.sourceText()).toBe('');
    list.append(result.sourceTokens[0]!, result, 0, 1);
    expect(list.sourceText()).toBe('01px');
    expect(result.sourceText()).toBe('01px');
  });

  it('bounds counting and rendering work for repeatedly shared empty replacements', () => {
    const reference = new SubstitutionValue(OptionalDeclarationValue.parse('var(--previous)var(--previous)', {})!);
    let previous = OptionalDeclarationValue.parse('', {})!;
    const lists = [previous.repr];
    for (let i = 0; i < 12; i++) {
      const result = reference.substitute(() => previous);
      if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
      previous = OptionalDeclarationValue.parse(result, {})!;
      lists.push(previous.repr);
    }

    // Measure traversal rather than elapsed time. The completed lists are shared,
    // so thirteen lists must not require walking thousands of duplicate references.
    let sourceReads = 0;
    for (const list of lists) {
      const tokens = list.sourceTokens;
      Object.defineProperty(list, 'sourceTokens', {
        get() {
          sourceReads++;
          return tokens;
        },
      });
    }
    const result = reference.substitute(() => previous);
    if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
    expect(result.tokens).toEqual([]);
    expect(sourceReads).toBeLessThan(1000);

    sourceReads = 0;
    expect(result.sourceText()).toBe('');
    expect(sourceReads).toBeLessThan(1000);
    sourceReads = 0;
    expect(result.sourceText()).toBe('');
    expect(sourceReads).toBe(0);
  });

  it('counts every occurrence of a shared replacement toward the expansion limit', () => {
    const reference = new SubstitutionValue(OptionalDeclarationValue.parse('var(--previous)var(--previous)', {})!);
    let previous = OptionalDeclarationValue.parse('token', {})!;
    for (let i = 0; i < 16; i++) {
      const result = reference.substitute(() => previous);
      if (result instanceof GuaranteedInvalidValue) throw new Error('Expected substitution');
      previous = OptionalDeclarationValue.parse(result, {})!;
    }

    expect(previous.repr.tokens).toHaveLength(65536);
    expect(reference.substitute(() => previous)).toBe(guaranteedInvalidValue);
  });

  it.each(['attr(data-x)', 'env(safe-area-inset-top)', 'if(else: red)', 'inherit(--x)', 'ident(foo)', 'random-item(red, blue)', '--fn()'])(
    'keeps the unfinished function dependency explicit: %s', (input) => {
      const value = OptionalDeclarationValue.parse(input, {})!;
      expect(SubstitutionValue.containsFunction(value.repr)).toBe(true);
      expect(() => new SubstitutionValue(value).substitute(() => guaranteedInvalidValue))
        .toThrow('is not implemented');
    },
  );
});
