import type { DocumentImpl } from '../../dom/nodes/document';
import {
  createPolicyContainer, type PolicyContainer,
} from '../policy/container';
import {
  createOpenerPolicy, type OpenerPolicy,
} from '../policy/coop';
import type { SandboxingFlagSet } from '../policy/sandbox';
import type { BrowsingContext } from '../browsing-context';
import { createPermissionsPolicy, type PermissionsPolicy } from '../policy/permissions';
import { FetchResponse, type FetchRequest, type FetchController, type ReferrerPolicy } from '../../../fetch/index';
import { areSameOrigin, createOpaqueOrigin, type Origin, obtainURLOrigin, urlsEqual, type URLRecord } from '../../../url/index';
import { CSPList } from '../policy/csp/list';
import { getRelevantRealm, retargetWindowProxy } from '../../bindings';
import type { EnvironmentRecord } from '../../scripting/environment';
import {
  TopLevelTraversable, type Navigable, type TraversableNavigable,
} from '../navigable';
import {
  createDocumentState, createSessionHistoryEntry,
  type SessionHistoryEntry,
} from './session-history';
import {
  coarsenedSharedCurrentTime,
} from '../../performance/high-resolution-time';
import { InternalError } from '../../../infra/internal-error';

// Local routes supply an already-obtained response, leaving the Fetch request
// and controller slots null on that path.
/** Carries a navigation response and the state needed to create its document. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigation-params
export class NavigationParams {
  /** Identifier supplied by the navigation algorithm, when present. */
  id: string | null = null;
  /** Destination navigable that will present the response's document. */
  navigable: Navigable;
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
  reservedEnv: EnvironmentRecord | null = null;
  /** Origin selected for the new document. */
  origin: Origin;
  /** Response policies transferred to the new document. */
  policyContainer: PolicyContainer = createPolicyContainer();
  /** Sandbox restrictions selected for the navigation. */
  finalSandboxingFlagSet: SandboxingFlagSet;
  /** Container referrer policy used when initializing document ancestry. */
  iframeReferrerPolicy: ReferrerPolicy = '';
  /** Cross-origin opener policy assigned to the new document. */
  openerPolicy: OpenerPolicy = createOpenerPolicy();
  /** Kind of navigation recorded by Navigation Timing. */
  navigationTimingType: NavigationTimingType = 'navigate';
  /** Inherited base for an about:blank or srcdoc document, when applicable. */
  aboutBaseURL: URLRecord | null = null;
  /** User involvement passed to history finalization. */
  userInvolvement: UserNavigationInvolvement = 'browser UI';
  /** Start of a supplied-response navigation, used when no Fetch controller exists. */
  #startTime: DOMHighResTimeStamp;

  constructor(navigable: Navigable, response: FetchResponse) {
    this.navigable = navigable;
    this.response = response;
    this.origin = obtainURLOrigin(this.url);
    const context = this.obtainBrowsingContext();
    this.finalSandboxingFlagSet = new Set(context.popupSandboxingFlagSet);
    const env = getRelevantRealm(context.activeWindow).env;
    this.#startTime = coarsenedSharedCurrentTime(env.crossOriginIsolatedCapability).milliseconds;
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

  /** Prepare response-delivered CSP and sandbox restrictions before selecting the document's realm. */
  static fromResponse(navigable: Navigable, response: FetchResponse): NavigationParams {
    const params = new NavigationParams(navigable, response);
    params.policyContainer.cspList = CSPList.parse(response);
    for (const flag of params.policyContainer.cspList.getSandboxingFlags()) params.finalSandboxingFlagSet.add(flag);
    if (params.finalSandboxingFlagSet.has('sandboxed-origin')) params.origin = createOpaqueOrigin();
    // Full navigation policy-container selection (history/local URL inheritance,
    // COEP, referrer, and integrity delivery) remains with the Fetch-backed loader.
    return params;
  }

  /** Prepare the response metadata for Browlet's synchronous source route. */
  static fromSource(navigable: Navigable, url: URLRecord): NavigationParams {
    const response = new FetchResponse();
    response.urlList.push(url);
    // The local route supplies text directly to the parser and session history;
    // it does not create a Fetch body stream in the departing document's realm.
    return NavigationParams.fromResponse(navigable, response);
  }

  /** Select the browsing context in which this response will create a document. */
  obtainBrowsingContext(): BrowsingContext {
    if (this.coopEnforcementResult.needsBrowsingContextGroupSwitch) {
      throw new InternalError('COOP browsing-context group switching is not implemented');
    }
    const browsingContext = this.navigable.activeBrowsingContext;
    if (browsingContext === null) throw new InternalError('Navigation requires an active browsing context');
    return browsingContext;
  }

  /** Combine response and container permissions for the destination document. */
  createPermissionsPolicy(): PermissionsPolicy {
    if (this.response.headerList.get('Permissions-Policy') !== null) {
      throw new InternalError('Permissions-Policy response parsing is not implemented');
    }
    if (!(this.navigable instanceof TopLevelTraversable)) {
      throw new InternalError('Container permissions-policy creation is not implemented');
    }
    return createPermissionsPolicy();
  }

  /** Whether the response requests an origin-keyed agent cluster. */
  requestsOriginAgentCluster(): boolean {
    if (this.response.headerList.get('Origin-Agent-Cluster') !== null) {
      throw new InternalError('Origin-Agent-Cluster header parsing is not implemented');
    }
    return false;
  }

  /** Retain the new document and the navigation data needed to restore it. */
  createHistoryEntry(document: DocumentImpl, source: string | null = null): SessionHistoryEntry {
    const activeState = this.navigable.activeSessionHistoryEntry.documentState;
    const documentState = createDocumentState(document);
    documentState.initiatorOrigin = null;
    documentState.origin = this.origin;
    documentState.aboutBaseURL = this.aboutBaseURL;
    documentState.resource = source;
    documentState.everPopulated = true;
    documentState.navigableTargetName = activeState.navigableTargetName;
    return createSessionHistoryEntry(documentState);
  }
}

