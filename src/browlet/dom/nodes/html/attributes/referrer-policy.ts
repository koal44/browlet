import { referrerPolicyValues, type ReferrerPolicy } from '../../../../../fetch/index';

import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

/** One policy keyword; absent or invalid attributes defer policy selection to Fetch. */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#referrer-policy-attribute
export const referrerPolicyAttribute = new EnumeratedAttribute<ReferrerPolicy>(
  referrerPolicyValues.map((state) => ({ state, keywords: [state] })),
  { missingValueDefault: '', invalidValueDefault: '' },
);
