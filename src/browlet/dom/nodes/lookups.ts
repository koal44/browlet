import { HTMLCollectionImpl } from './collections';
import type { ElementImpl } from './element';
import type { NodeImpl } from './node';
import { parseOrderedSet } from '../infra/ordered-set';

/** Find the first descendant with the requested ID in tree order. */
// https://dom.spec.whatwg.org/#get-an-element-by-id
export function findElementById(
  root: NodeImpl,
  id: string,
): ElementImpl | null {
  return findElement(root, (element) => element.getAttribute('id') === id);
}

/** Find the first matching descendant element; the root itself is excluded. */
export function findElement(
  root: NodeImpl,
  matches: (element: ElementImpl) => boolean,
): ElementImpl | null {
  let result: ElementImpl | null = null;

  walkElements(root, (element) => {
    if (!matches(element)) return true;

    result = element;
    return false;
  });

  return result;
}

/** Collect descendants with every requested class; an empty class set matches none. */
// https://dom.spec.whatwg.org/#concept-getelementsbyclassname
export function findElementsByClassName(
  root: NodeImpl,
  classNames: string,
): HTMLCollectionImpl {
  const names = parseOrderedSet(classNames);
  return new HTMLCollectionImpl(() => names.size === 0
    ? []
    : collectElements(root, (element) => {
      const value = element.getAttribute('class');
      if (value === null) return false;

      const classes = parseOrderedSet(value);
      for (const name of names) {
        if (!classes.has(name)) return false;
      }
      return true;
    }));
}

/** Create a live descendant collection, accepting '*' to match every name. */
// https://dom.spec.whatwg.org/#concept-getelementsbytagname
export function findElementsByTagName(
  root: NodeImpl,
  qualifiedName: string,
): HTMLCollectionImpl {
  return new HTMLCollectionImpl(() => collectElements(
    root,
    (element) => qualifiedName === '*' || element.localName === qualifiedName,
  ));
}

/** Create a live descendant collection with independent namespace and name wildcards. */
// https://dom.spec.whatwg.org/#concept-getelementsbytagnamens
export function findElementsByTagNameNS(
  root: NodeImpl,
  namespaceURI: string | null,
  localName: string,
): HTMLCollectionImpl {
  return new HTMLCollectionImpl(() => collectElements(
    root,
    (element) =>
      (namespaceURI === '*' || element.namespaceURI === namespaceURI) &&
      (localName === '*' || element.localName === localName),
  ));
}

function collectElements(
  root: NodeImpl,
  matches: (element: ElementImpl) => boolean,
): ElementImpl[] {
  const elements: ElementImpl[] = [];

  walkElements(root, (element) => {
    if (matches(element)) elements.push(element);
    return true;
  });

  return elements;
}

/** Visit descendant elements in tree order, stopping when the visitor returns false. */
function walkElements(
  root: NodeImpl,
  visit: (element: ElementImpl) => boolean,
): boolean {
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.isElement() && !visit(child)) return false;
    if (!walkElements(child, visit)) return false;
  }

  return true;
}
