import { HTML_NAMESPACE, asciiLower } from '../../../infra/index';

import { parseOrderedSet } from '../infra/index';

import { HTMLCollectionImpl } from './collections';
import type { ElementImpl } from './element';
import type { NodeImpl } from './node';

/** Find the first descendant with the requested nonempty ID in tree order. */
// https://dom.spec.whatwg.org/#get-an-element-by-id
export function findElementById(root: NodeImpl, id: string): ElementImpl | null {
  return id === '' ? null : findElement(root, (element) => element.getAttributeNS(null, 'id') === id);
}

/** Find the first matching descendant element; the root itself is excluded. */
export function findElement<T extends ElementImpl>(root: NodeImpl, matches: (element: ElementImpl) => element is T): T | null;
export function findElement(root: NodeImpl, matches: (element: ElementImpl) => boolean): ElementImpl | null;
export function findElement(root: NodeImpl, matches: (element: ElementImpl) => boolean): ElementImpl | null {
  for (let node = root.firstChild; node; node = node.nextDescendant(root)) {
    if (node.isElement() && matches(node)) return node;
  }
  return null;
}

/** Collect descendants with every requested class; an empty class set matches none. */
// https://dom.spec.whatwg.org/#concept-getelementsbyclassname
export function findElementsByClassName(root: NodeImpl, classNames: string): HTMLCollectionImpl {
  const names = parseOrderedSet(classNames);
  const lowercaseNames = Array.from(names, asciiLower);
  return HTMLCollectionImpl.fromRoot(root, (element) => {
    if (names.size === 0) return false;
    const value = element.getAttributeNS(null, 'class');
    if (value === null) return false;
    const quirks = root.nodeDocument.compatMode === 'BackCompat';
    const classes = parseOrderedSet(quirks ? asciiLower(value) : value);
    for (const name of quirks ? lowercaseNames : names) {
      if (!classes.has(name)) return false;
    }
    return true;
  });
}

/** Create a live descendant collection under the document's HTML/XML naming rules. */
// https://dom.spec.whatwg.org/#concept-getelementsbytagname
export function findElementsByTagName(root: NodeImpl, qualifiedName: string): HTMLCollectionImpl {
  const anyName = qualifiedName === '*';
  const html = root.nodeDocument.type === 'html';
  const lowercaseName = asciiLower(qualifiedName);
  return HTMLCollectionImpl.fromRoot(root, (element) => anyName ||
    element.qualifiedName === (html && element.namespaceURI === HTML_NAMESPACE ? lowercaseName : qualifiedName));
}

/** Create a live descendant collection with independent namespace and name wildcards. */
// https://dom.spec.whatwg.org/#concept-getelementsbytagnamens
export function findElementsByTagNameNS(
  root: NodeImpl, namespaceURI: string | null, localName: string,
): HTMLCollectionImpl {
  // Element's current storage uses an empty string for no namespace.
  const namespace = namespaceURI ?? '';
  const anyNamespace = namespace === '*';
  const anyName = localName === '*';
  return HTMLCollectionImpl.fromRoot(root, (element) =>
    (anyNamespace || element.namespaceURI === namespace) &&
    (anyName || element.localName === localName));
}
