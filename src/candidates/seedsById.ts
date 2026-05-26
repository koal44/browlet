import { isDocument, isElement, isNamedItemAnElement } from '../utils/dom';

export function seedsById(id: string, context: QueryContext, snap: Snapshot): Element[] {
  if (!id) return [];

  if (isDocument(context)) {  // Document
    if (snap.hasDocumentAll) return seedsById_All(id, context);
    if (snap.config.MUTATE_IDS) return seedsById_MutateInDoc(id, context);
  } else if (isElement(context)) {  // Element
    if (context.isConnected) {
      if (snap.hasDocumentAll) return seedsById_All(id, context);
      if (snap.config.MUTATE_IDS) return seedsById_MutateInEl(id, context);
    }
  } else {  // DocumentFragment
    if (snap.config.MUTATE_IDS) return seedsById_MutateInDoc(id, context);
  }

  return snap.hasTreeWalker ? seedsById_TreeWalk(id, context) : seedsById_Walk(id, context);
}

function seedsById_All(id: string, context: Document | Element): Element[] {
  // document.all only sees connected document-tree elements.
  // Detached elements, fragments, and template contents need local traversal.

  const isDoc = isDocument(context);

  let doc: Document;
  if (isDoc) {
    doc = context;
  } else {
    if (!context.isConnected) throw new Error('byId_All cannot be used on a disconnected element or fragment');
    doc = context.ownerDocument;
  }

  const item = doc.all.namedItem(id);

  const nodes: Element[] = [];
  if (item === null) {  // null
    return nodes;
  } else if (isNamedItemAnElement(item)) {  // Element
    const e = item;
    if (sameId(e, id) && (isDoc || (e !== context && context.contains(e)))) {
      nodes.push(e);
    }
  } else {  // HTMLCollection
    for (let i = 0; i < item.length; i++) {
      const e = item[i];
      if (sameId(e, id) && (isDoc || (e !== context && context.contains(e)))) {
        nodes.push(e);
      }
    }
  }

  return nodes;
}

function seedsById_MutateInDoc(id: string, context: Document | DocumentFragment): Element[] {
  const nodes: Element[] = [];

  try {
    for (;;) {
      const e = context.getElementById(id);
      if (!e) break;
      nodes.push(e);
      e.removeAttribute('id');
    }
  } finally {
    for (const e of nodes) e.setAttribute('id', id);
  }

  return nodes;
}

function seedsById_MutateInEl(id: string, context: Element): Element[] {
  if (!context.isConnected) {
    throw new Error('byId_MutateInEl cannot be used on a disconnected element');
  }

  const doc = context.ownerDocument;
  const nodes: Element[] = [];
  const mutated: Element[] = [];

  try {
    for (;;) {
      const e = doc.getElementById(id);
      if (!e) break;

      if (e !== context && context.contains(e)) {
        nodes.push(e);
      }
      e.removeAttribute('id');
      mutated.push(e);
    }
  } finally {
    for (const e of mutated) e.setAttribute('id', id);
  }

  return nodes;
}

function seedsById_Walk(id: string, context: QueryContext): Element[] {
  const nodes: Element[] = [];

  if (isDocument(context)) {
    const root = context.documentElement;
    if (sameId(root, id)) nodes.push(root);
    walk(root);
    return nodes;
  } else if (isElement(context)) {
    walk(context);
    return nodes;
  } else {  // DocumentFragment
    for (let root = context.firstElementChild; root; root = root.nextElementSibling) {
      if (sameId(root, id)) nodes.push(root);
      walk(root);
    }
    return nodes;
  }

  function walk(context: Element): void {
    let node: Element | null = context;
    let next: Element | null = context.firstElementChild;

    while ((node = next)) {
      if (sameId(node, id)) nodes.push(node);

      next = node.firstElementChild || node.nextElementSibling;
      if (next) continue;

      while (!next && (node = node.parentElement) && node !== context) {
        next = node.nextElementSibling;
      }
    }
  }
}

function seedsById_TreeWalk(id: string, context: QueryContext): Element[] {
  const nodes: Element[] = [];

  let root: Element | DocumentFragment;
  let doc: Document;
  if (isDocument(context)) {
    root = context.documentElement;
    doc = context;
    if (sameId(root, id)) nodes.push(root);
  } else {
    root = context;
    doc = context.ownerDocument;
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const e = node as Element; // TypeScript doesn't know the filter is effectively applied.
    if (sameId(e, id)) nodes.push(e);
  }

  return nodes;
}

export function sameId(e: Element, id: string): boolean {
  // return e.id === id; // fast but can be wrong
  // return e.getAttribute('id') === id; // slower but correct
  // return isHtmlForm(e) ? e.getAttribute('id') === id : e.id === id;  // compromise
  const v = e.id;
  return typeof v === 'string' ? v === id : e.getAttribute('id') === id; // best compromise
}
