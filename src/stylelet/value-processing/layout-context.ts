import type { ValueContext } from './value-context';

/** Layout facts supplied to value processing for the current box. */
export interface LayoutContext extends ValueContext {
  /** Containing block's logical width in CSS px; absent while layout has not established it. */
  containingBlockInlineSize?: number;
}
