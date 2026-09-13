import { fireEvent } from '../dom/events/event-target';
import type {
  DocumentImpl, DocumentLoadTimingInfo,
} from '../dom/nodes/document';
import type { PermissionsPolicy } from './policy/permissions';
import { areSameOriginDomain } from '../../url/origin';
import { serializeURL } from '../../url/url';
import { obtainSimilarOriginWindowAgent } from '../scripting/agents';
import {
  createDocument, createStructuredClone, createWindowRealm, getRelevantRealm,
} from '../bindings';
import type { BrowsingContext } from './browsing-context';
import { CustomElementRegistryImpl } from '../html/custom-elements/registry';
import { setupWindowEnvironmentSettingsObject } from '../scripting/environment';
import type {
  NavigationParams, NavigationRequest, NavigationResponse,
} from './navigation/navigation';
import { TopLevelTraversable } from './navigable';
import { WindowImpl } from './window/window';
import { currentCoarsenedWallTime } from '../performance/high-resolution-time';

export function createAndInitializeDocument(
  type: 'html' | 'xml',
  contentType: string,
  navigationParams: NavigationParams,
): DocumentImpl {
  const browsingContext = obtainBrowsingContextForNavigationResponse(
    navigationParams,
  );
  const permissionsPolicy = createPermissionsPolicyFromResponse(
    navigationParams,
  );
  const creationURL = navigationParams.request?.currentURL ??
    navigationParams.response.url;
  const activeDocument = browsingContext.activeDocument;
  if (activeDocument === null) {
    throw new Error('Navigation browsing context has no active Document');
  }

  let window: WindowImpl;
  if (
    activeDocument.isInitialAboutBlank() &&
    areSameOriginDomain(
      activeDocument.getOrigin(),
      navigationParams.origin,
    )
  ) {
    const activeWindow = browsingContext.activeWindow;
    if (activeWindow === null) {
      throw new Error('Navigation browsing context has no active Window');
    }
    window = activeWindow;
  } else {
    const group = browsingContext.group;
    if (group === null) {
      throw new Error('Navigation browsing context has no group');
    }
    const requestsOAC = getRequestsOriginAgentCluster(
      navigationParams.response,
    );
    const agent = obtainSimilarOriginWindowAgent(
      navigationParams.origin,
      group,
      requestsOAC,
    );
    window = new WindowImpl(new URL(serializeURL(creationURL)));
    const realmExecutionContext = createWindowRealm(
      agent,
      window,
      getRelevantRealm(activeDocument),
    );
    setupWindowEnvironmentSettingsObject(
      creationURL,
      realmExecutionContext,
      navigationParams.reservedEnvironment,
      creationURL,
      navigationParams.origin,
      createStructuredClone(realmExecutionContext.realm),
    );
  }

  const document = createDocument(getRelevantRealm(window));
  const loadTimingInfo = createDocumentLoadTimingInfo(
    navigationParams.response.timingInfo.startTime,
  );

  document.setType(type);
  document.setContentType(contentType);
  document.setOrigin(navigationParams.origin);
  document.setBrowsingContext(browsingContext);
  document.setPolicyContainer(navigationParams.policyContainer);
  document.setPermissionsPolicy(permissionsPolicy);
  document.setActiveSandboxingFlagSet(navigationParams.finalSandboxingFlagSet);
  document.setOpenerPolicy(navigationParams.openerPolicy);
  document.setLoadTimingInfo(loadTimingInfo);
  document.setWasCreatedViaCrossOriginRedirects(
    navigationParams.response.hasCrossOriginRedirects,
  );
  document.setDuringLoadingNavigationID(navigationParams.id);
  document.setURL(creationURL);
  document.setCurrentDocumentReadiness('loading');
  document.setAboutBaseURL(navigationParams.aboutBaseURL);
  document.setAllowsDeclarativeShadowRoots(true);
  document.setCustomElementRegistry(new CustomElementRegistryImpl());

  window.setAssociatedDocument(document);
  initializeDocumentAncestry(document, navigationParams);
  initializeDocumentCSP(document);
  initializeDocumentReferrer(document, navigationParams.request);
  createNavigationTimingEntry(document, navigationParams);
  processDocumentResponseIntegrations(document, navigationParams);
  return document;
}

