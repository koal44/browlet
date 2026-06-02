import type { NthElementIndexMap, NthOfTypeParentMap } from './runtime';

export class RuntimeCache {
  private treeVersion: number | undefined;

  nthElement?: WeakMap<ParentNode, NthElementIndexMap>;
  nthOfType?: WeakMap<ParentNode, NthOfTypeParentMap>;

  sync(treeVersion: number | undefined): void {
    if (treeVersion === undefined) {
      this.clear();
      this.treeVersion = undefined;
      return;
    }

    if (this.treeVersion !== treeVersion) {
      this.treeVersion = treeVersion;
      this.clear();
    }
  }

  clear(): void {
    this.nthElement = undefined;
    this.nthOfType = undefined;
  }
}
