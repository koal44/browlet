import type {
  DOMNode as QuerySource, DOMNode as Element, DOMNode as Document, DOMNode as DocumentFragment,
} from '../../infra/index';
import { LOOKUP_COPY, type LookupMode } from '../constants';
import { concatCollection, htmlCollectionSource, mergeDocumentOrder } from '../collections';
import { asciiLower } from '../../infra/ascii';
import type { SelectletContext } from '../context';

export function seedsByTag(tag: string, source: QuerySource, lookupMode: LookupMode, ctx: SelectletContext): Iterable<Element> {
  if (!tag) return [];
  if (tag === '*') return seedsByAllTag(source, lookupMode, ctx);

  if (ctx.dom.isDocumentFragment(source)) {
    return seedsByTagFragment(tag, source, ctx);
  }

  if (!ctx.isHtml) {
    return htmlCollectionSource(ctx.dom.getElementsByTagNameNS(source, '*', tag), lookupMode === LOOKUP_COPY, ctx.dom);
  }

  const lowerTag = asciiLower(tag);
  if (tag === lowerTag) {
    return htmlCollectionSource(ctx.dom.getElementsByTagNameNS(source, '*', tag), lookupMode === LOOKUP_COPY, ctx.dom);
  }

  return seedsByTagNsUnion(tag, lowerTag, source, ctx);
}

function seedsByTagFragment(tag: string, source: DocumentFragment, ctx: SelectletContext): Element[] {
  const nodes: Element[] = [];
  const lowerTag = asciiLower(tag);
  const tagIsLower = tag === lowerTag;

  for (let root = ctx.dom.firstElementChild(source); root; root = ctx.dom.nextElementSibling(root)) {
    if (sameSelectorTag(root, tag, tagIsLower ? null : lowerTag, ctx)) {
      nodes.push(root);
    }

    const found = tagIsLower || !ctx.isHtml
      ? ctx.dom.getElementsByTagNameNS(root, '*', tag)
      : seedsByTagNsUnion(tag, lowerTag, root, ctx);

    for (const e of found) nodes[nodes.length] = e;
  }

  return nodes;
}

function seedsByTagNsUnion(tag: string, lowerTag: string, source: Document, ctx: SelectletContext): Element[] {
  const exact = ctx.dom.getElementsByTagNameNS(source, '*', tag);
  const lower = ctx.dom.getElementsByTagNameNS(source, '*', lowerTag);

  const exactNodes: Element[] = [];
  const lowerNodes: Element[] = [];

  for (const e of exact) {
    // Exact-cased selector tag should keep XML/foreign localName matches,
    // but not weird XHTML-namespace mixed-case elements created via createElementNS.
    if (!ctx.dom.isHTMLElement(e)) exactNodes[exactNodes.length] = e;
  }

  for (const e of lower) {
    // Folded lowerTag side is only for HTML elements in an HTML document.
    // XML/imported XML lowercase localName matches are false positives for e.g. selector "Foo".
    if (ctx.dom.isHTMLElement(e)) lowerNodes[lowerNodes.length] = e;
  }

  if (!exactNodes.length) return lowerNodes;
  if (!lowerNodes.length) return exactNodes;

  return mergeDocumentOrder(exactNodes, lowerNodes, ctx.dom);
}

function seedsByAllTag(source: QuerySource, lookupMode: LookupMode, ctx: SelectletContext): Iterable<Element> {
  if (!ctx.dom.isDocumentFragment(source)) {
    return htmlCollectionSource(ctx.dom.getElementsByTagName(source, '*'), lookupMode === LOOKUP_COPY, ctx.dom);
  }

  const nodes: Element[] = [];
  for (let el = ctx.dom.firstElementChild(source); el; el = ctx.dom.nextElementSibling(el)) {
    nodes.push(el);
    concatCollection(nodes, ctx.dom.getElementsByTagName(el, '*'));
  }

  return nodes;
}

// null lowerTag means tag==lowerTag
export function sameSelectorTag(e: Element, tag: string, lowerTag: string |  null, ctx: SelectletContext): boolean {
  if (lowerTag === null) return ctx.dom.getLocalName(e) === tag;
  return ctx.isHtml && ctx.dom.isHTMLElement(e)
    ? ctx.dom.getLocalName(e) === lowerTag
    : ctx.dom.getLocalName(e) === tag;
}
