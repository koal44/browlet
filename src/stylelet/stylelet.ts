import { SelectletCSSStyleSheet } from './cssom/stylesheet';

export type Stylelet = {
  version: string;
  createStyleSheet(source?: string): CSSStyleSheet;
};

export function createStylelet(_doc: Document): Stylelet {
  const api = {
    version: 'stylelet-__VERSION__',

    createStyleSheet(source = ''): CSSStyleSheet {
      const sheet = new SelectletCSSStyleSheet();

      if (source !== '') sheet.replaceSync(source);

      return sheet;
    },
  };

  return api;
}
