import { fireEvent } from '../dom/events/event-target';
import type {
  DocumentImpl, DocumentLoadTimingInfo,
} from '../dom/nodes/document';
import type { PermissionsPolicy } from './policy/permissions';
import { areSameOriginDomain, serializeURL } from '../../url/index';
import { obtainSimilarOriginWindowAgent } from '../scripting/agents';
import { createDocument, getRelevantRealm } from '../bindings';
import type { BrowsingContext } from './browsing-context';
import { CustomElementRegistryImpl } from '../html/custom-elements/registry';
import { createWindowEnvironment } from '../bindings';
import type {
  NavigationParams, NavigationRequest, NavigationResponse,
} from './navigation/navigation';
import { TopLevelTraversable } from './navigable';
import type { WindowImpl } from './window/window';
import { currentCoarsenedWallTime } from '../performance/high-resolution-time';
import { InternalError } from '../../infra/internal-error';

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

  let window: WindowImpl;
  if (
    activeDocument.isInitialAboutBlank() &&
    areSameOriginDomain(
      activeDocument.getOrigin(),
      navigationParams.origin,
    )
  ) {
    window = browsingContext.activeWindow;
  } else {
    const group = browsingContext.group;
    if (group === null) {
      throw new InternalError('Navigation browsing context has no group');
    }
    const requestsOAC = getRequestsOriginAgentCluster(
      navigationParams.response,
    );
    const agent = obtainSimilarOriginWindowAgent(
      navigationParams.origin,
      group,
      requestsOAC,
    );
    window = createWindowEnvironment({
      agent, userAgent: group.userAgent,
      creationURL,
      origin: navigationParams.origin,
      parent: navigationParams.navigable.parent?.activeWindow ?? null,
      topLevelCreationURL: creationURL,
      topLevelOrigin: navigationParams.origin,
      reservedEnvironment: navigationParams.reservedEnvironment,
      previousRealm: getRelevantRealm(activeDocument),
    }).window;
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
    throw new InternalError('A completely loaded Document needs a browsing context');
  }
  const window = browsingContext.activeWindow;
  if (window.getAssociatedDocument() !== document) {
    throw new InternalError('Only an active Document can finish loading');
  }

  const realm = getRelevantRealm(window);
  const environment = realm.environment;
  const now = environment.timing.currentHighResolutionTime().toTimestamp();
  const timing = document.getLoadTimingInfo();
  timing.domInteractiveTime = now;
  timing.domContentLoadedEventStartTime = now;
  timing.domContentLoadedEventEndTime = now;
  timing.domCompleteTime = now;
  timing.loadEventStartTime = now;
  document.setCurrentDocumentReadiness('complete');
  document.markReadyForPostLoadTasks();
  fireEvent('load', window);
  timing.loadEventEndTime = environment.timing.currentHighResolutionTime().toTimestamp();
  document.setCompletelyLoadedTime(currentCoarsenedWallTime().milliseconds);
}

function obtainBrowsingContextForNavigationResponse(
  navigationParams: NavigationParams,
): BrowsingContext {
  if (navigationParams.coopEnforcementResult.needsBrowsingContextGroupSwitch) {
    throw new InternalError('COOP browsing-context group switching is not implemented');
  }
  const browsingContext = navigationParams.navigable.activeBrowsingContext;
  if (browsingContext === null) {
    throw new InternalError('Navigation requires an active browsing context');
  }
  return browsingContext;
}

function createPermissionsPolicyFromResponse(
  navigationParams: NavigationParams,
): PermissionsPolicy {
  if (getHeader(navigationParams.response, 'Permissions-Policy') !== null) {
    throw new InternalError('Permissions-Policy response parsing is not implemented');
  }
  if (!(navigationParams.navigable instanceof TopLevelTraversable)) {
    throw new InternalError('Container permissions-policy creation is not implemented');
  }
  return {};
}

function getRequestsOriginAgentCluster(
  response: NavigationResponse,
): boolean {
  if (getHeader(response, 'Origin-Agent-Cluster') !== null) {
    throw new InternalError('Origin-Agent-Cluster header parsing is not implemented');
  }
  return false;
}

function initializeDocumentAncestry(
  document: DocumentImpl,
  navigationParams: NavigationParams,
): void {
  if (!(navigationParams.navigable instanceof TopLevelTraversable)) {
    throw new InternalError('Nested Document ancestry is not implemented');
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
    request.referrer === null
      ? ''
      : serializeURL(request.referrer),
  );
}

function createNavigationTimingEntry(
  _document: DocumentImpl,
  navigationParams: NavigationParams,
): void {
  if (navigationParams.fetchController !== null) {
    throw new InternalError('Fetch timing extraction is not implemented');
  }
  // TODO(Navigation Timing): Create the PerformanceNavigationTiming entry.
  void navigationParams.navigationTimingType;
}

function processDocumentResponseIntegrations(
  document: DocumentImpl,
  navigationParams: NavigationParams,
): void {
  if (getHeader(navigationParams.response, 'Refresh') !== null) {
    throw new InternalError('Refresh response processing is not implemented');
  }
  if (getHeader(navigationParams.response, 'Link') !== null) {
    throw new InternalError('Link response processing is not implemented');
  }
  if (getHeader(navigationParams.response, 'Speculation-Rules') !== null) {
    throw new InternalError('Speculation-Rules response processing is not implemented');
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
