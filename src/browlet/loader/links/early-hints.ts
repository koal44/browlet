import { obtainURLOrigin } from '../../../url/index';
import type { FetchResponse } from '../../../fetch/index';

import type { DocumentImpl } from '../../dom/nodes/index';
import type { BrowletEnvironmentBase } from '../../environment/index';

import { LinkProcessingOptions } from './options';

/** Prepare early hinted resources and return the steps that attach them to the incoming Document. */
// https://html.spec.whatwg.org/multipage/semantics.html#process-early-hint-headers
export function processEarlyHintHeaders(response: FetchResponse, env: BrowletEnvironmentBase): (document: DocumentImpl) => void {
  const earlyPolicyContainer = env.userAgent.createPolicyContainerFromResponse(response, env);
  // Policy-container creation requires the producing response URL, retained by Fetch.
  const baseURL = response.url!;
  const origin = obtainURLOrigin(baseURL);
  const earlyHints: LinkProcessingOptions[] = [];
  for (const { href, rel, attributes } of response.headerList.extractLinks()) {
    const options = new LinkProcessingOptions(baseURL, origin, earlyPolicyContainer, env);
    options.href = href;
    options.initiator = 'early-hint';
    // SPEC_CLASH(link-header-invalid-preload): HTML returns from the entire algorithm.
    // Browsers continue to later links; retain the commit callback even when a hint is invalid.
    if (!options.applyHeaderAttributes(attributes, rel)) continue;
    options.processHeader(rel);
    earlyHints.push(options);
  }
  return (document) => {
    for (const options of earlyHints) {
      if (options.onDocumentReady === null) options.document = document;
      else options.onDocumentReady(document);
    }
  };
}
