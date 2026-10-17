import { parseHashNameReference } from '../../../../html/microsyntaxes/index';

import type { NodeImpl } from '../../node';
import { HTMLMapElementImpl } from './map';

/** Parse usemap and find the first HTML map whose id or name matches in scope's ordinary tree. */
// https://html.spec.whatwg.org/multipage/image-maps.html#image-map-processing-model
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-hash-name-reference
// PROVISIONAL(performance): Replace the linear scan with tree-owned id/name indexes when available.
export function findImageMap(input: string, scope: NodeImpl): HTMLMapElementImpl | null {
  const name = parseHashNameReference(input);
  if (name === null) return null;

  const root = scope.getRoot();
  for (let node: NodeImpl | null = root; node; node = node.nextDescendant(root)) {
    if (node instanceof HTMLMapElementImpl &&
      (node.getAttributeNS(null, 'name') === name || node.getAttributeNS(null, 'id') === name)) {
      return node;
    }
  }
  return null;
}
