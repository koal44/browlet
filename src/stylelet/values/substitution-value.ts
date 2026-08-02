import { serializeComponentValues } from '../cssom/serialize';
import type { ValueStage } from '../value-processing';
import type { DeclarationValue } from './declaration-value';
import type { PropertyValue } from './property-value';

export type SubstitutionValue<Value, Context = unknown> = {
  type: 'substitution-value';
  declaration: DeclarationValue;
  resolve: (stage: ValueStage, context: Context) => PropertyValue<Value, Context>;
  serialize: () => string;
};

export function createSubstitutionValue<Value, Context = unknown>(
  declaration: DeclarationValue,
): SubstitutionValue<Value, Context> {
  return {
    type: 'substitution-value',
    declaration,
    resolve: () => {
      throw new Error('Substitution value resolution is not implemented');
    },
    serialize: () => serializeComponentValues(declaration.components),
  };
}
