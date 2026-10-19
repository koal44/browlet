import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

/** Translation keywords; absent and invalid values inherit, while an empty value enables translation. */
// https://html.spec.whatwg.org/multipage/dom.html#attr-translate
export const translateAttribute = new EnumeratedAttribute<'yes' | 'no' | 'inherit'>(
  [
    { state: 'yes', keywords: ['yes'] },
    { state: 'no', keywords: ['no'] },
  ],
  // SPEC_CLASH(translate-empty-value): Follow HTML/Chromium/WebKit; Firefox 151 inherits for an empty value.
  { missingValueDefault: 'inherit', invalidValueDefault: 'inherit', emptyValueDefault: 'yes' },
);
