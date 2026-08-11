import { CascadeEngine } from './engine/cascade-engine';
import { DocumentOrShadowRootStyleState } from './engine/document-or-shadow-root';
import { Snapshot, type SnapshotOptions } from './snapshot';

export type Stylelet = {
  version: string;
  snapshot: Snapshot;
  createStyleSheet(options?: CSSStyleSheetInit): CSSStyleSheet;
  getComputedStyle(element: Element): CSSStyleDeclaration;
};

export type StyleletOptions = SnapshotOptions;

export function createStylelet(
  document: Document,
  options: StyleletOptions = {},
): Stylelet {
  return createStyleletEnvironment(document, options).stylelet;
}

export function createStyleletEnvironment(
  document: Document,
  options: StyleletOptions = {},
) {
  const snapshot = new Snapshot(document, options);
  const cascade = new CascadeEngine({
    environmentBaseUrl: new URL(document.baseURI),
    snapshot,
  });
  const state = new DocumentOrShadowRootStyleState(document, cascade);
  const stylelet: Stylelet = {
    version: 'stylelet-__VERSION__',
    snapshot,

    createStyleSheet(options = {}): CSSStyleSheet {
      return cascade.createStyleSheet(options);
    },

    getComputedStyle(element: Element): CSSStyleDeclaration {
      return cascade.getComputedStyle(element, state);
    },
  };

  return { state, stylelet };
}
