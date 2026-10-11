import { HTML_NAMESPACE } from '../../../../../infra/index';

import { parseHashNameReference } from '../../../../html/microsyntaxes/index';
import type { ElementImpl } from '../../element';
import type { NodeImpl } from '../../node';

/** Parse usemap and find the first HTML map whose id or name matches in scope's ordinary tree. */
// https://html.spec.whatwg.org/multipage/image-maps.html#image-map-processing-model
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-hash-name-reference
// PROVISIONAL(performance): Replace the linear scan with tree-owned id/name indexes when available.
export function findImageMap(input: string, scope: NodeImpl): ElementImpl | null {
  const name = parseHashNameReference(input);
  if (name === null) return null;

  const root = scope.getRoot();
  for (let node: NodeImpl | null = root; node; node = node.nextDescendant(root)) {
    if (node.isElement() && node.namespaceURI === HTML_NAMESPACE && node.localName === 'map' &&
      (node.getAttributeNS(null, 'name') === name || node.getAttributeNS(null, 'id') === name)) {
      return node;
    }
  }
  return null;
}
