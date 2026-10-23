/** Layout facts supplied to value processing for the current box. */
export type LayoutContext = {
  /** Containing block's logical width in CSS px; absent while layout has not established it. */
  containingBlockInlineSize?: number;
};
