import { collectionToArray, concatCollection, iterableToArray } from '../utils/collections';
import { getClassAttr, isDocument, isElement } from '../utils/dom';

export type SeedClassFn = (classes: string[], context: QueryContext) => Element[];
type ClassCap<R> = (root: R, classes: string[]) => Iterable<Element>;

export function buildSeedsByClass(caps: SelectletCaps | undefined, snap: Snapshot): SeedClassFn {
  const doc = buildDocClassSeeder(caps?.doc?.cachedClasses);
  const el = buildElementClassSeeder();
  const frag = buildFragmentClassSeeder(caps?.frag?.cachedClasses, snap);

  return (classes, context) =>
    isDocument(context) ? doc(classes, context)
    : isElement(context) ? el(classes, context)
    : frag(classes, context);
}

function buildDocClassSeeder(cap: ClassCap<Document> | undefined): (classes: string[], doc: Document) => Element[] {
  return cap
    ? (classes, doc) => iterableToArray(cap(doc, classes))
    : (classes, doc) => collectionToArray(doc.getElementsByClassName(classes.join(' ')));
}

function buildElementClassSeeder(): (classes: string[], el: Element) => Element[] {
  return (classes, el) => collectionToArray(el.getElementsByClassName(classes.join(' ')));
}

function buildFragmentClassSeeder(
  cap: ClassCap<DocumentFragment> | undefined,
  snap: Snapshot,
): (classes: string[], frag: DocumentFragment) => Element[] {
  return cap
    ? (classes, frag) => iterableToArray(cap(frag, classes))
    : (classes, frag) => seedsByClassInFragment(classes, frag, snap);
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
