import { splitOnAsciiWhitespace } from '../../infra/index';

import type { ElementImpl } from '../element';
import { findElementById } from '../lookups';
import type { HTMLElementImpl } from './html-element';

/**
 * Snapshot an item's property elements in tree order. Revisited elements flag an
 * error without aborting discovery; non-items have no properties or errors.
 */
// https://html.spec.whatwg.org/multipage/microdata.html#the-properties-of-an-item
// The result also exposes the microdata error flagged by the specification's traversal.
export function collectItemProperties(root: HTMLElementImpl): { properties: HTMLElementImpl[]; hasError: boolean; } {
  const properties: HTMLElementImpl[] = [];
  let hasError = false;
  if (!root.isMicrodataItem()) return { properties, hasError };

  const memory = new Set<ElementImpl>([root]);
  const pending: ElementImpl[] = [];
  for (let child = root.firstElementChild; child; child = child.nextElementSibling) pending.push(child);

  const itemref = root.getAttributeNS(null, 'itemref');
  if (itemref !== null) {
    const tree = root.getRoot();
    for (const id of splitOnAsciiWhitespace(itemref)) {
      // The tree can itself be a detached element; getElementById searches descendants only.
      const target = tree.isElement() && tree.getAttributeNS(null, 'id') === id ? tree : findElementById(tree, id);
      if (target !== null) pending.push(target);
    }
  }

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (memory.has(current)) {
      hasError = true;
      continue;
    }
    memory.add(current);

    const htmlElement = current.isHTMLElement();
    if (!htmlElement || !current.isMicrodataItem()) {
      for (let child = current.firstElementChild; child; child = child.nextElementSibling) pending.push(child);
    }
    if (htmlElement && current.getPropertyNames().length > 0) properties.push(current);
  }

  // All results belong to the same ordinary tree, regardless of discovery order.
  properties.sort((a, b) => a.comparePosition(b)!);
  return { properties, hasError };
}
