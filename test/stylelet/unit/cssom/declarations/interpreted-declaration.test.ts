import { describe, expect, expectTypeOf, it } from 'vitest';

import { InterpretedDeclaration } from '../../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import { propertyRegistry, type PropertyValue } from '../../../../../src/stylelet/props/registry';
import type { OptionalDeclarationValue } from '../../../../../src/stylelet/values/declaration-value';
import { NumberLiteral } from '../../../../../src/stylelet/values/numeric-literal/number';
import { WholeValue } from '../../../../../src/stylelet/values/whole-value';
import { ValueStage } from '../../../../../src/stylelet/value-processing/stage';

describe('interpreted declarations', () => {
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
