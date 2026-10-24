import { describe, expect, it, vi } from 'vitest';

import { CustomProperty } from '../../../../src/stylelet/props/custom-property';
import type { CustomPropertyRegistration } from '../../../../src/stylelet/props/registry';
import { InterpretedDeclaration } from '../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { guaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { SyntaxValue } from '../../../../src/stylelet/values/syntax-value';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';

describe('custom property records', () => {
  it('retains complete values and source spelling through computation', () => {
    const property = new CustomProperty('--accent');
    const text = '/*before*/ r\\65 d/**/ /*after*/';
    const declared = property.parse(text, {})!;
    expect(declared).toBeInstanceOf(WholeValue);
    expect(property.serialize(declared)).toBe(text);
    expect(property.resolve(declared, ValueStage.Specified, {})).toBe(declared);

    const computed = property.resolve(declared, ValueStage.Computed, {});
    expect(computed).toBeInstanceOf(WholeValue);
    expect(property.serialize(computed)).toBe(text);
    expect(property.resolve(computed, ValueStage.Computed, {})).toBe(computed);
    expect(property.serialize(declared)).toBe(text);
  });

  it('supplies the Variables 1 defaults for a case-sensitive name', () => {
    const property = new CustomProperty('--Gap');
    expect(property).toMatchObject({
      name: '--Gap', custom: true, inherits: true, initialValue: { inner: guaranteedInvalidValue },
      animationType: 'discrete', percentages: 'not-applicable',
    });
    expect(property.appliesTo({})).toBe(true);
    expect(property.parse('arbitrary tokens 10px', {})).not.toBeNull();
    expect(property.parse('!important', {})).toBeNull();
    expect(property.parse('var()', {})).toBeNull();
  });

  it('keeps declared spelling while its property substitutes in different contexts', () => {
    const [declaration] = InterpretedDeclaration.parseBlock('--Gap: var(--base)', {});
    if (!declaration?.custom) throw new Error('Expected a custom-property declaration');
    const { property, value } = declaration;
    const first = property.resolve(value, ValueStage.Computed, {
      getCustomProperty: () => OptionalDeclarationValue.parse('A/**/B foo\\62 ar', {})!,
    });
    const second = property.resolve(value, ValueStage.Computed, {
      getCustomProperty: () => OptionalDeclarationValue.parse('20px', {})!,
    });

    expect(property.serialize(first)).toBe('A/**/B foo\\62 ar');
    expect(property.serialize(second)).toBe('20px');
    expect(declaration.serializeValue()).toBe('var(--base)');
  });

  it('requires a computed lookup only when substitution is reached', () => {
    const property = new CustomProperty('--gap');
    const value = property.parse('var(--base)', {})!;
    expect(property.resolve(value, ValueStage.Specified, {})).toBe(value);
    expect(() => property.resolve(value, ValueStage.Computed, {}))
      .toThrow('Property substitution requires computed custom properties');
    const plain = property.parse('10px', {})!;
    const computed = property.resolve(plain, ValueStage.Computed, {});
    expect(computed.ordinaryValue()).toBeInstanceOf(OptionalDeclarationValue);
    expect(property.serialize(computed)).toBe('10px');
  });

  it('distinguishes a failed substitution from a valid empty custom value', () => {
    const property = new CustomProperty('--gap');
    const context = { getCustomProperty: () => guaranteedInvalidValue };
    const invalid = property.resolve(property.parse('var(--missing)', {})!, ValueStage.Computed, context);
    const empty = property.resolve(property.parse('var(--missing,)', {})!, ValueStage.Computed, context);

    expect(invalid.inner).toBe(guaranteedInvalidValue);
    expect(empty.ordinaryValue()).toBeInstanceOf(OptionalDeclarationValue);
    expect(property.serialize(invalid)).toBe('');
    expect(property.serialize(empty)).toBe(' ');
  });

  it('selects current registration at computation, preserving declarations parsed before it', () => {
    const syntax = SyntaxValue.parse('<length>', {})!;
    const parseOrdinary = syntax.createParser();
    const registration: CustomPropertyRegistration = {
      name: '--gap', syntax, inherits: false,
      parse: (input, context) => WholeValue.parse(input, context, parseOrdinary, true),
      initialValue: WholeValue.parse('0px', {}, parseOrdinary, true)!,
    };
    const customPropertyRegistry = new Map<CustomPropertyRegistration['name'], CustomPropertyRegistration>();
    const getRegistration = vi.spyOn(customPropertyRegistry, 'get');
    const context = { customPropertyRegistry };
    const property = new CustomProperty('--gap');
    const value = property.parse('red', context)!;
    expect(getRegistration).not.toHaveBeenCalled();
    expect(property.resolve(value, ValueStage.Specified, context)).toBe(value);
    expect(getRegistration).not.toHaveBeenCalled();
    expect(property.serialize(property.resolve(value, ValueStage.Computed, context))).toBe('red');
    expect(getRegistration).toHaveBeenLastCalledWith('--gap');

    customPropertyRegistry.set(registration.name, registration);
    expect(property.parse('red', context)).not.toBeNull();
    expect(() => property.resolve(value, ValueStage.Computed, context))
      .toThrow('Registered custom-property computation is not implemented');
    customPropertyRegistry.delete(registration.name);
    expect(property.serialize(property.resolve(value, ValueStage.Computed, context))).toBe('red');
    expect(property.serialize(value)).toBe('red');
  });
});
