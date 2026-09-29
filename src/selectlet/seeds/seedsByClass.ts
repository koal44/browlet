import type {
  DOMNode as QuerySource, DOMOperations, DOMNode as Element, DOMNode as DocumentFragment,
} from '../../infra/index';
import { LOOKUP_COPY, type LookupMode } from '../constants';
import { concatCollection, htmlCollectionSource } from '../collections';
import type { SelectletContext } from '../context';

export type SeedClassFn = (classes: string[], source: QuerySource, lookupMode: LookupMode) => Iterable<Element>;
export function buildSeedsByClass(ctx: SelectletContext): SeedClassFn {
  const dom = ctx.dom;
  return (classes, source, mode) => {
    if (classes.length === 0) return [];
    if (dom.cachedClasses) {
      if (!dom.isElement(source)) return dom.cachedClasses(source, classes);
      const root = dom.root(source);
      if (dom.isDocument(root) || dom.isDocumentFragment(root)) {
        return containedClassCandidates(dom.cachedClasses(root, classes), source, dom);
      }
    }
    return dom.isDocumentFragment(source)
      ? seedsByClassInFragment(classes, source, ctx)
      : htmlCollectionSource(dom.getElementsByClassName(source, classes.join(' ')), mode === LOOKUP_COPY, dom);
  };
}

function seedsByClassInFragment(classes: string[], source: DocumentFragment, ctx: SelectletContext): Element[] {
  if (classes.length === 0) return [];

  const nodes: Element[] = [];
  const query = classes.join(' ');

  if (classes.length === 1) {
    const cls = classes[0]!;
    const reCls = ctx.getClassRegex(cls);

    for (let el = ctx.dom.firstElementChild(source); el; el = ctx.dom.nextElementSibling(el)) {
      if (reCls.test(ctx.dom.getClass(el))) nodes.push(el);
      concatCollection(nodes, ctx.dom.getElementsByClassName(el, cls));
    }

    return nodes;
  }

  const tests = classes.map((cls) => ctx.getClassRegex(cls));

  for (let el = ctx.dom.firstElementChild(source); el; el = ctx.dom.nextElementSibling(el)) {
    const attr = ctx.dom.getClass(el);

    let matched = true;
    for (let i = 0, l = tests.length; i < l; ++i) {
      const test = tests[i]!;
      if (!test.test(attr)) {
        matched = false;
        break;
      }
    }

    if (matched) nodes.push(el);
    concatCollection(nodes, ctx.dom.getElementsByClassName(el, query));
  }

  return nodes;
}

function containedClassCandidates(candidates: Iterable<Element>, source: Element, dom: DOMOperations): Element[] {
  const nodes: Element[] = [];
  let j = 0;

  for (const e of candidates) {
    if (e !== source && dom.contains(source, e)) {
      nodes[j++] = e;
    }
  }

  return nodes;
}
