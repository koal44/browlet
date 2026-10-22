import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';

/** The guaranteed-invalid value, distinct from a valid empty custom property. */
// https://drafts.csswg.org/css-variables-1/#guaranteed-invalid
export class GuaranteedInvalidValue implements Value {
  resolve(_stage: ValueStage, _context: unknown): GuaranteedInvalidValue {
    return this;
  }

  serialize(): string {
    return '';
  }
}

export const guaranteedInvalidValue = new GuaranteedInvalidValue();
