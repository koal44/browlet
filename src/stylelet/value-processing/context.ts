import type { ColorContext } from '../values/color';
import type { ImageContext } from '../values/image';
import type { MathContext } from '../values/math-value';
import type { Declaration } from '../syntax/rule';

export type PropertyContext =
  & MathContext
  & ColorContext
  & ImageContext
  & {
    supports?: (declaration: Declaration) => boolean;
  };
