import type { DOMElement as Element, DOMParentNode as ParentNode } from '../../infra/index';

/** Zero-based positions of element children under one parent. */
export type NthElementIndexMap = WeakMap<Element, number>;

/** Sibling-position groups keyed by namespace and local name under one parent. */
export type NthOfTypeParentMap = Map<string, NthOfTypeIndexEntry>;

/** Count and positions of the siblings sharing one expanded element name. */
type NthOfTypeIndexEntry = {
  /** Number of siblings in this type group. */
  length: number;
  /** Zero-based positions within the type group. */
  indexMap: WeakMap<Element, number>;
};

/** Reusable sibling positions for structural selectors at one host-reported tree version. */
export class RuntimeCache {
  /** Element-child positions grouped by parent, populated when a structural selector needs them. */
  nthElement?: WeakMap<ParentNode, NthElementIndexMap>;
  /** Same-type sibling positions grouped by parent and expanded element name. */
  nthOfType?: WeakMap<ParentNode, NthOfTypeParentMap>;
  /** Tree version associated with the current caches; undefined means no version is available. */
  #treeVersion: number | undefined;

  /** Discard stale positions when the tree changes or cannot supply a version. */
  sync(treeVersion: number | undefined): void {
    if (treeVersion === undefined) {
      this.clear();
      this.#treeVersion = undefined;
      return;
    }

    if (this.#treeVersion !== treeVersion) {
      this.#treeVersion = treeVersion;
      this.clear();
    }
  }

  /** Drop cached sibling positions while retaining the last synchronized version. */
  clear(): void {
    this.nthElement = undefined;
    this.nthOfType = undefined;
  }
}
