import { type SelectletCaps, type SelectletErrorOptions } from '../selectlet';
import { SelectletCSSStyleSheet } from './cssom/stylesheet';

export type Stylelet = {
  version: string;
  createStyleSheet(source?: string): CSSStyleSheet;
};

export type StyleletOptions = {
  caps?: SelectletCaps;
  errors?: SelectletErrorOptions;
};

export function createStylelet(_doc: Document, _opts: StyleletOptions = {}): Stylelet {
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
