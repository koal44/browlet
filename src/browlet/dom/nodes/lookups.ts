import { isElement } from './node';
import { HTMLCollectionImpl } from './collections';
import type { ElementImpl } from './element';
import type { NodeImpl } from './node';
import { parseOrderedSet } from '../algorithms/ordered-set';

export function findElementById(
  root: NodeImpl,
  id: string,
): ElementImpl | null {
  let result: ElementImpl | null = null;

  walkElements(root, (element) => {
    if (element.getAttribute('id') !== id) return true;

    result = element;
    return false;
  });

  return result;
}

export function findElementsByClassName(
  root: NodeImpl,
  classNames: string,
): HTMLCollectionImpl {
  const names = parseOrderedSet(classNames);
  if (names.size === 0) return new HTMLCollectionImpl();

  return collectElements(root, (element) => {
    const value = element.getAttribute('class');
    if (value === null) return false;

    const classes = parseOrderedSet(value);
    for (const name of names) {
      if (!classes.has(name)) return false;
    }
    return true;
  });
}

export function findElementsByTagName(
  root: NodeImpl,
  qualifiedName: string,
): HTMLCollectionImpl {
  return collectElements(
    root,
    (element) => qualifiedName === '*' || element.localName === qualifiedName,
  );
}

export function findElementsByTagNameNS(
  root: NodeImpl,
  namespaceURI: string | null,
  localName: string,
): HTMLCollectionImpl {
  return collectElements(
    root,
    (element) =>
      (namespaceURI === '*' || element.namespaceURI === namespaceURI) &&
      (localName === '*' || element.localName === localName),
  );
}

function collectElements(
  root: NodeImpl,
  matches: (element: ElementImpl) => boolean,
): HTMLCollectionImpl {
  const elements = new HTMLCollectionImpl();

  walkElements(root, (element) => {
    if (matches(element)) elements.push(element);
    return true;
  });

  return elements;
}

function walkElements(
  root: NodeImpl,
  visit: (element: ElementImpl) => boolean,
): boolean {
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (isElement(child) && !visit(child)) return false;
    if (!walkElements(child, visit)) return false;
  }

  return true;
}
