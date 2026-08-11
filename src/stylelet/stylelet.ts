import { CSSStyleSheetImpl } from './cssom/css-stylesheet';
import {
  StyleSheetCollection, type InlineStyleSheetOptions,
} from './cssom/stylesheet-collection';
import { Snapshot, type SnapshotOptions } from './snapshot';

export type { InlineStyleSheetOptions } from './cssom/stylesheet-collection';

export type Stylelet = {
  version: string;
  snapshot: Snapshot;
  readonly styleSheets: StyleSheetList;
  createStyleSheet(options?: CSSStyleSheetInit): CSSStyleSheet;
  createInlineStyleSheet(
    ownerNode: Element,
    source: string,
    options?: InlineStyleSheetOptions,
  ): CSSStyleSheet;
  removeStyleSheet(styleSheet: CSSStyleSheet): void;
};

export type StyleletOptions = SnapshotOptions;

export function createStylelet(
  document: Document,
  options: StyleletOptions = {},
): Stylelet {
  const snapshot = new Snapshot(document, options);
  const styleSheets = new StyleSheetCollection(snapshot);
  const api = {
    version: 'stylelet-__VERSION__',
    snapshot,
    styleSheets: styleSheets.list,

    createStyleSheet(options = {}): CSSStyleSheet {
      return new CSSStyleSheetImpl(snapshot, options);
    },

    createInlineStyleSheet(
      ownerNode: Element,
      source: string,
      options: InlineStyleSheetOptions = {},
    ): CSSStyleSheet {
      return styleSheets.createInlineStyleSheet(ownerNode, source, options);
    },

    removeStyleSheet(styleSheet: CSSStyleSheet): void {
      styleSheets.removeStyleSheet(styleSheet);
    },
  };

  return api;
}
