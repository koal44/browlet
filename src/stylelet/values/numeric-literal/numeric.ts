import type { NumberLiteral } from './number';
import type { IntegerLiteral } from './integer';
import type { PercentageLiteral } from './percentage';
import type { DimensionLiteral } from './dimension';

/** Numeric literals supplied to calculations, including the concrete dimension subclasses. */
export type NumericLiteral = NumberLiteral | IntegerLiteral | PercentageLiteral | DimensionLiteral;
