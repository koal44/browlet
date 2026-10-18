import type { DOMElement as Element, DOMParentNode as ParentNode } from '../../infra/index';

export type NthElementIndexMap = WeakMap<Element, number>;

export type NthOfTypeParentMap = Map<string, NthOfTypeIndexEntry>;

type NthOfTypeIndexEntry = {
  length: number;
  indexMap: WeakMap<Element, number>;
};

export class RuntimeCache {

  nthElement?: WeakMap<ParentNode, NthElementIndexMap>;
  nthOfType?: WeakMap<ParentNode, NthOfTypeParentMap>;
  #treeVersion: number | undefined;

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

  clear(): void {
    this.nthElement = undefined;
    this.nthOfType = undefined;
  }
}
