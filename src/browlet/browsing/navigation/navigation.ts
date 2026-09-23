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
import type { ReferrerPolicy } from '../../../fetch/index';
import { areSameOrigin, type Origin, obtainURLOrigin, urlsEqual, type URLRecord } from '../../../url/index';
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

/*
 * HTML's navigation params struct. Browlet's local route supplies a response
 * that has already been obtained, so the Fetch-owned request/controller slots
 * are present but null on this bounded path.
 */
export class NavigationParams {
  /** Identifier supplied by the navigation algorithm, when present. */
  id: string | null = null;
  /** Destination navigable that will present the response's document. */
  navigable: Navigable;
  /** Fetch request that produced the response, or null for Browlet's local route. */
  request: NavigationRequest | null = null;
  /** Response selected for document creation. */
  response: NavigationResponse;
  /** Fetch controller supplying navigation timing, when available. */
  fetchController: FetchController | null = null;
  /** Commit work retained from early hints after creating the document. */
  commitEarlyHints: ((document: DocumentImpl) => void) | null = null;
  /** Whether COOP requires changing the destination's browsing context group. */
  coopEnforcementResult: OpenerPolicyEnforcementResult = { needsBrowsingContextGroupSwitch: false };
  /** Environment reserved by Fetch before constructing the document's realm. */
  reservedEnvironment: EnvironmentRecord | null = null;
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

  constructor(navigable: Navigable, response: NavigationResponse) {
    this.navigable = navigable;
    this.response = response;
    this.origin = obtainURLOrigin(response.url);
    this.finalSandboxingFlagSet = new Set(this.obtainBrowsingContext().popupSandboxingFlagSet);
  }

  /** Prepare navigation from a response supplied by Browlet's local route. */
  static fromSource(navigable: Navigable, url: URLRecord, body: string): NavigationParams {
    const window = navigable.activeWindow;
    if (window === null) throw new InternalError('Navigation requires an active Window');
    const environment = getRelevantRealm(window).environment;
    return new NavigationParams(navigable, {
      url, body, headers: new Map(),
      timingInfo: {
        startTime: coarsenedSharedCurrentTime(environment.crossOriginIsolatedCapability).milliseconds,
      },
      hasCrossOriginRedirects: false,
    });
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
    if (this.getResponseHeader('Permissions-Policy') !== null) {
      throw new InternalError('Permissions-Policy response parsing is not implemented');
    }
    if (!(this.navigable instanceof TopLevelTraversable)) {
      throw new InternalError('Container permissions-policy creation is not implemented');
    }
    return createPermissionsPolicy();
  }

  /** Whether the response requests an origin-keyed agent cluster. */
  requestsOriginAgentCluster(): boolean {
    if (this.getResponseHeader('Origin-Agent-Cluster') !== null) {
      throw new InternalError('Origin-Agent-Cluster header parsing is not implemented');
    }
    return false;
  }

  /** Retain the new document and the navigation data needed to restore it. */
  createHistoryEntry(document: DocumentImpl): SessionHistoryEntry {
    const activeState = this.navigable.activeSessionHistoryEntry.documentState;
    const documentState = createDocumentState(document);
    documentState.initiatorOrigin = null;
    documentState.origin = this.origin;
    documentState.aboutBaseURL = this.aboutBaseURL;
    documentState.resource = this.response.body;
    documentState.everPopulated = true;
    documentState.navigableTargetName = activeState.navigableTargetName;
    return createSessionHistoryEntry(documentState);
  }

  /** Read a field from the provisional local-route response. */
  getResponseHeader(name: string): string | null {
    // PROVISIONAL: use FetchHeaders when navigation consumes FetchResponse.
    const lowerName = name.toLowerCase();
    for (const [headerName, value] of this.response.headers) {
      if (headerName.toLowerCase() === lowerName) return value;
    }
    return null;
  }
}

export type NavigationRequest = {
  currentURL: URLRecord;
  referrer: URLRecord | null;
};

// Fetch owns the controller's concrete state and timing extraction behavior.
export type FetchController = object;

export type NavigationResponse = {
  url: URLRecord;
  body: string;
  headers: ReadonlyMap<string, string>;
  timingInfo: { startTime: DOMHighResTimeStamp; };
  hasCrossOriginRedirects: boolean;
};

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
  const environment = realm.environment;
  environment.markExecutionReady();
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