export type OpenerPolicyEnforcementResult = {
  needsBrowsingContextGroupSwitch: boolean;
};

export type NavigationHistoryBehavior = 'push' | 'replace';

export type NavigationTimingType = 'navigate' | 'reload' | 'back_forward';

export type UserNavigationInvolvement = 'none' | 'activation' | 'browser UI';

export function resolveNavigationHistoryBehavior(
  navigable: Navigable,
  url: URLRecord,
  origin: NavigationParams['origin'],
): NavigationHistoryBehavior {
  const activeDocument = navigable.activeDocument;
  if (activeDocument === null) {
    throw new InternalError('Navigation requires an active Document');
  }

  const activeURL = navigable.activeSessionHistoryEntry.url;
  let historyHandling: NavigationHistoryBehavior =
    urlsEqual(url, activeURL) &&
    areSameOrigin(origin, activeDocument.origin)
      ? 'replace'
      : 'push';

  if (
    url.scheme === 'javascript' ||
    activeDocument.isInitialAboutBlank
  ) {
    historyHandling = 'replace';
  }
  return historyHandling;
}

export function finalizeCrossDocumentNavigation(
  navigable: Navigable,
  historyHandling: NavigationHistoryBehavior,
  userInvolvement: UserNavigationInvolvement,
  historyEntry: SessionHistoryEntry,
): void {
  navigable.isDelayingLoadEvents = false;
  const document = historyEntry.documentState.document;
  if (document === null) return;
  const activeDocument = navigable.activeDocument;
  if (activeDocument === null) {
    throw new InternalError('Navigation requires an active Document');
  }

  const browsingContext = document.browsingContext;
  if (browsingContext === null) {
    throw new InternalError('Navigation Document has no browsing context');
  }
  if (
    navigable.parent === null &&
    !(
      browsingContext.isAuxiliary &&
      browsingContext.openerBrowsingContext !== null
    ) &&
    !areSameOrigin(
      document.origin,
      activeDocument.origin,
    )
  ) {
    historyEntry.documentState.navigableTargetName = '';
  }

  const traversable = requireTopLevelTraversable(navigable);
  const targetEntries = traversable.sessionHistoryEntries;
  let targetStep: number;
  if (historyHandling === 'push') {
    clearForwardSessionHistory(traversable);
    targetStep = traversable.currentSessionHistoryStep + 1;
    historyEntry.step = targetStep;
    targetEntries.push(historyEntry);
  } else {
    const entryToReplace = navigable.activeSessionHistoryEntry;
    const index = targetEntries.indexOf(entryToReplace);
    if (index < 0) {
      throw new InternalError('Active history entry is not in session history');
    }
    targetEntries[index] = historyEntry;
    historyEntry.step = entryToReplace.step;
    targetStep = traversable.currentSessionHistoryStep;
  }

  applyPushOrReplaceHistoryStep(
    traversable,
    navigable,
    targetStep,
    historyEntry,
  );
  void userInvolvement;
}

function applyPushOrReplaceHistoryStep(
  traversable: TraversableNavigable,
  navigable: Navigable,
  targetStep: number,
  historyEntry: SessionHistoryEntry,
): void {
  const document = historyEntry.documentState.document;
  if (document === null) return;
  const browsingContext = document.browsingContext;
  const realm = getRelevantRealm(document);
  if (browsingContext === null) {
    throw new InternalError('Navigation Document has no browsing context');
  }
  const window = realm.windowImplementation;

  navigable.currentSessionHistoryEntry = historyEntry;
  navigable.activeSessionHistoryEntry = historyEntry;
  traversable.currentSessionHistoryStep = targetStep;
  retargetWindowProxy(
    browsingContext.windowProxy,
    window,
  );
  const env = realm.env;
  env.markExecutionReady();
}

function clearForwardSessionHistory(
  traversable: TraversableNavigable,
): void {
  const firstForwardEntry = traversable.sessionHistoryEntries.findIndex(
    (entry) => entry.step !== 'pending' &&
      entry.step > traversable.currentSessionHistoryStep,
  );
  if (firstForwardEntry >= 0) {
    traversable.sessionHistoryEntries.splice(firstForwardEntry);
  }
}

function requireTopLevelTraversable(
  navigable: Navigable,
): TopLevelTraversable {
  if (!(navigable instanceof TopLevelTraversable)) {
    throw new InternalError('Nested navigable history is not implemented');
  }
  return navigable;
}
