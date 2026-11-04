import { InternalError } from '../../../infra/index';
import { copyURL, type Origin, obtainURLOrigin, type URLRecord } from '../../../url/index';
import type { FetchResponse, FetchRequest, FetchController, ReferrerPolicy } from '../../../fetch/index';

import { coarsenedSharedCurrentTime, type DOMHighResTimeStamp } from '../../timing/index';
import { PolicyContainer, OpenerPolicy, SandboxingFlagSet } from '../policy/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import type { NavigationTimingType } from '../../performance/index';
import type { DocumentState } from './state/index';
import type { BrowletEnvironment, BrowletEnvironmentBase } from '../../environment/index';

import { BrowsingContext } from './browsing-context';
import type { Navigable, UserNavigationInvolvement } from './navigable';

// Local routes and javascript: replacements supply an already-obtained response,
// leaving the Fetch request and controller slots null on those paths.
// The destination navigable is the receiving object for navigation operations.
// TODO(HTML §7.4.5): Replace staged local-response preparation with complete inputs before Document creation.
// HTML's final navigation params are not mutated after assembly.
/** Carries a navigation response and the state needed to create its document. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigation-params
export class NavigationParams {
  /** Identifier supplied by the navigation algorithm, when present. */
  // TODO(HTML §7.4.5): Fetch-created params must retain the ID; javascript: and supplied responses already supply it.
  id: string | null = null;
  /** Fetch request that produced the response, or null for a synthetic response or Browlet's local route. */
  request: FetchRequest | null = null;
  /** Response selected for document creation. */
  response: FetchResponse;
  /** Fetch controller supplying navigation timing, when available. */
  fetchController: FetchController | null = null;
  /** Commit work retained from early hints after creating the document. */
  commitEarlyHints: ((document: DocumentImpl) => void) | null = null;
  /** Accumulated COOP response checks, or null before response policy preparation. */
  coopEnforcementResult: OpenerPolicyEnforcementResult | null = null;
  /** Environment prepared before the destination realm; null for javascript: and HTML's supplied-response path. */
  reservedEnv: BrowletEnvironmentBase | null = null;
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
    // TODO(HTML §7.4): Supply the navigation source origin to BrowsingContext.determineOrigin()
    // for about:blank/srcdoc inheritance; this provisional response path has no source snapshot yet.
    this.origin = obtainURLOrigin(this.url);
    this.cookieURL = copyURL(this.url);
    this.finalSandboxingFlagSet = finalSandboxingFlagSet;
    this.#startTime = startTime;
  }

  /** Assemble the supplied-response branch of navigate, retaining null Fetch and reserved-environment slots. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate
  static fromSuppliedResponse(
    response: FetchResponse, navigable: Navigable, sourceDocument: DocumentImpl | null,
    targetSnapshotParams: TargetSnapshotParams, documentState: DocumentState,
    navigationId: string, userInvolvement: UserNavigationInvolvement, env: BrowletEnvironment,
  ): NavigationParams {
    const responseURL = response.url;
    if (responseURL === null) throw new InternalError('Navigation requires a response URL');
    const sourcePolicyContainer = sourceDocument?.policyContainer.clone() ?? null;
    // SPEC_GAP(supplied-response-parent-policy): HTML dereferences a container even for top-level multipart responses;
    // pass null for their absent parent policy, as the policy-selection operation permits.
    const policyContainer = PolicyContainer.determineForNavigation(
      responseURL, null, sourcePolicyContainer, navigable.containerDocument?.policyContainer ?? null, null,
    );
    const finalSandboxFlags = new SandboxingFlagSet(targetSnapshotParams.sandboxingFlags);
    for (const flag of policyContainer.cspList?.getSandboxingFlags() ?? []) finalSandboxFlags.add(flag);
    const origin = BrowsingContext.determineOrigin(responseURL, finalSandboxFlags, documentState.initiatorOrigin);
    const openerPolicy = new OpenerPolicy();
    const params = new NavigationParams(
      response, finalSandboxFlags, coarsenedSharedCurrentTime(env.crossOriginIsolatedCapability).milliseconds,
    );
    params.id = navigationId;
    params.origin = origin;
    params.policyContainer = policyContainer;
    params.iframeReferrerPolicy = targetSnapshotParams.iframeReferrerPolicy;
    params.openerPolicy = openerPolicy;
    params.coopEnforcementResult = {
      url: responseURL, origin, openerPolicy, needsBrowsingContextGroupSwitch: false,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false, currentContextIsNavigationSource: false,
    };
    params.aboutBaseURL = documentState.aboutBaseURL;
    params.userInvolvement = userInvolvement;
    return params;
  }

  /** Final response URL, required when a response is selected for navigation. */
  get url(): URLRecord {
    // TODO(HTML §7.4.5): Fetch failures need the separate error-Document path before successful-response consumption.
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

  /** Whether the response requests origin keying; navigation applies the secure-context gate. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object
  requestsOriginAgentCluster(): boolean {
    const item = this.response.headerList.getStructuredFieldValue('Origin-Agent-Cluster', 'item');
    return item?.bareItem.type === 'boolean' && item.bareItem.value;
  }
}

/** Inputs for a non-fetch URL; the receiving Navigable supplies the destination. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#non-fetch-scheme-navigation-params
export type NonFetchSchemeNavigationParams = {
  /** Navigation identity retained through external or inline handling. */
  id: string | null;
  /** Destination URL, including a non-fetch redirect target. */
  url: URLRecord;
  /** Target restrictions captured before navigation callbacks or loading. */
  targetSnapshotSandboxingFlags: SandboxingFlagSet;
  /** Source activation captured when navigation began, not the target's current activation. */
  sourceSnapshotHasTransientActivation: boolean;
  /** Initiating origin; after a redirect, the origin of the last fetch-scheme response. */
  initiatorOrigin: Origin;
  /** Timing category for an inline Document, if one is created. */
  navigationTimingType: NavigationTimingType;
  /** User involvement used when selecting the inline Document's browsing context. */
  userInvolvement: UserNavigationInvolvement;
};

/** Captured target restrictions retained while navigation obtains its response. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#target-snapshot-params
export type TargetSnapshotParams = {
  /** Container and inherited sandbox restrictions captured before loading. */
  sandboxingFlags: SandboxingFlagSet;
  /** Iframe referrer-policy keyword used for the new Document's ancestry. */
  iframeReferrerPolicy: ReferrerPolicy;
};

// https://html.spec.whatwg.org/multipage/browsers.html#coop-enforcement-result
export type OpenerPolicyEnforcementResult = {
  needsBrowsingContextGroupSwitch: boolean;
  wouldNeedBrowsingContextGroupSwitchDueToReportOnly: boolean;
  url: URLRecord;
  origin: Origin;
  openerPolicy: OpenerPolicy;
  currentContextIsNavigationSource: boolean;
};
