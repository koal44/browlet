import { sameId } from '../seeds/seedsById';
import { sameSelectorTag } from '../seeds/seedsByTag';
import { collectionToArray, concatCollection } from '../utils/collections';
import { asciiLower } from '../utils/css';
import { isDocumentFragment, isElement, isNamedItemAnElement } from '../utils/dom';

// scoped getElementById for Document, DocumentFragment, and Element contexts
export function byId(id: string, context: QueryContext, snap: Snapshot): Element | null {
  snap.update(context);
  if (!id) return null;

  if (!isElement(context)) return context.getElementById(id);

  if (context.isConnected) {
    if (snap.hasDocumentAll) return byId_AllFirst(id, context);
    if (snap.config.MUTATE_IDS) return byId_MutateFirst(id, context);
  }

  return byId_WalkFirst(id, context);
}

function byId_AllFirst(id: string, context: Element): Element | null {
  if (!context.isConnected) throw new Error('byId_AllFirst cannot be used on a disconnected element');

  const item = context.ownerDocument.all.namedItem(id);
  if (item === null) {  // null
    return null;
  } else if (isNamedItemAnElement(item)) {  // Element
    const e = item;
    if (e !== context && sameId(e, id) && context.contains(e)) {
      return e;
    }
    return null;
  } else {  // HTMLCollection
    for (let i = 0; i < item.length; i++) {
      const e = item[i];
      if (e !== context && sameId(e, id) && context.contains(e)) {
        return e;
      }
    }
    return null;
  }
}

function byId_MutateFirst(id: string, context: Element): Element | null {
  if (!context.isConnected) throw new Error('byId_MutateFirst cannot be used on a disconnected element');

  const doc = context.ownerDocument;
  const mutated: Element[] = [];

  try {
    for (;;) {
      const e = doc.getElementById(id);
      if (!e) return null;
      if (e !== context && context.contains(e)) return e;
      e.removeAttribute('id');
      mutated.push(e);
    }
  } finally {
    for (const e of mutated) e.setAttribute('id', id);
  }
}

function byId_WalkFirst(id: string, context: Element): Element | null {
  let node: Element | null = context;
  let next: Element | null = node.firstElementChild;

  while ((node = next)) {
    if (sameId(node, id)) return node;

    next = node.firstElementChild || node.nextElementSibling;
    if (next) continue;

    while (!next && (node = node.parentElement) && node !== context) {
      next = node.nextElementSibling;
    }
  }

  return null;
}

export function byClass(cls: string, context: QueryContext, snap: Snapshot): Element[] {
  snap.update(context);

  if (!isDocumentFragment(context)) {
    return collectionToArray(context.getElementsByClassName(cls));
  }

  const nodes: Element[] = [];
  const reCls = snap.getClassRegex(cls);
  let el = context.firstElementChild;

  while (el) {
    if (reCls.test(snap.getClass(el))) nodes.push(el);
    concatCollection(nodes, el.getElementsByClassName(cls));
    el = el.nextElementSibling;
  }

  return nodes;
}

// context agnostic getElementsByTagName
export function byTag(tag: string, context: QueryContext, snap: Snapshot): Element[] {
  snap.update(context);

  if (!tag) return [];

  if (!isDocumentFragment(context)) {
    return collectionToArray(context.getElementsByTagName(tag));
  }

  const nodes: Element[] = [];
  const any = tag === '*';
  const lowerTag = asciiLower(tag);
  const lowerTagOrNull = tag === lowerTag ? null : lowerTag;

  let el = context.firstElementChild;

  while (el) {
    if (any || sameSelectorTag(el, tag, lowerTagOrNull, snap)) {
      nodes.push(el);
    }

    concatCollection(nodes, el.getElementsByTagName(tag));
    el = el.nextElementSibling;
  }

  return nodes;
}

// context agnostic getElementsByTagNameNS
export function byTagNs(ns: string | null, local: string, context: QueryContext, snap: Snapshot): Element[] {
  if (!local) return [];

  if (!isDocumentFragment(context)) {
    return collectionToArray(context.getElementsByTagNameNS(ns, local));
  }

  const nodes: Element[] = [];
  let el = context.firstElementChild;

  while (el) {
    const nsMatch = ns === '*' || snap.getNamespaceURI(el) === ns;
    const localMatch = local === '*' || snap.getLocalName(el) === local;

    if (nsMatch && localMatch) nodes.push(el);

    concatCollection(nodes, el.getElementsByTagNameNS(ns, local));
    el = el.nextElementSibling;
  }

  return nodes;
}
