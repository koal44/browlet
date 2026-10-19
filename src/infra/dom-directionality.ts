import { firstStrongDirection, type TextDirection } from './bidi';
import type { DOMOperations } from './dom-operations';

/**
 * Find the first eligible descendant text direction, optionally excluding the root itself.
 * Host operations preserve element-specific exclusions and shadow-host directionality.
 */
// https://html.spec.whatwg.org/multipage/dom.html#contained-text-auto-directionality
export function getContainedTextDirection<
  N extends object, E extends N, A extends object, D extends N, F extends N, S extends F,
>(element: E, canExcludeRoot: boolean, dom: DOMOperations<N, E, A, D, F, S>): TextDirection | null {
  if (canExcludeRoot && dom.isAutoDirectionalityBoundary(element)) return null;
  // Pruning excluded subtrees implements the ancestor checks without revisiting each ancestor.
  for (let child = dom.firstChild(element); child !== null; child = dom.nextSibling(child)) {
    if (dom.isText(child)) {
      const direction = firstStrongDirection(dom.textData(child));
      if (direction !== null) return direction;
    } else if (dom.isElement(child) && !dom.isAutoDirectionalityBoundary(child)) {
      if (dom.isSlot(child)) {
        const root = dom.root(child);
        if (dom.isShadowRoot(root)) return dom.getDirectionality(dom.shadowHost(root));
      }
      const direction = getContainedTextDirection(child, false, dom);
      if (direction !== null) return direction;
    }
  }
  return null;
}
