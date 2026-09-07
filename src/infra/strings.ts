declare const scalarValueStringBrand: unique symbol;

/** Infra, convert a string into a scalar value string. */
export type ScalarValueString = string & {
  readonly [scalarValueStringBrand]: true;
};

export function toScalarValueString(value: string): ScalarValueString {
  return value.toWellFormed() as ScalarValueString;
}

export function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\-\\]/g, '\\$&');
}
