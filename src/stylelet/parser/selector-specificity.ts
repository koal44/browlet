export type Specificity = Readonly<{
  a: number;
  b: number;
  c: number;
}>;

export const Specificity0: Specificity = Object.freeze({ a: 0, b: 0, c: 0 });
export const SpecificityA: Specificity = Object.freeze({ a: 1, b: 0, c: 0 });
export const SpecificityB: Specificity = Object.freeze({ a: 0, b: 1, c: 0 });
export const SpecificityC: Specificity = Object.freeze({ a: 0, b: 0, c: 1 });

export function addSpecificity(
  left: Specificity,
  right: Specificity,
): Specificity {
  if (left === Specificity0) return right;
  if (right === Specificity0) return left;

  return {
    a: left.a + right.a,
    b: left.b + right.b,
    c: left.c + right.c,
  };
}

export function sumSpecificity(
  values: readonly (Specificity | null | undefined)[],
): Specificity {
  let specificity = Specificity0;

  for (const value of values) {
    if (value) {
      specificity = addSpecificity(specificity, value);
    }
  }

  return specificity;
}

export function compareSpecificity(
  left: Specificity,
  right: Specificity,
): number {
  return left.a - right.a || left.b - right.b || left.c - right.c;
}

export function maxSpecificity(
  values: readonly Specificity[],
): Specificity {
  let max = Specificity0;

  for (const value of values) {
    if (compareSpecificity(value, max) > 0) {
      max = value;
    }
  }

  return max;
}

export function listSpecificity(arms: { specificity: Specificity; }[]): Specificity {
  return maxSpecificity(arms.map((arm) => arm.specificity));
}