export function completelyFinishLoading(
  document: DocumentImpl,
): void {
  const browsingContext = document.getBrowsingContext();
  if (browsingContext === null) {
    throw new Error('A completely loaded Document needs a browsing context');
  }
  const window = browsingContext.activeWindow;
  if (!window || window.getAssociatedDocument() !== document) {
    throw new Error('Only an active Document can finish loading');
  }

  const realm = getRelevantRealm(window);
  const settings = realm.hostDefined;
  if (settings === null) {
    throw new Error('Active Window has no environment settings object');
  }
  const now = settings.timing.currentHighResolutionTime().toTimestamp();
  const timing = document.getLoadTimingInfo();
  timing.domInteractiveTime = now;
  timing.domContentLoadedEventStartTime = now;
  timing.domContentLoadedEventEndTime = now;
  timing.domCompleteTime = now;
  timing.loadEventStartTime = now;
  document.setCurrentDocumentReadiness('complete');
  document.markReadyForPostLoadTasks();
  fireEvent('load', window);
  timing.loadEventEndTime = settings.timing.currentHighResolutionTime().toTimestamp();
  document.setCompletelyLoadedTime(currentCoarsenedWallTime().milliseconds);
}

function obtainBrowsingContextForNavigationResponse(
  navigationParams: NavigationParams,
): BrowsingContext {
  if (navigationParams.coopEnforcementResult.needsBrowsingContextGroupSwitch) {
    throw new Error('COOP browsing-context group switching is not implemented');
  }
  const browsingContext = navigationParams.navigable.activeBrowsingContext;
  if (browsingContext === null) {
    throw new Error('Navigation requires an active browsing context');
  }
  return browsingContext;
}

function createPermissionsPolicyFromResponse(
  navigationParams: NavigationParams,
): PermissionsPolicy {
  if (getHeader(navigationParams.response, 'Permissions-Policy') !== null) {
    throw new Error('Permissions-Policy response parsing is not implemented');
  }
  if (!(navigationParams.navigable instanceof TopLevelTraversable)) {
    throw new Error('Container permissions-policy creation is not implemented');
  }
  return {};
}

function getRequestsOriginAgentCluster(
  response: NavigationResponse,
): boolean {
  if (getHeader(response, 'Origin-Agent-Cluster') !== null) {
    throw new Error('Origin-Agent-Cluster header parsing is not implemented');
  }
  return false;
}

function initializeDocumentAncestry(
  document: DocumentImpl,
  navigationParams: NavigationParams,
): void {
  if (!(navigationParams.navigable instanceof TopLevelTraversable)) {
    throw new Error('Nested Document ancestry is not implemented');
  }
  // A top-level Document has no ancestor origins, so its iframe referrer
  // policy cannot affect either list.
  void navigationParams.iframeReferrerPolicy;
  document.setInternalAncestorOriginObjectsList([]);
  document.setAncestorOriginsList([]);
}

function initializeDocumentCSP(_document: DocumentImpl): void {
  // TODO(Content Security Policy): Run CSP initialization once response policy
  // parsing and CSP lists are implemented.
}

function initializeDocumentReferrer(
  document: DocumentImpl,
  request: NavigationRequest | null,
): void {
  if (request === null) return;
  document.setReferrer(
    request.referrer === 'no-referrer'
      ? ''
      : serializeURL(request.referrer),
  );
}

function createNavigationTimingEntry(
  _document: DocumentImpl,
  navigationParams: NavigationParams,
): void {
  if (navigationParams.fetchController !== null) {
    throw new Error('Fetch timing extraction is not implemented');
  }
  // TODO(Navigation Timing): Create the PerformanceNavigationTiming entry.
  void navigationParams.navigationTimingType;
}

function processDocumentResponseIntegrations(
  document: DocumentImpl,
  navigationParams: NavigationParams,
): void {
  if (getHeader(navigationParams.response, 'Refresh') !== null) {
    throw new Error('Refresh response processing is not implemented');
  }
  if (getHeader(navigationParams.response, 'Link') !== null) {
    throw new Error('Link response processing is not implemented');
  }
  if (getHeader(navigationParams.response, 'Speculation-Rules') !== null) {
    throw new Error('Speculation-Rules response processing is not implemented');
  }
  navigationParams.commitEarlyHints?.(document);
  // TODO(Fetch): Potentially free deferred-fetch quota for this Document.
}

function getHeader(
  response: NavigationResponse,
  name: string,
): string | null {
  const lowerName = name.toLowerCase();
  for (const [headerName, value] of response.headers) {
    if (headerName.toLowerCase() === lowerName) return value;
  }
  return null;
}

function createDocumentLoadTimingInfo(
  navigationStartTime: DOMHighResTimeStamp,
): DocumentLoadTimingInfo {
  return {
    navigationStartTime,
    domInteractiveTime: 0,
    domContentLoadedEventStartTime: 0,
    domContentLoadedEventEndTime: 0,
    domCompleteTime: 0,
    loadEventStartTime: 0,
    loadEventEndTime: 0,
  };
}
