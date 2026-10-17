import { InternalError } from '../../../infra/internal-error';
import { copyURL, type Origin, obtainURLOrigin, type URLRecord } from '../../../url/index';
import type { FetchResponse, FetchRequest, FetchController, ReferrerPolicy } from '../../../fetch/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import { PolicyContainer, OpenerPolicy, type SandboxingFlagSet } from '../policy/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import type { NavigationTimingType } from '../../performance/index';
import type { BrowletEnvironmentRecord } from '../../environment';

import type { UserNavigationInvolvement } from './navigable';

// Local routes supply an already-obtained response, leaving the Fetch request
// and controller slots null on that path.
// The destination navigable is the receiving object for navigation operations.
/** Carries a navigation response and the state needed to create its document. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigation-params
export class NavigationParams {
  /** Identifier supplied by the navigation algorithm, when present. */
  id: string | null = null;
  /** Fetch request that produced the response, or null for Browlet's local route. */
  request: FetchRequest | null = null;
  /** Response selected for document creation. */
  response: FetchResponse;
  /** Fetch controller supplying navigation timing, when available. */
  fetchController: FetchController | null = null;
  /** Commit work retained from early hints after creating the document. */
  commitEarlyHints: ((document: DocumentImpl) => void) | null = null;
  /** Whether COOP requires changing the destination's browsing context group. */
  coopEnforcementResult: OpenerPolicyEnforcementResult = { needsBrowsingContextGroupSwitch: false };
  /** Environment reserved by Fetch before constructing the document's realm. */
  reservedEnv: BrowletEnvironmentRecord | null = null;
  /** Origin selected for the new document. */
  origin: Origin;
  /** Response policies transferred to the new document. */
  policyContainer = new PolicyContainer();
  /** Sandbox restrictions selected for the navigation. */
  finalSandboxingFlagSet: SandboxingFlagSet;
  /** Container referrer policy used when initializing document ancestry. */
  iframeReferrerPolicy: ReferrerPolicy = '';
  /** Cross-origin opener policy assigned to the new document. */
  openerPolicy = new OpenerPolicy();
  /** Kind of navigation recorded by Navigation Timing. */
  navigationTimingType: NavigationTimingType = 'navigate';
  /** Inherited base for an about:blank or srcdoc document, when applicable. */
  aboutBaseURL: URLRecord | null = null;
  /** Cookie lookup URL selected for the destination document. */
  // https://github.com/whatwg/html/issues/332
  // TODO: local-URL navigation must capture the initiator's (blank) or embedder's (srcdoc) cookie URL.
  cookieURL: URLRecord;
  /** User involvement passed to history finalization. */
  userInvolvement: UserNavigationInvolvement = 'browser UI';
  /** Start of a supplied-response navigation, used when no Fetch controller exists. */
  #startTime: DOMHighResTimeStamp;

  /** Retain response metadata and the destination state captured for this navigation. */
  constructor(
    response: FetchResponse,
    finalSandboxingFlagSet: SandboxingFlagSet, startTime: DOMHighResTimeStamp,
  ) {
    this.response = response;
    this.origin = obtainURLOrigin(this.url);
    this.cookieURL = copyURL(this.url);
    this.finalSandboxingFlagSet = finalSandboxingFlagSet;
    this.#startTime = startTime;
  }

  /** Final response URL, required when a response is selected for navigation. */
  get url(): URLRecord {
    const url = this.response.url;
    if (url === null) throw new InternalError('Navigation requires a response URL');
    return url;
  }

  /** Fetch start time, or the start of Browlet's supplied-response navigation. */
  get startTime(): DOMHighResTimeStamp {
    // SPEC_CLASH(html-navigation-response-timing): HTML still reads response.timingInfo;
    // Fetch retains full timing on its controller. Use that existing owner.
    return this.fetchController?.extractFullTimingInfo().startTime ?? this.#startTime;
  }

  /** Whether the response requests an origin-keyed agent cluster. */
  requestsOriginAgentCluster(): boolean {
    if (this.response.headerList.get('Origin-Agent-Cluster') !== null) {
      throw new InternalError('Origin-Agent-Cluster header parsing is not implemented');
    }
    return false;
  }
}

export type OpenerPolicyEnforcementResult = {
  needsBrowsingContextGroupSwitch: boolean;
};
