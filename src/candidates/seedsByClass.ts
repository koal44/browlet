import type { SelectletCaps } from '../selectlet';
import { collectionToArray, concatCollection, iterableToArray } from '../utils/collections';
import { getClassAttr, isDocument, isElement } from '../utils/dom';

export type SeedClassFn = (classes: string[], context: QueryContext) => Element[];
type ClassCap<R> = (root: R, classes: readonly string[]) => Iterable<Element>;

export function buildSeedsByClass(caps: SelectletCaps | undefined, snap: Snapshot): SeedClassFn {
  const docCap = caps?.doc?.cachedClasses;
  const fragCap = caps?.frag?.cachedClasses;

  return (classes, context) =>
    isDocument(context) ? seedsByClassInDocument(classes, context, docCap)
    : isElement(context) ? seedsByClassInElement(classes, context, docCap)
    : seedsByClassInFragmentRoot(classes, context, snap, fragCap);
}

function seedsByClassInDocument(classes: string[], doc: Document, cap: ClassCap<Document> | undefined): Element[] {
  if (classes.length === 0) return [];
  return cap ? iterableToArray(cap(doc, classes)) : collectionToArray(doc.getElementsByClassName(classes.join(' ')));
}

function seedsByClassInElement(classes: string[], el: Element, docCap: ClassCap<Document> | undefined): Element[] {
  if (classes.length === 0) return [];

  if (el.isConnected && docCap) {
    const nodes: Element[] = [];
    let j = 0;

    for (const e of docCap(el.ownerDocument, classes)) {
      if (e !== el && el.contains(e)) nodes[j++] = e;
    }

    return nodes;
  }

  return collectionToArray(el.getElementsByClassName(classes.join(' ')));
}

function seedsByClassInFragmentRoot(
  classes: string[], frag: DocumentFragment, snap: Snapshot, cap: ClassCap<DocumentFragment> | undefined,
): Element[] {
  if (classes.length === 0) return [];
  return cap ? iterableToArray(cap(frag, classes)) : seedsByClassInFragment(classes, frag, snap);
}

function seedsByClassInFragment(classes: string[], context: DocumentFragment, snap: Snapshot): Element[] {
  if (classes.length === 0) return [];

  const nodes: Element[] = [];
  const query = classes.join(' ');

  if (classes.length === 1) {
    const cls = classes[0];
    const reCls = snap.getClassRegex(cls);

    for (let el = context.firstElementChild; el; el = el.nextElementSibling) {
      if (reCls.test(getClassAttr(el))) nodes.push(el);
      concatCollection(nodes, el.getElementsByClassName(cls));
    }

    return nodes;
  }

  const tests = classes.map((cls) => snap.getClassRegex(cls));

  for (let el = context.firstElementChild; el; el = el.nextElementSibling) {
    const attr = getClassAttr(el);

    let matched = true;
    for (let i = 0, l = tests.length; i < l; ++i) {
      if (!tests[i].test(attr)) {
        matched = false;
        break;
      }
    }

    if (matched) nodes.push(el);
    concatCollection(nodes, el.getElementsByClassName(query));
  }

  return nodes;
}
