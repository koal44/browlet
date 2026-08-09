import { SelectletCSSStyleSheet } from './cssom/stylesheet';
import { Snapshot, type SnapshotOptions } from './snapshot';

export type Stylelet = {
  version: string;
  snapshot: Snapshot;
  createStyleSheet(source?: string): CSSStyleSheet;
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

    createStyleSheet(source = ''): CSSStyleSheet {
      const sheet = new SelectletCSSStyleSheet();

      if (source !== '') sheet.replaceSync(source);

      return sheet;
    },
  };

  return api;
}
