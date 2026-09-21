import { defineEnumeration } from '../../../web-idl/index';

// Referrer Policy supplies this declaration to Fetch's Request API.
// https://w3c.github.io/webappsec-referrer-policy/#referrer-policies
/*
 * enum ReferrerPolicy {
 *   "",
 *   "no-referrer",
 *   "no-referrer-when-downgrade",
 *   "same-origin",
 *   "origin",
 *   "strict-origin",
 *   "origin-when-cross-origin",
 *   "strict-origin-when-cross-origin",
 *   "unsafe-url"
 * };
 */
export const referrerPolicyIDL = defineEnumeration({
  name: 'ReferrerPolicy',
  values: [
    '', 'no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin',
    'strict-origin', 'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
  ],
});
