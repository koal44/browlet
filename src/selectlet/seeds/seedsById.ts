import type {
  DOMQueryRoot as QuerySource, DOMOperations, DOMCollection, DOMElement as Element, DOMDocument as Document,
  DOMDocumentFragment as DocumentFragment,
} from '../../infra/index';
import type { LookupMode } from '../constants';
import { iterableToArray } from '../../infra/collections';
import type { SelectletContext } from '../context';

export type SeedIdFn = (id: string, source: QuerySource, lookupMode: LookupMode) => Element[];

export function buildSeedsById(ctx: SelectletContext): SeedIdFn {
  return (id, source, _mode) => {
    return ctx.dom.isDocument(source) ? seedsByIdInDocument(id, source, ctx)
      : ctx.dom.isElement(source) ? seedsByIdInElement(id, source, ctx)
      : seedsByIdInFragment(id, source, ctx);
  };
}

function seedsByIdInDocument(id: string, source: Document, ctx: SelectletContext): Element[] {
  if (ctx.dom.cachedIds) return iterableToArray(ctx.dom.cachedIds(source, id));

  if (ctx.hasDocumentAll) return seedsById_All(id, source, ctx.dom);
  if (ctx.config.MUTATE_IDS) return seedsById_MutateInDoc(id, source, ctx.dom);

  return ctx.hasTreeWalker ? seedsById_TreeWalk(id, source, ctx.dom) : seedsById_Walk(id, source, ctx.dom);
}

function seedsByIdInElement(id: string, source: Element, ctx: SelectletContext): Element[] {
  const root = ctx.dom.root(source);

  if (ctx.dom.isDocument(root)) {
    if (ctx.dom.cachedIds) {
      return containedIdCandidates(ctx.dom.cachedIds(root, id), source, ctx.dom);
    }

    if (ctx.hasDocumentAll) return seedsById_All(id, source, ctx.dom);
    if (ctx.config.MUTATE_IDS) return seedsById_MutateInEl(id, source, ctx.dom);

    return ctx.hasTreeWalker ? seedsById_TreeWalk(id, source, ctx.dom) : seedsById_Walk(id, source, ctx.dom);
  }

  if (ctx.dom.isDocumentFragment(root)) {
    if (ctx.dom.cachedIds) {
      return containedIdCandidates(ctx.dom.cachedIds(root, id), source, ctx.dom);
    }

    if (ctx.config.MUTATE_IDS) {
      return containedIdCandidates(seedsById_MutateInDoc(id, root, ctx.dom), source, ctx.dom);
    }

    // No fragment cache/mutate fast path available. Walk only the element subtree, not the whole fragment.
    return ctx.hasTreeWalker ? seedsById_TreeWalk(id, source, ctx.dom) : seedsById_Walk(id, source, ctx.dom);
  }

  // Detached element/root weirdness. Local traversal is the only safe thing.
  return ctx.hasTreeWalker ? seedsById_TreeWalk(id, source, ctx.dom) : seedsById_Walk(id, source, ctx.dom);
}

function seedsByIdInFragment(id: string, source: DocumentFragment, ctx: SelectletContext): Element[] {
  if (ctx.dom.cachedIds) return iterableToArray(ctx.dom.cachedIds(source, id));
  if (ctx.config.MUTATE_IDS) return seedsById_MutateInDoc(id, source, ctx.dom);

  return ctx.hasTreeWalker ? seedsById_TreeWalk(id, source, ctx.dom) : seedsById_Walk(id, source, ctx.dom);
}

