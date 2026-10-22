import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { InterpretedDeclaration } from '../../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import { propertyRegistry, type PropertyValue } from '../../../../../src/stylelet/props/registry';
import { OptionalDeclarationValue } from '../../../../../src/stylelet/values/declaration-value';
import { NumberLiteral } from '../../../../../src/stylelet/values/numeric-literal/number';
import { WholeValue } from '../../../../../src/stylelet/values/whole-value';
import { ValueStage } from '../../../../../src/stylelet/value-processing/stage';

describe('interpreted declarations', () => {
  it('resolves ordinary and pending shorthand values through the shared context', () => {
    const context = {
      length: { em: 16 },
      getCustomProperty: () => OptionalDeclarationValue.parse('2em', {})!,
    };
    const declarations = InterpretedDeclaration.parseBlock('margin-left: var(--gap); margin: var(--gap)', {});

    expect(declarations.map((declaration) => declaration.resolve(ValueStage.Computed, context).serializeValue()))
      .toEqual(['32px', '32px', '32px', '32px', '32px']);
    expect(declarations[0]!.serializeValue()).toBe('var(--gap)');
  });

  it('serializes a retained value lazily once, with a separate cache after resolution', () => {
    const [declared] = InterpretedDeclaration.parseBlock('margin-left: 2em', {});
    const serialize = vi.spyOn(declared!.value, 'serialize');
    expect(serialize).not.toHaveBeenCalled();
    expect(declared!.serializeValue()).toBe('2em');
    expect(declared!.serialize()).toBe('margin-left: 2em;');
    expect(serialize).toHaveBeenCalledOnce();
    expect(declared!.resolve(ValueStage.Computed, { length: { em: 16 } }).serializeValue()).toBe('32px');
    expect(declared!.serializeValue()).toBe('2em');
  });

  it('caches custom-property spelling without reconstructing its tokens', () => {
    const value = OptionalDeclarationValue.parse('A/**/B foo\\62 ar', {})!;
    const declaration = new InterpretedDeclaration('--accent', value);
    const sourceText = vi.spyOn(value.value, 'sourceText');
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

  it('lets each declaration value resolve and serialize itself', () => {
    const declarations = InterpretedDeclaration.parseBlock(
      'color: red !important; opacity: 150%; margin-left: 2em; --Accent: 10px', {},
    );
    const computed = declarations.map((declaration) =>
      declaration.resolve(ValueStage.Computed, { length: { em: 16 } })
    );

    expect(computed.map((declaration) => declaration.serialize())).toEqual([
      'color: rgb(255, 0, 0) !important;',
      'opacity: 1;',
      'margin-left: 32px;',
      '--Accent: 10px;',
    ]);
    expect(declarations.map((declaration) => declaration.serialize())).toEqual([
      'color: red !important;', 'opacity: 1.5;', 'margin-left: 2em;', '--Accent: 10px;',
    ]);
    expect(declarations[2]!.resolve(ValueStage.Computed, { length: { em: 24 } }).serializeValue()).toBe('48px');
    expect(computed.every((declaration) => declaration instanceof InterpretedDeclaration)).toBe(true);
  });

  it('keeps value text separate from declaration syntax and preserves custom-property spelling', () => {
    const [declaration] = InterpretedDeclaration.parse('--x:y', ' A/**/B foo\\62 ar ', true, {})!;
    expect(declaration!.serializeValue()).toBe('A/**/B foo\\62 ar');
    expect(declaration!.serialize()).toBe('--x\\:y: A/**/B foo\\62 ar !important;');
    expect(declaration!.resolve(ValueStage.Specified, {}).serialize()).toBe(declaration!.serialize());
    const [reparsed] = InterpretedDeclaration.parseBlock(declaration!.serialize(), {});
    expect(reparsed!.name).toBe('--x:y');
    expect(reparsed!.serializeValue()).toBe('A/**/B foo\\62 ar');

    const [empty] = InterpretedDeclaration.parse('--empty', ' \t ', true, {})!;
    expect(empty!.serializeValue()).toBe(' ');
    expect(empty!.serialize()).toBe('--empty:  !important;');
    expect(InterpretedDeclaration.parse('color', 'red !important', false, {})).toBeNull();
    expect(InterpretedDeclaration.parse('color', 'red; opacity: .5', false, {})).toBeNull();
  });

  it('retains the value directly and preserves name/value typing through construction, narrowing, and resolution', () => {
    const value = propertyRegistry.color.parse('red', {})!;
    const color = new InterpretedDeclaration('color', value);
    expect(color.value).toBe(value);
    expectTypeOf(color.value).toEqualTypeOf<PropertyValue<'color'>>();
    expectTypeOf(color.resolve(ValueStage.Computed, {}).value).toEqualTypeOf<PropertyValue<'color'>>();
    expectTypeOf<typeof InterpretedDeclaration<'color'>>().constructorParameters.toEqualTypeOf<[
      name: 'color', value: PropertyValue<'color'>, important?: boolean,
    ]>();

    for (const declaration of InterpretedDeclaration.parseBlock('color: red; --accent: blue; opacity: .5', {})) {
      if (declaration.custom) {
        expectTypeOf(declaration.name).toEqualTypeOf<`--${string}`>();
        expectTypeOf(declaration.value).toEqualTypeOf<OptionalDeclarationValue>();
      } else if (declaration.name === 'color') {
        expectTypeOf(declaration.value).toEqualTypeOf<PropertyValue<'color'>>();
      } else if (declaration.name === 'opacity') {
        expectTypeOf(declaration.value).toEqualTypeOf<PropertyValue<'opacity'>>();
      }
    }
  });
});
