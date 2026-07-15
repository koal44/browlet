import { LOOKUP_COPY, type LookupMode } from '../constants';
import { concatCollection, htmlCollectionSource, mergeDocumentOrder } from '../../shared/collections';
import { asciiLower } from '../../shared/css';
import { isDocumentFragment } from '../../shared/dom';
import type { QueryContext } from '../selectlet';
import type { Snapshot } from '../snapshot';

export function seedsByTag(tag: string, context: QueryContext, lookupMode: LookupMode, snap: Snapshot): Iterable<Element> {
  if (!tag) return [];
  if (tag === '*') return seedsByAllTag(context, lookupMode, snap);

  if (isDocumentFragment(context)) {
    return seedsByTagFragment(tag, context, snap);
  }

  if (!snap.isHtml) {
    return htmlCollectionSource(context.getElementsByTagNameNS('*', tag), lookupMode === LOOKUP_COPY, snap.htmlCollectionArray);
  }

  const lowerTag = asciiLower(tag);
  if (tag === lowerTag) {
    return htmlCollectionSource(context.getElementsByTagNameNS('*', tag), lookupMode === LOOKUP_COPY, snap.htmlCollectionArray);
  }

  return seedsByTagNsUnion(tag, lowerTag, context, snap);
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
      : seedsByTagNsUnion(tag, lowerTag, root, snap);

    for (const e of found) nodes[nodes.length] = e;
  }

  return nodes;
}

function seedsByTagNsUnion(tag: string, lowerTag: string, context: Document | Element, snap: Snapshot): Element[] {
  const exact = context.getElementsByTagNameNS('*', tag);
  const lower = context.getElementsByTagNameNS('*', lowerTag);

  const exactNodes: Element[] = [];
  const lowerNodes: Element[] = [];

  for (const e of exact) {
    // Exact-cased selector tag should keep XML/foreign localName matches,
    // but not weird XHTML-namespace mixed-case elements created via createElementNS.
    if (!snap.isHtmlElement(e)) exactNodes[exactNodes.length] = e;
  }

  for (const e of lower) {
    // Folded lowerTag side is only for HTML elements in an HTML document.
    // XML/imported XML lowercase localName matches are false positives for e.g. selector "Foo".
    if (snap.isHtmlElement(e)) lowerNodes[lowerNodes.length] = e;
  }

  if (!exactNodes.length) return lowerNodes;
  if (!lowerNodes.length) return exactNodes;

  return mergeDocumentOrder(exactNodes, lowerNodes);
}

function seedsByAllTag(context: QueryContext, lookupMode: LookupMode, snap: Snapshot): Iterable<Element> {
  if (!isDocumentFragment(context)) {
    return htmlCollectionSource(context.getElementsByTagName('*'), lookupMode === LOOKUP_COPY, snap.htmlCollectionArray);
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
  if (lowerTag === null) return snap.getLocalName(e) === tag;
  return snap.isHtml && snap.isHtmlElement(e)
    ? snap.getLocalName(e) === lowerTag
    : snap.getLocalName(e) === tag;
}
