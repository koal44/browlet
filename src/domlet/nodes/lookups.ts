import { isElement } from './node';
import type { Element } from './element';
import type { TreeNode } from '../tree/tree-node';

export function findElementById(root: TreeNode, id: string): Element | null {
  let result: Element | null = null;

  walkElements(root, (element) => {
    if (element.getAttribute('id') !== id) return true;

    result = element;
    return false;
  });

  return result;
}

export function findElementsByClassName(
  root: TreeNode,
  classNames: string,
): Element[] {
  const names = splitOnAsciiWhitespace(classNames);
  if (names.length === 0) return [];

  return collectElements(root, (element) => {
    const value = element.getAttribute('class');
    if (value === null) return false;

    const classes = new Set(splitOnAsciiWhitespace(value));
    return names.every((name) => classes.has(name));
  });
}

export function findElementsByTagName(
  root: TreeNode,
  qualifiedName: string,
): Element[] {
  return collectElements(
    root,
    (element) => qualifiedName === '*' || element.localName === qualifiedName,
  );
}

export function findElementsByTagNameNS(
  root: TreeNode,
  namespaceURI: string | null,
  localName: string,
): Element[] {
  return collectElements(
    root,
    (element) =>
      (namespaceURI === '*' || element.namespaceURI === namespaceURI) &&
      (localName === '*' || element.localName === localName),
  );
}

function collectElements(
  root: TreeNode,
  matches: (element: Element) => boolean,
): Element[] {
  const elements: Element[] = [];

  walkElements(root, (element) => {
    if (matches(element)) elements.push(element);
    return true;
  });

  return elements;
}

function walkElements(
  root: TreeNode,
  visit: (element: Element) => boolean,
): boolean {
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (isElement(child) && !visit(child)) return false;
    if (!walkElements(child, visit)) return false;
  }

  return true;
}

function splitOnAsciiWhitespace(value: string): string[] {
  return value.match(/[^\t\n\f\r ]+/g) ?? [];
}
