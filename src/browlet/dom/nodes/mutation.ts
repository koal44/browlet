import { DOMExceptionNames, throwDOMException } from '../../../web-idl/index';
import type { NodeImpl } from './node';

/** Rejects an invalid insertion before either tree changes. */
// https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
export function ensurePreInsertValidity(
  node: NodeImpl,
  parent: NodeImpl,
  child: NodeImpl | null,
  childrenToExclude: NodeImpl[],
): void {
  if (!parent.isDocument() && !parent.isDocumentFragment() && !parent.isElement()) {
    throwDOMException(DOMExceptionNames.hierarchyRequest);
  }
  if (isHostIncludingInclusiveAncestor(node, parent)) {
    throwDOMException(DOMExceptionNames.hierarchyRequest);
  }
  if (child !== null && child.parentNode !== parent) {
    throwDOMException(DOMExceptionNames.notFound);
  }
  if (!node.isDocumentFragment() && !node.isDocumentType() && !node.isElement() && !node.isCharacterData()) {
    throwDOMException(DOMExceptionNames.hierarchyRequest);
  }

  if (!parent.isDocument()) {
    if (node.isDocumentType()) throwDOMException(DOMExceptionNames.hierarchyRequest);
    return;
  }
  if (node.isText()) throwDOMException(DOMExceptionNames.hierarchyRequest);
  if (node.isCharacterData()) return;

  if (node.isDocumentFragment()) {
    let elements = 0;
    for (let current = node.firstChild; current; current = current.nextSibling) {
      if (current.isElement()) elements++;
      if (elements > 1 || current.isText()) throwDOMException(DOMExceptionNames.hierarchyRequest);
    }
    if (elements === 0) return;
  }

  if (node.isDocumentFragment() || node.isElement()) {
    for (let current = parent.firstChild; current; current = current.nextSibling) {
      if (current.isElement() && !childrenToExclude.includes(current)) {
        throwDOMException(DOMExceptionNames.hierarchyRequest);
      }
    }
    for (let current = child; current; current = current.nextSibling) {
      if (current.isDocumentType() && (current !== child || !childrenToExclude.includes(current))) {
        throwDOMException(DOMExceptionNames.hierarchyRequest);
      }
    }
    return;
  }

  for (let current = parent.firstChild; current; current = current.nextSibling) {
    if (current.isDocumentType() && !childrenToExclude.includes(current)) {
      throwDOMException(DOMExceptionNames.hierarchyRequest);
    }
  }
  for (let current = parent.firstChild; current && current !== child; current = current.nextSibling) {
    if (current.isElement() && (child !== null || !childrenToExclude.includes(current))) {
      throwDOMException(DOMExceptionNames.hierarchyRequest);
    }
  }
}

// https://dom.spec.whatwg.org/#concept-tree-host-including-inclusive-ancestor
function isHostIncludingInclusiveAncestor(ancestor: NodeImpl, node: NodeImpl): boolean {
  let current: NodeImpl | null = node;
  while (current !== null) {
    if (ancestor.contains(current)) return true;
    const root = current.getRoot();
    current = root.isDocumentFragment() ? root.host : null;
  }
  return false;
}
