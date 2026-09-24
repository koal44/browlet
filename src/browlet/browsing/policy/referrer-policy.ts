import { isLocalScheme, type FetchRequest, type FetchResponse, type ReferrerPolicy } from '../../../fetch/index';
import { asciiLower } from '../../../infra/ascii';
import { InternalError } from '../../../infra/internal-error';
import { surroundingTabOrSpacePattern } from '../../../infra/patterns';
import { areSameOrigin, copyURL, obtainURLOrigin, serializeURL, type URLRecord } from '../../../url/index';
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
  ] satisfies ReferrerPolicy[],
});

/** Returns the last recognized policy, or an empty string for an absent or malformed header. */
// https://w3c.github.io/webappsec-referrer-policy/#parse-referrer-policy-from-header
export function parseReferrerPolicyFromHeader(response: FetchResponse): ReferrerPolicy {
  const tokens = response.headerList.extractValues('Referrer-Policy', parseReferrerPolicyTokens, true);
  if (tokens === undefined || tokens === null) return '';
  let policy: ReferrerPolicy = '';
  for (const token of tokens) {
    if (token !== '' && referrerPolicyIDL.values.includes(token)) policy = token as ReferrerPolicy;
  }
  return policy;
}

/** Updates the request from a redirect response, preserving its policy when the header supplies none. */
// https://w3c.github.io/webappsec-referrer-policy/#set-requests-referrer-policy-on-redirect
export function setRequestReferrerPolicyOnRedirect(request: FetchRequest, response: FetchResponse): void {
  const policy = parseReferrerPolicyFromHeader(response);
  if (policy !== '') request.referrerPolicy = policy;
}

/** Selects a referrer using the resolved policy, or null to omit it, without changing the source URL. */
// https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
export function determineRequestReferrer(request: FetchRequest): URLRecord | null {
  const source = request.referrer === undefined
    ? request.client?.getReferrerSource() ?? null
    : request.referrer;
  if (source === null) return null;

  let referrerURL = stripURLForReferrer(source);
  const referrerOrigin = stripURLForReferrer(source, true);
  if (referrerURL === null || referrerOrigin === null) return null;
  if (serializeURL(referrerURL).length > 4096) referrerURL = referrerOrigin;

  const sameOrigin = areSameOrigin(obtainURLOrigin(referrerURL), obtainURLOrigin(request.currentURL));
  const downgrade = request.userAgent.isURLPotentiallyTrustworthy(referrerURL) &&
    !request.userAgent.isURLPotentiallyTrustworthy(request.currentURL);
  switch (request.referrerPolicy) {
    case 'no-referrer': return null;
    case 'origin': return referrerOrigin;
    case 'unsafe-url': return referrerURL;
    case 'strict-origin': return downgrade ? null : referrerOrigin;
    case 'strict-origin-when-cross-origin':
      return sameOrigin ? referrerURL : downgrade ? null : referrerOrigin;
    case 'same-origin': return sameOrigin ? referrerURL : null;
    case 'origin-when-cross-origin': return sameOrigin ? referrerURL : referrerOrigin;
    case 'no-referrer-when-downgrade': return downgrade ? null : referrerURL;
    default: throw new InternalError('Referrer calculation requires a resolved referrer policy');
  }
}

/** Omits local URLs with null; otherwise copies without credentials or fragment, optionally as an origin. */
// https://w3c.github.io/webappsec-referrer-policy/#strip-url
export function stripURLForReferrer(url: URLRecord, originOnly = false): URLRecord | null {
  if (isLocalScheme(url.scheme)) return null;
  // The source belongs to a Document or request; full and origin-only referrers need independent copies.
  const referrer = copyURL(url);
  referrer.username = '';
  referrer.password = '';
  referrer.fragment = null;
  if (originOnly) {
    referrer.path = [''];
    referrer.query = null;
  }
  return referrer;
}

const invalidReferrerPolicyToken = /[^A-Za-z-]/;

// https://w3c.github.io/webappsec-referrer-policy/#referrer-policy-header
// Unknown extension tokens are valid; malformed tokens invalidate the whole field, as in Chromium.
function parseReferrerPolicyTokens(value: string): string[] | null {
  const tokens = value.split(',');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.replace(surroundingTabOrSpacePattern, '');
    if (invalidReferrerPolicyToken.test(token)) return null;
    // ABNF literals are ASCII case-insensitive. Empty list members are ignored by the caller.
    tokens[i] = asciiLower(token);
  }
  return tokens;
}
