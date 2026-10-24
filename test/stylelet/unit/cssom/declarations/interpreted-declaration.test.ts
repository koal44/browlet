import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { InterpretedDeclaration } from '../../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import { builtInRegistry, type BuiltInPropertyValue } from '../../../../../src/stylelet/props/registry';
import { CustomProperty, type CustomPropertyValue } from '../../../../../src/stylelet/props/custom-property';
import { OptionalDeclarationValue } from '../../../../../src/stylelet/values/declaration-value';
import { NumberLiteral } from '../../../../../src/stylelet/values/numeric-literal/number';
import { WholeValue } from '../../../../../src/stylelet/values/whole-value';
import { ValueStage } from '../../../../../src/stylelet/value-processing/stage';

describe('interpreted declarations', () => {
  it('retains distinct named property records when expanding a shorthand', () => {
    const declarations = InterpretedDeclaration.parseBlock('margin: 1px 2px', {});
    const records = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const;
    expect(new Set(declarations.map(({ property }) => property)).size).toBe(4);
    for (const [index, name] of records.entries()) {
      expect(declarations[index]!.property).toBe(builtInRegistry[name]);
      expect(declarations[index]!.name).toBe(name);
    }
  });

  it('retains resolvable ordinary and pending shorthand whole values', () => {
    const context = {
      length: { em: 16 },
      getCustomProperty: () => OptionalDeclarationValue.parse('2em', {})!,
    };
    const declarations = InterpretedDeclaration.parseBlock('margin-left: var(--gap); margin: var(--gap) 3em 4em 5em', {});

    expect(declarations[1]!.value.resolve(ValueStage.Specified, {})).toBe(declarations[1]!.value);
    expect(declarations.map((declaration) => declaration.value.resolve(ValueStage.Computed, context).serialize()))
      .toEqual(['32px', '32px', '48px', '64px', '80px']);
    expect(declarations[0]!.serializeValue()).toBe('var(--gap)');
    expect(declarations[1]!.serializeValue()).toBe('');
  });

  it('reparses a pending shorthand with the computation context', () => {
    const context = {
      numericVariables: new Map([['step', { valueType: 'number' as const, value: new NumberLiteral(1) }]]),
    };
    const [declaration] = InterpretedDeclaration.parseBlock('margin: var(--gap)', context);
    const computed = declaration!.value.resolve(ValueStage.Computed, {
      numericVariables: new Map([['step', { valueType: 'number' as const, value: new NumberLiteral(3) }]]),
      getCustomProperty: () => OptionalDeclarationValue.parse('calc(step * 1px)', {})!,
    });
    expect(computed.serialize()).toBe('3px');
  });

  it('caches declared text without changing it when the whole value resolves', () => {
    const [declared] = InterpretedDeclaration.parseBlock('margin-left: 2em', {});
    const serialize = vi.spyOn(declared!.value, 'serialize');
    expect(serialize).not.toHaveBeenCalled();
    expect(declared!.serializeValue()).toBe('2em');
    expect(declared!.serialize()).toBe('margin-left: 2em;');
    expect(serialize).toHaveBeenCalledOnce();
    expect(declared!.value.resolve(ValueStage.Computed, { length: { em: 16 } }).serialize()).toBe('32px');
    expect(declared!.serializeValue()).toBe('2em');
  });

  it('caches custom-property spelling without reconstructing its tokens', () => {
    const components = OptionalDeclarationValue.parse('A/**/B foo\\62 ar', {})!;
    const property = new CustomProperty('--accent');
    const value = property.parse(components.repr, {})!;
    const declaration = new InterpretedDeclaration(property, value);
    const sourceText = vi.spyOn(components.repr, 'sourceText');
    expect(sourceText).not.toHaveBeenCalled();
    expect(declaration.serializeValue()).toBe('A/**/B foo\\62 ar');
    expect(declaration.serialize()).toBe('--accent: A/**/B foo\\62 ar;');
    expect(sourceText).toHaveBeenCalledOnce();
  });

  it('carries property context from declaration parsing into the declared value', () => {
    const context = {
      numericVariables: new Map([['progress', {
        valueType: 'number' as const,
        value: new NumberLiteral(0.5),
      }]]),
    };
    const declarations = InterpretedDeclaration.parseBlock('opacity: calc(progress)', context);

    expect(declarations).toMatchObject([{ name: 'opacity', custom: false }]);
    expect(declarations[0]).toBeInstanceOf(InterpretedDeclaration);
    expect(declarations[0]?.value).toBeInstanceOf(WholeValue);
    expect(InterpretedDeclaration.parseBlock('opacity: calc(progress)', {})).toEqual([]);
  });

  it('keeps declarations unchanged when their whole values resolve', () => {
    const declarations = InterpretedDeclaration.parseBlock(
      'color: red !important; opacity: 150%; margin-left: 2em; --Accent: 10px', {},
    );
    const computed = declarations.map((declaration) =>
      declaration.value.resolve(ValueStage.Computed, { length: { em: 16 } })
    );

    expect(computed.map((value) => value.serialize())).toEqual(['rgb(255, 0, 0)', '1', '32px', '10px']);
    expect(declarations.map((declaration) => declaration.serialize())).toEqual([
      'color: red !important;', 'opacity: 1.5;', 'margin-left: 2em;', '--Accent: 10px;',
    ]);
    expect(declarations[2]!.value.resolve(ValueStage.Computed, { length: { em: 24 } }).serialize()).toBe('48px');
    expect(computed.every((value) => value instanceof WholeValue)).toBe(true);
  });

  it('keeps value text separate from declaration syntax and preserves custom-property spelling', () => {
    const [declaration] = InterpretedDeclaration.parse('--x:y', ' A/**/B foo\\62 ar ', true, {})!;
    expect(declaration!.serializeValue()).toBe('A/**/B foo\\62 ar');
    expect(declaration!.serialize()).toBe('--x\\:y: A/**/B foo\\62 ar !important;');
    const [reparsed] = InterpretedDeclaration.parseBlock(declaration!.serialize(), {});
    expect(reparsed!.name).toBe('--x:y');
    expect(reparsed!.serializeValue()).toBe('A/**/B foo\\62 ar');

    const [empty] = InterpretedDeclaration.parse('--empty', ' \t ', true, {})!;
    expect(empty!.serializeValue()).toBe(' ');
    expect(empty!.serialize()).toBe('--empty:  !important;');
    expect(InterpretedDeclaration.parse('color', 'red !important', false, {})).toBeNull();
    expect(InterpretedDeclaration.parse('color', 'red; opacity: .5', false, {})).toBeNull();
  });

  it('retains the value directly and preserves name/value typing through construction and narrowing', () => {
    const value = builtInRegistry.color.parse('red', {})!;
    const color = new InterpretedDeclaration(builtInRegistry.color, value);
    expect(color.property).toBe(builtInRegistry.color);
    expect(color.value).toBe(value);
    expectTypeOf(color.value).toEqualTypeOf<BuiltInPropertyValue<'color'>>();
    expectTypeOf(color.property).toEqualTypeOf<typeof builtInRegistry.color>();
    expectTypeOf(() => {
      // @ts-expect-error A color declaration cannot hold an opacity whole value.
      new InterpretedDeclaration(builtInRegistry.color, builtInRegistry.opacity.initialValue);
    }).toBeFunction();

    for (const declaration of InterpretedDeclaration.parseBlock('color: red; --accent: blue; opacity: .5', {})) {
      if (declaration.custom) {
        expectTypeOf(declaration.name).toEqualTypeOf<`--${string}`>();
        expectTypeOf(declaration.value).toEqualTypeOf<CustomPropertyValue>();
      } else if (declaration.name === 'color') {
        expectTypeOf(declaration.value).toEqualTypeOf<BuiltInPropertyValue<'color'>>();
      } else if (declaration.name === 'opacity') {
        expectTypeOf(declaration.value).toEqualTypeOf<BuiltInPropertyValue<'opacity'>>();
      }
    }
  });
});
