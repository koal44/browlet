import type { RequestCredentials } from '../../../../../fetch/index';

import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

/** Shared crossorigin keywords and defaults; every attribute value maps to a state. */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attribute
export const corsSettingsAttribute = new EnumeratedAttribute<CORSSettingsState>(
  [
    { state: 'no-cors', keywords: [] },
    { state: 'anonymous', keywords: ['anonymous'] },
    { state: 'use-credentials', keywords: ['use-credentials'] },
  ],
  {
    missingValueDefault: 'no-cors',
    emptyValueDefault: 'anonymous',
    invalidValueDefault: 'anonymous',
  }
);

/**
 * Credentials for an always-CORS fetch, such as a module script.
 * Unlike potential-CORS requests, an absent attribute selects same-origin credentials.
 */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attribute-credentials-mode
export function getCORSSettingsCredentialsMode(state: CORSSettingsState): RequestCredentials {
  return state === 'use-credentials' ? 'include' : 'same-origin';
}

/** Interpreted crossorigin state, distinct from raw text and the nullable reflected keyword. */
export type CORSSettingsState = 'no-cors' | 'anonymous' | 'use-credentials';
