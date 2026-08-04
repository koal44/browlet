import type { ValueStage } from '../value-processing';

export type GuaranteedInvalidValue = {
  type: 'guaranteed-invalid';
  resolve: (stage: ValueStage, context: unknown) => GuaranteedInvalidValue;
  serialize: () => string;
};

export const guaranteedInvalidValue: GuaranteedInvalidValue = {
  type: 'guaranteed-invalid',
  resolve: () => guaranteedInvalidValue,
  serialize: () => '',
};
