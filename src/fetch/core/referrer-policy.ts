import { defineEnumeration } from '../../web-idl/core/index';

/** The complete referrer-policy vocabulary, including the unspecified policy. */
// https://w3c.github.io/webappsec-referrer-policy/#referrer-policies
export const referrerPolicyValues = [
  '', 'no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin',
  'strict-origin', 'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
] as const;

/** An empty value leaves the policy unspecified so the applicable fallback can supply it. */
export type ReferrerPolicy = typeof referrerPolicyValues[number];

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
  values: [...referrerPolicyValues],
});
