import { collectionToArray, concatCollection } from "../utils/collections";
import { getClassAttr, isDocumentFragment } from "../utils/dom";

export function seedsByClass(cls: string, context: QueryContext, snap: Snapshot): Element[] {
  if (!isDocumentFragment(context)) {
    return collectionToArray(context.getElementsByClassName(cls));
  }

  const nodes: Element[] = [];
  const reCls = snap.getClassRegex(cls);
  let el = context.firstElementChild;

  while (el) {
    if (reCls.test(getClassAttr(el))) nodes.push(el);
    concatCollection(nodes, el.getElementsByClassName(cls));
    el = el.nextElementSibling;
  }

  return nodes;
}
