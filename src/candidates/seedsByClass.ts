import { collectionToArray, concatCollection } from "../utils/collections";
import { escapeRegExp } from "../utils/css";
import { isDocument, isElement } from "../utils/dom";

export function seedsByClass(cls: string, context: QueryContext, snap: Snapshot): Element[] {
  if (isDocument(context) || isElement(context)) {
    return collectionToArray(context.getElementsByClassName(cls));
  }

  const nodes: Element[] = [];
  const reCls = snap.getCachedRegex('(^|\\s)' + escapeRegExp(cls) + '(\\s|$)', snap.isQuirksMode ? 'i' : '');
  let el = context.firstElementChild;

  while (el) {
    if (reCls.test(el.getAttribute('class') || '')) nodes.push(el);
    concatCollection(nodes, el.getElementsByClassName(cls));
    el = el.nextElementSibling;
  }

  return nodes;
}
