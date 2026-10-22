/** Inclusive numeric bounds, with infinities representing unbounded ends. */
export type NumericRange = [minimum: number, maximum: number];

/** Pair supplied bounds, returning undefined when neither end is specified. */
export function createNumericRange(min?: number, max?: number): NumericRange | undefined {
  if (min === undefined && max === undefined) return undefined;
  return [min ?? -Infinity, max ?? Infinity];
}
