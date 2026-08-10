import { CSSStyleSheetImpl } from './cssom/css-stylesheet';
import { Snapshot, type SnapshotOptions } from './snapshot';

export type Stylelet = {
  version: string;
  snapshot: Snapshot;
  createStyleSheet(options?: CSSStyleSheetInit): CSSStyleSheet;
};

export type StyleletOptions = SnapshotOptions;

export function createStylelet(
  document: Document,
  options: StyleletOptions = {},
): Stylelet {
  const snapshot = new Snapshot(document, options);
  const api = {
    version: 'stylelet-__VERSION__',
    snapshot,

    createStyleSheet(options = {}): CSSStyleSheet {
      return new CSSStyleSheetImpl(snapshot, options);
    },
  };

  return api;
}
