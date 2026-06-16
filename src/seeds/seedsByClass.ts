import type { LookupMode } from '../constants';
import type { SelectletCaps } from '../selectlet';
import { concatCollection, htmlCollectionSource } from '../utils/collections';
import { isDocument, isElement } from '../utils/dom';

export type SeedClassFn = (classes: string[], context: QueryContext, lookupMode: LookupMode) => Iterable<Element>;
type ClassCap<R> = (root: R, classes: readonly string[]) => Iterable<Element>;

export function buildSeedsByClass(caps: SelectletCaps | undefined, snap: Snapshot): SeedClassFn {
  const docCap = caps?.doc?.cachedClasses;
  const fragCap = caps?.frag?.cachedClasses;

  return (classes, context, mode) =>
    isDocument(context) ? seedsByClassInDocument(classes, context, mode, docCap, snap)
    : isElement(context) ? seedsByClassInElement(classes, context, mode, docCap, snap)
    : seedsByClassInFragmentRoot(classes, context, fragCap, snap);
}

function seedsByClassInDocument(classes: string[], doc: Document, lookupMode: LookupMode, cap: ClassCap<Document> | undefined, snap: Snapshot): Iterable<Element> {
  if (classes.length === 0) return [];
  return cap
    ? cap(doc, classes)
    : htmlCollectionSource(doc.getElementsByClassName(classes.join(' ')), lookupMode, snap);
}

function seedsByClassInElement(classes: string[], el: Element, lookupMode: LookupMode, docCap: ClassCap<Document> | undefined, snap: Snapshot): Iterable<Element> {
  if (classes.length === 0) return [];

  if (el.isConnected && docCap) {
    const nodes: Element[] = [];
    let j = 0;

    for (const e of docCap(el.ownerDocument, classes)) {
      if (e !== el && el.contains(e)) nodes[j++] = e;
    }

    return nodes;
  }

  return htmlCollectionSource(el.getElementsByClassName(classes.join(' ')), lookupMode, snap);
}

function seedsByClassInFragmentRoot(
  classes: string[], frag: DocumentFragment, cap: ClassCap<DocumentFragment> | undefined, snap: Snapshot,
): Iterable<Element> {
  if (classes.length === 0) return [];
  return cap ? cap(frag, classes) : seedsByClassInFragment(classes, frag, snap);
}

function seedsByClassInFragment(classes: string[], context: DocumentFragment, snap: Snapshot): Element[] {
  if (classes.length === 0) return [];

  const nodes: Element[] = [];
  const query = classes.join(' ');

  if (classes.length === 1) {
    const cls = classes[0];
    const reCls = snap.getClassRegex(cls);

    for (let el = context.firstElementChild; el; el = el.nextElementSibling) {
      if (reCls.test(snap.getClass(el))) nodes.push(el);
      concatCollection(nodes, el.getElementsByClassName(cls));
    }

    return nodes;
  }

  const tests = classes.map((cls) => snap.getClassRegex(cls));

  for (let el = context.firstElementChild; el; el = el.nextElementSibling) {
    const attr = snap.getClass(el);

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
