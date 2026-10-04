import type { DOMQueryRoot as QuerySource, DOMOperations, DOMCollection, DOMElement as Element } from '../../infra/index';
import { sameId } from '../seeds/seedsById';
import { sameSelectorTag } from '../seeds/seedsByTag';
import { collectionToArray, concatCollection } from '../collections';
import { asciiLower } from '../../infra/ascii';
import type { SelectletContext } from '../context';

// scoped getElementById for Document, DocumentFragment, and Element sources
export function byId(id: string, source: QuerySource, ctx: SelectletContext): Element | null {
  ctx.update(source);
  if (!id) return null;

  if (!ctx.dom.isElement(source)) return ctx.dom.getElementById(source, id);

  if (ctx.dom.isConnected(source)) {
    if (ctx.hasDocumentAll) return byId_AllFirst(id, source, ctx.dom);
    if (ctx.config.MUTATE_IDS) return byId_MutateFirst(id, source, ctx.dom);
  }

  return byId_WalkFirst(id, source, ctx.dom);
}

function byId_AllFirst(id: string, source: Element, dom: DOMOperations): Element | null {
  if (!dom.isConnected(source)) throw new Error('byId_AllFirst cannot be used on a disconnected element');

  const item = dom.allNamedItem(dom.ownerDocument(source)!, id);
  if (item === null) {  // null
    return null;
  } else if (dom.isNode(item) && dom.isElement(item)) {  // Element
    const e = item;
    if (e !== source && sameId(e, id, dom) && dom.contains(source, e)) {
      return e;
    }
    return null;
  } else {  // HTMLCollection
    for (let i = 0; i < (item as DOMCollection).length; i++) {
      const e = (item as DOMCollection)[i]!;
      if (e !== source && sameId(e, id, dom) && dom.contains(source, e)) {
        return e;
      }
    }
    return null;
  }
}

function byId_MutateFirst(id: string, source: Element, dom: DOMOperations): Element | null {
  if (!dom.isConnected(source)) throw new Error('byId_MutateFirst cannot be used on a disconnected element');

  const doc = dom.ownerDocument(source)!;
  const mutated: Element[] = [];

  try {
    for (;;) {
      const e = dom.getElementById(doc, id);
      if (!e) return null;
      if (e !== source && dom.contains(source, e)) return e;
      dom.removeAttribute(e, 'id');
      mutated.push(e);
    }
  } finally {
    for (const e of mutated) dom.setAttribute(e, 'id', id);
  }
}

function byId_WalkFirst(id: string, source: Element, dom: DOMOperations): Element | null {
  let node: Element | null = source;
  let next: Element | null = dom.firstElementChild(node);

  while ((node = next)) {
    if (sameId(node, id, dom)) return node;

    next = dom.firstElementChild(node) || dom.nextElementSibling(node);
    if (next) continue;

    while (!next && (node = dom.parentElement(node)) && node !== source) {
      next = dom.nextElementSibling(node);
    }
  }

  return null;
}

export function byClass(cls: string, source: QuerySource, ctx: SelectletContext): Element[] {
  ctx.update(source);

  if (!ctx.dom.isDocumentFragment(source)) {
    return collectionToArray(ctx.dom.getElementsByClassName(source, cls));
  }

  const nodes: Element[] = [];
  const reCls = ctx.getClassRegex(cls);
  let el = ctx.dom.firstElementChild(source);

  while (el) {
    if (reCls.test(ctx.dom.getClass(el))) nodes.push(el);
    concatCollection(nodes, ctx.dom.getElementsByClassName(el, cls));
    el = ctx.dom.nextElementSibling(el);
  }

  return nodes;
}

// source-independent getElementsByTagName
export function byTag(tag: string, source: QuerySource, ctx: SelectletContext): Element[] {
  ctx.update(source);

  if (!tag) return [];

  if (!ctx.dom.isDocumentFragment(source)) {
    return collectionToArray(ctx.dom.getElementsByTagName(source, tag));
  }

  const nodes: Element[] = [];
  const any = tag === '*';
  const lowerTag = asciiLower(tag);
  const lowerTagOrNull = tag === lowerTag ? null : lowerTag;

  let el = ctx.dom.firstElementChild(source);

  while (el) {
    if (any || sameSelectorTag(el, tag, lowerTagOrNull, ctx)) {
      nodes.push(el);
    }

    concatCollection(nodes, ctx.dom.getElementsByTagName(el, tag));
    el = ctx.dom.nextElementSibling(el);
  }

  return nodes;
}

// source-independent getElementsByTagNameNS
export function byTagNs(ns: string | null, local: string, source: QuerySource, ctx: SelectletContext): Element[] {
  if (!local) return [];

  if (!ctx.dom.isDocumentFragment(source)) {
    return collectionToArray(ctx.dom.getElementsByTagNameNS(source, ns, local));
  }

  const nodes: Element[] = [];
  let el = ctx.dom.firstElementChild(source);

  while (el) {
    const nsMatch = ns === '*' || ctx.dom.getNamespaceURI(el) === ns;
    const localMatch = local === '*' || ctx.dom.getLocalName(el) === local;

    if (nsMatch && localMatch) nodes.push(el);

    concatCollection(nodes, ctx.dom.getElementsByTagNameNS(el, ns, local));
    el = ctx.dom.nextElementSibling(el);
  }

  return nodes;
}
