import type { ColorContext } from '../values/color';
import type { ImageContext } from '../values/image';
import type { MathContext } from '../values/math-value';

export type PropertyContext =
  & MathContext
  & ColorContext
  & ImageContext;
