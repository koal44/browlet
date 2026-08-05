import type { ColorContext } from './values/color';
import type { ImageContext } from './values/image';
import type { MathContext } from './values/math-value';

export enum ValueStage {
  Declared,
  Cascaded,
  Specified,
  Computed,
  Used,
  Actual,
}

export type PropertyContext =
  & MathContext
  & ColorContext
  & ImageContext;
