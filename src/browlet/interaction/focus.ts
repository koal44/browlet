import type { DocumentImpl, ElementImpl } from '../dom/nodes/index';

/** A focusable area's DOM representative, shared by focus consumers. */
// https://html.spec.whatwg.org/multipage/interaction.html#focusable-area
// TODO(HTML §6.6): model viewport, element, and element-subpart areas and their focus chains.
export type FocusableArea = {
  /** Document for a viewport, or the element representing a control or subpart. */
  domAnchor: DocumentImpl | ElementImpl;
};
