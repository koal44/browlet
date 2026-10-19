import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

/** Direction keywords; null represents HTML's Undefined state for absent or invalid values. */
// https://html.spec.whatwg.org/multipage/dom.html#attr-dir
export const dirAttribute = new EnumeratedAttribute([
  { state: 'ltr', keywords: ['ltr'] },
  { state: 'rtl', keywords: ['rtl'] },
  { state: 'auto', keywords: ['auto'] },
] as const);
