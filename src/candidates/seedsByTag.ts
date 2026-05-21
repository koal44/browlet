import { collectionToArray, concatCollection, mergeDocumentOrder } from "../utils/collections";
import { asciiLower } from "../utils/css";
import { isDocumentFragment, isHtmlElement } from "../utils/dom";

export function seedsByTag(tag: string, context: QueryContext, snap: Snapshot): Element[] {
  if (!tag) return [];
  if (tag === '*') return seedsByAllTag(context);

  if (isDocumentFragment(context)) {
    return seedsByTagFragment(tag, context, snap);
  }

  if (!snap.isHtml) {
    return collectionToArray(context.getElementsByTagNameNS('*', tag));
  }

  const lowerTag = asciiLower(tag);
  if (tag === lowerTag) {
    return collectionToArray(context.getElementsByTagNameNS('*', tag));
  }
  return seedsByTagNsUnion(tag, lowerTag, context);
}

function seedsByTagFragment(tag: string, context: DocumentFragment, snap: Snapshot): Element[] {
  const nodes: Element[] = [];
  const lowerTag = asciiLower(tag);
  const tagIsLower = tag === lowerTag;

  for (let root = context.firstElementChild; root; root = root.nextElementSibling) {
    if (sameSelectorTag(root, tag, tagIsLower ? null : lowerTag, snap)) {
      nodes.push(root);
    }

    const found = tagIsLower || !snap.isHtml
      ? root.getElementsByTagNameNS('*', tag)
      : seedsByTagNsUnion(tag, lowerTag, root);

    for (let i = 0, l = found.length; i < l; ++i) nodes.push(found[i]);
  }

  return nodes;
}

function seedsByTagNsUnion(tag: string, lowerTag: string, context: Document | Element): Element[] {
  const exact = context.getElementsByTagNameNS('*', tag);
  const lower = context.getElementsByTagNameNS('*', lowerTag);

  const exactNodes: Element[] = [];
  const lowerNodes: Element[] = [];

  for (let i = 0, l = exact.length; i < l; ++i) {
    const e = exact[i];

    // Exact-cased selector tag should keep XML/foreign localName matches,
    // but not weird XHTML-namespace mixed-case elements created via createElementNS.
    if (!isHtmlElement(e)) exactNodes.push(e);
  }

  for (let i = 0, l = lower.length; i < l; ++i) {
    const e = lower[i];

    // Folded lowerTag side is only for HTML elements in an HTML document.
    // XML/imported XML lowercase localName matches are false positives for e.g. selector "Foo".
    if (isHtmlElement(e)) lowerNodes.push(e);
  }

  if (!exactNodes.length) return lowerNodes;
  if (!lowerNodes.length) return exactNodes;

  return mergeDocumentOrder(exactNodes, lowerNodes);
}

function seedsByAllTag(context: QueryContext): Element[] {
  if (!isDocumentFragment(context)) {
    return collectionToArray(context.getElementsByTagName('*'));
  }

  const nodes: Element[] = [];
  for (let el = context.firstElementChild; el; el = el.nextElementSibling) {
    nodes.push(el);
    concatCollection(nodes, el.getElementsByTagName('*'));
  }

  return nodes;
}

// null lowerTag means tag==lowerTag
export function sameSelectorTag(e: Element, tag: string, lowerTag: string |  null, snap: Snapshot): boolean {
  if (lowerTag === null) return e.localName === tag;
  return snap.isHtml && isHtmlElement(e)
    ? e.localName === lowerTag
    : e.localName === tag;
}
