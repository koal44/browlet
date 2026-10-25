import { parseURL, type URLRecord } from '../url/index';
import {
  fetch, FetchRequest, type Destination, type FetchController, type FetchMode, type FetchResponse,
} from '../fetch/index';

import type { StyleletEnvironment } from './environment';
import { UrlValue } from './values/index';
import type { CSSRuleImpl, CSSStyleDeclarationImpl } from './cssom/index';

/** Start a CSS resource request in its owning environment; return null if its URL is invalid. */
// https://drafts.csswg.org/css-values-4/#fetch-a-style-resource
// SPEC_MISMATCH: fetch a style resource(urlValue, cssRuleOrDeclaration, destination, corsMode, processResponse) -> nothing
export function fetchStyleResource(
  urlValue: URLRecord | UrlValue, cssRuleOrDeclaration: CSSRuleImpl | CSSStyleDeclarationImpl,
  destination: Destination, corsMode: Extract<FetchMode, 'no-cors' | 'cors'>,
  env: StyleletEnvironment,
  processResponse: (response: FetchResponse, body: Uint8Array | null | 'failure') => void,
): FetchController | null {
  // https://drafts.csswg.org/css-values-4/#style-resource-base-url
  const baseURL = cssRuleOrDeclaration.baseURL ?? env.apiBaseURL;
  // https://drafts.csswg.org/css-values-4/#resolve-a-style-resource-url
  // Use UTF-8 regardless of the stylesheet's encoding; existing records need no parsing.
  const parsedURL = urlValue instanceof UrlValue
    ? parseURL(urlValue.repr.href, baseURL, 'UTF-8', env.userAgent).url
    : urlValue;
  if (parsedURL === null) return null;

  const request = new FetchRequest(parsedURL, env);
  request.client = env;
  request.destination = destination;
  request.mode = corsMode;
  request.origin = env.origin;
  request.credentialsMode = corsMode === 'no-cors' ? 'include' : 'same-origin';
  request.useURLCredentials = true;
  // FetchRequest represents the specification's "client" referrer as undefined.
  request.referrer = undefined;
  if (urlValue instanceof UrlValue) urlValue.applyRequestModifiers(request);

  // SPEC_GAP(css-style-resource-sheet): The algorithm never defines sheet and does not handle its absence in step 8.
  // Use the containing sheet; a rule or declaration without one has no origin-clean flag to test.
  const sheet = cssRuleOrDeclaration.parentStyleSheet;
  if (request.mode === 'cors' && sheet !== null) request.referrer = baseURL;
  if (sheet?.originClean) request.initiatorType = 'css';
  return fetch(request, { processResponseConsumeBody: processResponse }, env);
}
