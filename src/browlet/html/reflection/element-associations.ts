import { splitOnAsciiWhitespace } from '../../dom/infra/index';
import type { ElementImpl, NodeImpl } from '../../dom/nodes/index';

/** Explicit weak associations owned by one reflected target; tree lookup remains live. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-element
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-elements
export class ElementAssociations {
  /** A present entry suppresses ID lookup even after its weak reference expires. */
  #singleAssignments: Map<string, WeakRef<ElementImpl>> | undefined;
  /** A present empty list likewise differs from an absent explicit assignment. */
  #listAssignments: Map<string, WeakRef<ElementImpl>[]> | undefined;

  /**
   * Read one target or a fresh list. The owner supplies the tree scope; the target
   * constructors filter ID matches. Explicit assignments have already been converted.
   * Platform-array identity belongs to the reflected binding.
   */
  get<T extends ElementImpl>(
    owner: ElementImpl, name: string, value: string | null, targetConstructors: ElementConstructor<T>[], isArray: boolean,
  ): T | T[] | null {
    if (!isArray) {
      const explicit = this.#singleAssignments?.get(name);
      if (explicit) {
        const candidate = explicit.deref();
        return candidate && isInScope(owner.getRoot(), candidate) ? candidate as T : null;
      }
      return value === null ? null : findById(owner.getRoot(), value, targetConstructors);
    }

    const explicit = this.#listAssignments?.get(name);
    if (explicit) {
      const root = owner.getRoot();
      const elements: T[] = [];
      for (const reference of explicit) {
        const candidate = reference.deref();
        if (candidate && isInScope(root, candidate)) elements.push(candidate as T);
      }
      return elements;
    }

    if (value === null) return null;
    const root = owner.getRoot();
    const elements: T[] = [];
    for (const id of splitOnAsciiWhitespace(value)) {
      const candidate = findById(root, id, targetConstructors);
      if (candidate) elements.push(candidate);
    }
    return elements;
  }

  /** Retain converted references after the content-attribute write, preserving list order and duplicates. */
  set(name: string, value: ElementImpl | ElementImpl[]): void {
    if (Array.isArray(value)) (this.#listAssignments ??= new Map()).set(name, value.map((element) => new WeakRef(element)));
    else (this.#singleAssignments ??= new Map()).set(name, new WeakRef(value));
  }

  /** Ordinary null-namespace attribute changes clear either kind of explicit assignment. */
  clear(name: string): void {
    this.#singleAssignments?.delete(name);
    this.#listAssignments?.delete(name);
  }
}

/** Implementation constructor identifying the permitted target type, independently of the association's owner. */
export type ElementConstructor<T extends ElementImpl = ElementImpl> = abstract new (...argumentsList: never[]) => T;

// Search the owner's ordinary tree, then each enclosing shadow host's ordinary tree.
// Do not admit elements inside unrelated shadow trees merely because their composed roots match.
function isInScope(root: NodeImpl, candidate: ElementImpl): boolean {
  // SPEC_CLASH(reflected-element-detached-scope): Follow Chromium/Firefox's inclusive tree scopes; HTML's strict wording excludes detached roots and WebKit excludes root-to-child references.
  const candidateRoot = candidate.getRoot();
  for (;;) {
    if (root === candidateRoot) return true;
    if (!root.isShadowRoot()) return false;
    root = root.host.getRoot();
  }
}

// PROVISIONAL(performance): use the existing tree until a tree-scope ID index can preserve
// first-match interface filtering, duplicate IDs, and detached element roots.
function findById<T extends ElementImpl>(root: NodeImpl, id: string, targetConstructors: ElementConstructor<T>[]): T | null {
  // An absent or empty id attribute gives an element no ID.
  if (id === '') return null;
  for (let node: NodeImpl | null = root; node; node = node.nextDescendant(root)) {
    if (!node.isElement() || node.getAttributeNS(null, 'id') !== id) continue;
    for (const Constructor of targetConstructors) {
      if (node instanceof Constructor) return node;
    }
  }
  return null;
}
