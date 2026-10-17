import { asciiWhitespaceRunPattern, surroundingASCIIWhitespacePattern } from './patterns';

declare const scalarValueStringBrand: unique symbol;

/** Infra, convert a string into a scalar value string. */
export type ScalarValueString = string & {
  [scalarValueStringBrand]: true;
};

export function toScalarValueString(value: string): ScalarValueString {
  return value.toWellFormed() as ScalarValueString;
}

/** Remove surrounding ASCII whitespace and replace each remaining run with a space. */
// https://infra.spec.whatwg.org/#strip-and-collapse-ascii-whitespace
export function stripAndCollapseASCIIWhitespace(value: string): string {
  return value.replace(surroundingASCIIWhitespacePattern, '').split(asciiWhitespaceRunPattern).join(' ');
}

export function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\-\\]/g, '\\$&');
}