function seedsById_All(id: string, source: Document | Element, dom: DOMOperations): Element[] {
  // document.all is only a document-root fast path.
  // Element callers must already have been routed through a Document root.

  const isDoc = dom.isDocument(source);

  let doc: Document;
  if (isDoc) {
    doc = source;
  } else {
    if (!dom.isConnected(source)) throw new Error('byId_All cannot be used on a disconnected element or fragment');
    doc = dom.ownerDocument(source)!;
  }

  const item = dom.allNamedItem(doc, id);

  const nodes: Element[] = [];
  if (item === null) {  // null
    return nodes;
  } else if (dom.isNode(item) && dom.isElement(item)) {  // Element
    const e = item;
    if (sameId(e, id, dom) && (isDoc || (e !== source && dom.contains(source, e)))) {
      nodes.push(e);
    }
  } else {  // HTMLCollection
    for (let i = 0; i < (item as DOMCollection).length; i++) {
      const e = (item as DOMCollection)[i]!;
      if (sameId(e, id, dom) && (isDoc || (e !== source && dom.contains(source, e)))) {
        nodes.push(e);
      }
    }
  }

  return nodes;
}

function seedsById_MutateInDoc(id: string, source: Document | DocumentFragment, dom: DOMOperations): Element[] {
  const nodes: Element[] = [];

  try {
    for (;;) {
      const e = dom.getElementById(source, id);
      if (!e) break;
      nodes.push(e);
      dom.removeAttribute(e, 'id');
    }
  } finally {
    for (const e of nodes) dom.setAttribute(e, 'id', id);
  }

  return nodes;
}

function seedsById_MutateInEl(id: string, source: Element, dom: DOMOperations): Element[] {
  if (!dom.isConnected(source)) {
    throw new Error('byId_MutateInEl should only be called for element sources whose root is the owner document');
  }

  const doc = dom.ownerDocument(source)!;
  const nodes: Element[] = [];
  const mutated: Element[] = [];

  try {
    for (;;) {
      const e = dom.getElementById(doc, id);
      if (!e) break;

      if (e !== source && dom.contains(source, e)) {
        nodes.push(e);
      }
      dom.removeAttribute(e, 'id');
      mutated.push(e);
    }
  } finally {
    for (const e of mutated) dom.setAttribute(e, 'id', id);
  }

  return nodes;
}

function seedsById_Walk(id: string, source: QuerySource, dom: DOMOperations): Element[] {
  const nodes: Element[] = [];

  if (dom.isDocument(source)) {
    const root = dom.documentElement(source);
    if (root === null) return nodes;
    if (sameId(root, id, dom)) nodes.push(root);
    walk(root);
    return nodes;
  } else if (dom.isElement(source)) {
    walk(source);
    return nodes;
  } else {  // DocumentFragment
    for (let root = dom.firstElementChild(source); root; root = dom.nextElementSibling(root)) {
      if (sameId(root, id, dom)) nodes.push(root);
      walk(root);
    }
    return nodes;
  }

  function walk(source: Element): void {
    let node: Element | null = source;
    let next: Element | null = dom.firstElementChild(source);

    while ((node = next)) {
      if (sameId(node, id, dom)) nodes.push(node);

      next = dom.firstElementChild(node) || dom.nextElementSibling(node);
      if (next) continue;

      while (!next && (node = dom.parentElement(node)) && node !== source) {
        next = dom.nextElementSibling(node);
      }
    }
  }
}

function seedsById_TreeWalk(id: string, source: QuerySource, dom: DOMOperations): Element[] {
  const nodes: Element[] = [];
  let root: QuerySource = source;
  if (dom.isDocument(source)) {
    const element = dom.documentElement(source);
    if (element === null) return nodes;
    if (sameId(element, id, dom)) nodes.push(element);
    root = element;
  }
  for (const node of dom.walkElements!(root)) {
    if (sameId(node, id, dom)) nodes.push(node);
  }
  return nodes;
}

export function sameId(e: Element, id: string, dom: DOMOperations): boolean {
  return dom.getId(e) === id;
}

function containedIdCandidates(candidates: Iterable<Element>, source: Element, dom: DOMOperations): Element[] {
  const nodes: Element[] = [];
  let j = 0;

  for (const e of candidates) {
    if (e !== source && dom.contains(source, e)) {
      nodes[j++] = e;
    }
  }

  return nodes;
}
