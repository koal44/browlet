import { CascadeEngine } from './engine/cascade-engine';
import { TreeScope } from './engine/tree-scope';
import { Snapshot, type SnapshotOptions } from './snapshot';

export type StyleletOptions = SnapshotOptions;

export class Stylelet {
  readonly version = 'stylelet-__VERSION__';
  readonly snapshot: Snapshot;
  readonly documentScope: TreeScope;

  readonly #cascade: CascadeEngine;

  constructor(
    document: Document,
    options: StyleletOptions = {},
  ) {
    this.snapshot = new Snapshot(document, options);
    this.#cascade = new CascadeEngine({
      environmentBaseUrl: new URL(document.baseURI),
      snapshot: this.snapshot,
    });
    this.documentScope = new TreeScope(document, this.#cascade);
  }

  createStyleSheet(options: CSSStyleSheetInit = {}): CSSStyleSheet {
    return this.#cascade.createStyleSheet(options);
  }

  getComputedStyle(element: Element): CSSStyleDeclaration {
    return this.#cascade.getComputedStyle(element, this.documentScope);
  }
}
