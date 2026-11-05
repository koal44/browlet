import { InternalError, internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../../../infra/index';
import { utf8Encode } from '../../../encoding/index';
import { aboutBlankURL, areSameOrigin, copyURL, type Origin, obtainURLOrigin, type URLRecord } from '../../../url/index';
import {
  fetch, FetchBody, FetchResponse, isFetchScheme, isHTTPScheme, type FetchRequest, type FetchController, type ReferrerPolicy,
} from '../../../fetch/index';

import { coarsenedSharedCurrentTime, type DOMHighResTimeStamp } from '../../timing/index';
import { PolicyContainer, OpenerPolicy, SandboxingFlagSet } from '../policy/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import { HTMLIFrameElementImpl } from '../../dom/nodes/html/embedded/index';
import type { NavigationTimingType } from '../../performance/index';
import { DocumentState, type SessionHistoryEntry, type SourceSnapshotParams } from './state/index';
import { BrowletEnvironmentBase, type BrowletEnvironment } from '../../environment/index';

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
  /** Environment prepared before the destination realm; null for javascript:, srcdoc, and supplied responses. */
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

  /** Assemble a synthetic HTML response and inherited policies from a retained srcdoc resource. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-from-a-srcdoc-resource
  static fromSrcdoc(
    entry: SessionHistoryEntry, navigable: Navigable, targetSnapshotParams: TargetSnapshotParams,
    userInvolvement: UserNavigationInvolvement, navigationId: string | null, navigationTimingType: NavigationTimingType,
    env: BrowletEnvironment,
  ): NavigationParams {
    const state = entry.documentState;
    if (typeof state.resource !== 'string') throw new InternalError('Srcdoc navigation requires a string resource');
    const containerDocument = navigable.containerDocument;
    if (containerDocument === null) throw new InternalError('Srcdoc navigation requires a container Document');
    const responseURL = copyURL(aboutBlankURL);
    responseURL.path = 'srcdoc';
    const response = new FetchResponse();
    response.urlList.push(responseURL);
    response.headerList.append('Content-Type', 'text/html');
    response.body = FetchBody.fromBytes(utf8Encode(state.resource), env.userAgent.sandbox);
    const origin = BrowsingContext.determineOrigin(responseURL, targetSnapshotParams.sandboxingFlags, state.origin);
    const params = new NavigationParams(
      response, targetSnapshotParams.sandboxingFlags, coarsenedSharedCurrentTime(env.crossOriginIsolatedCapability).milliseconds,
    );
    params.id = navigationId;
    params.origin = origin;
    params.policyContainer = PolicyContainer.determineForNavigation(
      responseURL, state.historyPolicyContainer, null, containerDocument.policyContainer, null,
    );
    params.coopEnforcementResult = {
      url: responseURL, origin, openerPolicy: params.openerPolicy, needsBrowsingContextGroupSwitch: false,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false, currentContextIsNavigationSource: false,
    };
    params.iframeReferrerPolicy = targetSnapshotParams.iframeReferrerPolicy;
    params.navigationTimingType = navigationTimingType;
    params.aboutBaseURL = state.aboutBaseURL;
    params.userInvolvement = userInvolvement;
    // TODO(HTML #332 / §7.5.1): Resolve srcdoc cookie-URL inheritance before enabling the synthetic Document loader.
    // Request, controller, early hints, and reserved environment retain their specified null defaults.
    return params;
  }

  /** Obtain navigation parameters; null is failure, while undefined ends a superseded navigation. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching
  static fromFetch(
    entry: SessionHistoryEntry, navigable: Navigable, sourceSnapshotParams: SourceSnapshotParams,
    targetSnapshotParams: TargetSnapshotParams, cspNavigationType: 'form-submission' | 'other',
    userInvolvement: UserNavigationInvolvement, navigationId: string | null, navigationTimingType: NavigationTimingType,
    env: BrowletEnvironment,
  ): InternalPromise<NavigationParams | NonFetchSchemeNavigationParams | null | undefined> {
    // TODO(HTML §7.4.5): Assert parallel execution once the UserAgent exposes that execution state.
    // SPEC_CLASH(history-population-navigation-id): History owns "traversal" but supplies a null navigation ID.
    // Keep the captured cancellation owner separate from the ID retained in request/response/BiDi metadata.
    const expectedNavigation = navigationId === null && navigable.ongoingNavigation === 'traversal' ? 'traversal' : navigationId;
    const P = env.userAgent.HostPromise;
    const resultType = internalType<NavigationParams | NonFetchSchemeNavigationParams | null | undefined>();
    const fetchEnv = env.userAgent.sandbox;
    const request = entry.createNavigationRequest(navigable, sourceSnapshotParams, fetchEnv);
    request.isFormSubmission = cspNavigationType === 'form-submission';
    request.webDriverNavigationId = navigationId;
    const activeDocument = navigable.activeDocument!;
    let coopEnforcementResult: OpenerPolicyEnforcementResult = {
      url: activeDocument.url, origin: activeDocument.origin, openerPolicy: activeDocument.openerPolicy,
      currentContextIsNavigationSource: entry.documentState.initiatorOrigin !== null &&
        areSameOrigin(activeDocument.origin, entry.documentState.initiatorOrigin),
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
    };
    let currentURL = request.currentURL;
    let reservedEnv: BrowletEnvironmentBase | null = null;
    let fetchController: FetchController | null = null;
    let responseReady: InternalPromiseWithResolvers<FetchResponse | undefined> | null = null;
    let commitEarlyHints: ((document: DocumentImpl) => void) | null = null;
    let navigationChanged = false;
    const checkNavigation = () => {
      if (!navigationChanged && navigable.ongoingNavigation === expectedNavigation) return;
      navigationChanged = true;
      responseReady?.resolve(undefined);
    };
    const removeNavigationChange = navigable.addNavigationChangeSteps(checkNavigation);
    return P.try(fetchNextResponse, resultType).then((result) => {
      removeNavigationChange();
      // Successful params retain the live controller and response body for Document loading.
      if (!(result instanceof NavigationParams)) fetchController?.abort(fetchEnv);
      return result;
    }, (error) => {
      removeNavigationChange();
      fetchController?.abort(fetchEnv);
      throw error;
    });

    // One iteration of HTML's response loop. Fetch owns URL-list advancement and POST/body rewriting.
    function fetchNextResponse(): InternalPromise<NavigationParams | NonFetchSchemeNavigationParams | null | undefined> {
      if (reservedEnv !== null && !areSameOrigin(obtainURLOrigin(currentURL), obtainURLOrigin(reservedEnv.creationURL))) {
        reservedEnv.discard();
        reservedEnv = null;
        request.reservedClient = null;
        commitEarlyHints = null;
      }
      if (reservedEnv === null) {
        reservedEnv = BrowletEnvironmentBase.createForNavigation(navigable, currentURL);
        request.reservedClient = reservedEnv;
      }
      if (request.policyContainer.cspList?.isNavigationRequestBlocked(
        request, cspNavigationType, request.client, fetchController === null ? undefined : currentURL,
      )) return P.resolve(null, resultType);
      const responseEnv = reservedEnv;
      responseReady = P.withResolvers(internalType<FetchResponse | undefined>());
      if (fetchController === null) {
        fetchController = fetch(request, {
          useParallelQueue: true,
          processEarlyHintsResponse: (response) => {
            if (navigationChanged || responseReady!.isResolved || commitEarlyHints !== null) return;
            try { commitEarlyHints = reservedEnv!.processEarlyHintHeaders(response); }
            catch (error) { responseReady!.reject(error); }
          },
          processResponse: (response) => { responseReady!.resolve(response); },
        }, fetchEnv);
      } else {
        fetchController.processNextManualRedirect();
      }
      checkNavigation();
      // Step 21.7 waits on browser-owned completion; neither Window's script readiness gates it.
      return responseReady.promise.then((response) => {
        if (navigationChanged || response === undefined) return undefined;
        if (request.body === null) entry.documentState.resource = null;
        if (response.type === 'error') return null;
        const responsePolicyContainer = env.userAgent.createPolicyContainerFromResponse(response, responseEnv);
        const finalSandboxFlags = new SandboxingFlagSet(targetSnapshotParams.sandboxingFlags);
        for (const flag of responsePolicyContainer.cspList?.getSandboxingFlags() ?? []) finalSandboxFlags.add(flag);
        const responseURL = response.url!;
        const responseOrigin = BrowsingContext.determineOrigin(responseURL, finalSandboxFlags, entry.documentState.initiatorOrigin);
        let responseCOOP = new OpenerPolicy();
        if (navigable.isTopLevelTraversable) {
          responseCOOP = OpenerPolicy.obtain(response, responseEnv);
          coopEnforcementResult = navigable.activeBrowsingContext!.enforceResponseOpenerPolicy(
            responseURL, responseOrigin, responseCOOP, coopEnforcementResult, request.referrer,
          );
          if (finalSandboxFlags.size !== 0 && responseCOOP.value !== 'unsafe-none') return null;
        }
        if (navigable.parent !== null && isHTTPScheme(responseURL.scheme)) {
          const containerDocument = navigable.containerDocument;
          if (containerDocument === null) throw new InternalError('Child navigation requires a container Document');
          if (response.isBlockedByCORP(
            containerDocument.origin, containerDocument.policyContainer.embedderPolicy,
            request.destination, true, containerDocument.env,
          )) return null;
        }
        const locationURL = response.getLocationURL(currentURL.fragment, env.userAgent);
        // Fetch represents an invalid Location as null, and an absent Location as undefined.
        if (locationURL === null) return null;
        if (locationURL === undefined) {
          const policyContainer = PolicyContainer.determineForNavigation(
            responseURL, entry.documentState.historyPolicyContainer, sourceSnapshotParams.sourcePolicyContainer,
            null, responsePolicyContainer,
          );
          const container = navigable.container;
          if (container instanceof HTMLIFrameElementImpl && response.timingAllowPassed) {
            container.pendingResourceTimingStartTime = null;
          }
          const params = new NavigationParams(response, finalSandboxFlags, fetchController!.extractFullTimingInfo().startTime);
          params.id = navigationId;
          params.request = request;
          params.fetchController = fetchController;
          params.commitEarlyHints = commitEarlyHints;
          params.openerPolicy = responseCOOP;
          params.reservedEnv = responseEnv;
          params.origin = responseOrigin;
          params.policyContainer = policyContainer;
          params.coopEnforcementResult = coopEnforcementResult;
          params.navigationTimingType = navigationTimingType;
          params.aboutBaseURL = entry.documentState.aboutBaseURL;
          params.userInvolvement = userInvolvement;
          params.iframeReferrerPolicy = targetSnapshotParams.iframeReferrerPolicy;
          return params;
        }
        entry.classicHistoryAPIState = env.serializeForStorage(null);
        // A redirected traversal must detach this entry from the DocumentState shared by adjacent entries.
        const oldState = entry.documentState;
        const state = entry.documentState = new DocumentState();
        state.historyPolicyContainer = oldState.historyPolicyContainer?.clone() ?? null;
        state.requestReferrer = oldState.requestReferrer;
        state.requestReferrerPolicy = oldState.requestReferrerPolicy;
        state.initiatorOrigin = oldState.initiatorOrigin;
        state.origin = oldState.origin;
        state.aboutBaseURL = oldState.aboutBaseURL;
        state.resource = oldState.resource;
        state.everPopulated = oldState.everPopulated;
        state.navigableTargetName = oldState.navigableTargetName;
        if (!isHTTPScheme(locationURL.scheme)) {
          state.resource = null;
          if (isFetchScheme(locationURL.scheme)) return null;
          return {
            id: navigationId, url: locationURL, targetSnapshotSandboxingFlags: targetSnapshotParams.sandboxingFlags,
            sourceSnapshotHasTransientActivation: sourceSnapshotParams.hasTransientActivation,
            initiatorOrigin: responseOrigin, navigationTimingType, userInvolvement,
          };
        }
        currentURL = entry.url = locationURL;
        return fetchNextResponse();
      }, undefined, resultType);
    }
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
