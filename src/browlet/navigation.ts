import {
  DocumentImpl, type DomletDocument, type OpenerPolicy,
  type PolicyContainer, type SandboxingFlagSet,
} from '../domlet/nodes/document';
import type { Origin } from '../url/origin';
import { obtainURLOrigin, urlsEqual, type URLRecord } from '../url/url';
import { areSameOrigin } from './origin';
import { BrowsingContext } from './browsing-context';
import type { Environment } from './environment';
import {
  TopLevelTraversable, type Navigable, type TraversableNavigable,
} from './navigable';
import { getRelevantRealm } from './realm';
import {
  createDocumentState, createSessionHistoryEntry,
  type SessionHistoryEntry,
} from './session-history';
import { setWindowProxyWindow } from './window-proxy';
import { WindowImpl } from './window';

/*
 * HTML's navigation params struct. Browlet's local route supplies a response
 * that has already been obtained, so the Fetch-owned request/controller slots
 * are present but null on this bounded path.
 */
export type NavigationParams = {
  id: string | null;
  navigable: Navigable;
  request: NavigationRequest | null;
  response: NavigationResponse;
  fetchController: FetchController | null;
  commitEarlyHints: ((document: DomletDocument) => void) | null;
  coopEnforcementResult: OpenerPolicyEnforcementResult;
  reservedEnvironment: Environment | null;
  origin: Origin;
  policyContainer: PolicyContainer;
  finalSandboxingFlagSet: SandboxingFlagSet;
  iframeReferrerPolicy: string;
  openerPolicy: OpenerPolicy;
  navigationTimingType: NavigationTimingType;
  aboutBaseURL: URLRecord | null;
  userInvolvement: UserNavigationInvolvement;
};

export type NavigationRequest = {
  currentURL: URLRecord;
  referrer: 'no-referrer' | URLRecord;
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

export function createNavigationParams(
  navigable: Navigable,
  url: URLRecord,
  body: string,
): NavigationParams {
  const browsingContext = navigable.activeBrowsingContext;
  if (browsingContext === null) {
    throw new Error('Navigation requires an active browsing context');
  }

  return {
    id: null,
    navigable,
    request: null,
    response: {
      url,
      body,
      headers: new Map(),
      // TODO(High Resolution Time): Use the shared monotonic clock and its
      // coarsening rules when that specification supplies Browlet's clock.
      timingInfo: { startTime: performance.now() },
      hasCrossOriginRedirects: false,
    },
    fetchController: null,
    commitEarlyHints: null,
    coopEnforcementResult: { needsBrowsingContextGroupSwitch: false },
    reservedEnvironment: null,
    origin: obtainURLOrigin(url),
    policyContainer: createPolicyContainer(),
    finalSandboxingFlagSet: new Set(
      browsingContext.popupSandboxingFlagSet,
    ),
    iframeReferrerPolicy: '',
    openerPolicy: createOpenerPolicy(),
    navigationTimingType: 'navigate',
    aboutBaseURL: null,
    userInvolvement: 'browser UI',
  };
}

export function resolveNavigationHistoryBehavior(
  navigable: Navigable,
  url: URLRecord,
  origin: NavigationParams['origin'],
): NavigationHistoryBehavior {
  const activeDocument = navigable.activeDocument;
  if (activeDocument === null) {
    throw new Error('Navigation requires an active Document');
  }

  const activeURL = navigable.activeSessionHistoryEntry.url;
  let historyHandling: NavigationHistoryBehavior =
    urlsEqual(url, activeURL) &&
    areSameOrigin(origin, DocumentImpl.getOrigin(activeDocument))
      ? 'replace'
      : 'push';

  if (
    url.scheme === 'javascript' ||
    DocumentImpl.isInitialAboutBlank(activeDocument)
  ) {
    historyHandling = 'replace';
  }
  return historyHandling;
}

export function createNavigationHistoryEntry(
  document: DomletDocument,
  navigationParams: NavigationParams,
): SessionHistoryEntry {
  const activeState = navigationParams.navigable
    .activeSessionHistoryEntry.documentState;
  const documentState = createDocumentState(document);
  documentState.initiatorOrigin = null;
  documentState.origin = navigationParams.origin;
  documentState.aboutBaseURL = navigationParams.aboutBaseURL;
  documentState.resource = navigationParams.response.body;
  documentState.everPopulated = true;
  documentState.navigableTargetName = activeState.navigableTargetName;
  return createSessionHistoryEntry(documentState);
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
    throw new Error('Navigation requires an active Document');
  }

  const browsingContext = DocumentImpl.getBrowsingContext(document);
  if (!(browsingContext instanceof BrowsingContext)) {
    throw new Error('Navigation Document has no Browlet browsing context');
  }
  if (
    navigable.parent === null &&
    !(
      browsingContext.isAuxiliary &&
      browsingContext.openerBrowsingContext !== null
    ) &&
    !areSameOrigin(
      DocumentImpl.getOrigin(document),
      DocumentImpl.getOrigin(activeDocument),
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
      throw new Error('Active history entry is not in session history');
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
  const browsingContext = DocumentImpl.getBrowsingContext(document);
  const realm = getRelevantRealm(document);
  if (!(browsingContext instanceof BrowsingContext)) {
    throw new Error('Navigation Document has no Browlet browsing context');
  }
  if (!WindowImpl.is(realm.globalObject)) {
    throw new Error('Navigation Document global object is not a Window');
  }

  navigable.currentSessionHistoryEntry = historyEntry;
  navigable.activeSessionHistoryEntry = historyEntry;
  traversable.currentSessionHistoryStep = targetStep;
  setWindowProxyWindow(browsingContext.windowProxy, realm.globalObject);
  const settings = realm.hostDefined;
  if (settings === null) throw new Error('Navigation Window has no settings');
  settings.markExecutionReady();
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
    throw new Error('Nested navigable history is not implemented');
  }
  return navigable;
}

function createPolicyContainer(): PolicyContainer {
  return {
    cspList: [],
    embedderPolicy: {},
    referrerPolicy: 'strict-origin-when-cross-origin',
    integrityPolicy: {},
    reportOnlyIntegrityPolicy: {},
  };
}

function createOpenerPolicy(): OpenerPolicy {
  return {
    value: 'unsafe-none',
    reportingEndpoint: null,
    reportOnlyValue: 'unsafe-none',
    reportOnlyReportingEndpoint: null,
  };
}
