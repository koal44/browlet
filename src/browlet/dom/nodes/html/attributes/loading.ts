import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

/** Shared loading keywords; missing, empty, and invalid values select eager loading. */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attribute
export const loadingAttribute = new EnumeratedAttribute<LoadingState>(
  [
    { state: 'lazy', keywords: ['lazy'] },
    { state: 'eager', keywords: ['eager'] },
  ],
  { missingValueDefault: 'eager', invalidValueDefault: 'eager' },
);

/** Interpreted loading state, independent of the attribute's original spelling. */
export type LoadingState = 'lazy' | 'eager';
