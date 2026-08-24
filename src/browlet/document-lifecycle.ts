import { Domlet } from '../domlet/domlet';
import { fireEvent } from '../domlet/events/event-target';
import {
  DocumentImpl, type DocumentLoadTimingInfo, type DomletDocument,
  type PermissionsPolicy,
} from '../domlet/nodes/document';
import { serializeURL } from '../url/url';
import { areSameOriginDomain } from './origin';
import { obtainSimilarOriginWindowAgent } from './agents';
import { BrowletBindings } from './bindings/browlet';
import { BrowsingContext } from './browsing-context';
import { CustomElementRegistryImpl } from './custom-element-registry';
import { setupWindowEnvironmentSettingsObject } from './environment';
import type {
  NavigationParams, NavigationRequest, NavigationResponse,
} from './navigation';
import { TopLevelTraversable } from './navigable';
import { createRealm, getRelevantRealm } from './realm';
import { WindowImpl } from './window';

export function createAndInitializeDocument(
  type: 'html' | 'xml',
  contentType: string,
  navigationParams: NavigationParams,
): DomletDocument {
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
  let bindings: BrowletBindings;
  let installBindings = false;
  if (
    DocumentImpl.isInitialAboutBlank(activeDocument) &&
    areSameOriginDomain(
      DocumentImpl.getOrigin(activeDocument),
      navigationParams.origin,
    )
  ) {
    const activeWindow = browsingContext.activeWindow;
    if (activeWindow === null) {
      throw new Error('Navigation browsing context has no active Window');
    }
    window = activeWindow;
    bindings = BrowletBindings.forRealm(getRelevantRealm(window));
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
    const realmExecutionContext = createRealm(agent, {
      createGlobalObject: () => window,
      createGlobalThisValue: () => browsingContext.windowProxy,
    });
    setupWindowEnvironmentSettingsObject(
      creationURL,
      realmExecutionContext,
      navigationParams.reservedEnvironment,
      creationURL,
      navigationParams.origin,
    );
    bindings = new BrowletBindings(realmExecutionContext.realm);
    installBindings = true;
  }

  const domlet = new Domlet(bindings.nodeFactory);
  const document = domlet.createDocument();
  const loadTimingInfo = createDocumentLoadTimingInfo(
    navigationParams.response.timingInfo.startTime,
  );

  DocumentImpl.setType(document, type);
  DocumentImpl.setContentType(document, contentType);
  DocumentImpl.setOrigin(document, navigationParams.origin);
  DocumentImpl.setBrowsingContext(document, browsingContext);
  DocumentImpl.setPolicyContainer(
    document,
    navigationParams.policyContainer,
  );
  DocumentImpl.setPermissionsPolicy(document, permissionsPolicy);
  DocumentImpl.setActiveSandboxingFlagSet(
    document,
    navigationParams.finalSandboxingFlagSet,
  );
  DocumentImpl.setOpenerPolicy(document, navigationParams.openerPolicy);
  DocumentImpl.setLoadTimingInfo(document, loadTimingInfo);
  DocumentImpl.setWasCreatedViaCrossOriginRedirects(
    document,
    navigationParams.response.hasCrossOriginRedirects,
  );
  DocumentImpl.setDuringLoadingNavigationID(document, navigationParams.id);
  DocumentImpl.setURL(document, creationURL);
  DocumentImpl.setCurrentDocumentReadiness(document, 'loading');
  DocumentImpl.setAboutBaseURL(document, navigationParams.aboutBaseURL);
  DocumentImpl.setAllowsDeclarativeShadowRoots(document, true);
  DocumentImpl.setCustomElementRegistry(
    document,
    new CustomElementRegistryImpl(),
  );

  WindowImpl.setAssociatedDocument(window, document);
  if (installBindings) {
    bindings.projectWindow(window);
  }
  initializeDocumentAncestry(document, navigationParams);
  initializeDocumentCSP(document);
  initializeDocumentReferrer(document, navigationParams.request);
  createNavigationTimingEntry(document, navigationParams);
  processDocumentResponseIntegrations(document, navigationParams);
  return document;
}

export function completelyFinishLoading(
  document: DomletDocument,
): void {
  const browsingContext = DocumentImpl.getBrowsingContext(document);
  if (!(browsingContext instanceof BrowsingContext)) {
    throw new Error('A completely loaded Document needs a browsing context');
  }
  const window = browsingContext.activeWindow;
  if (!window || WindowImpl.getAssociatedDocument(window) !== document) {
    throw new Error('Only an active Document can finish loading');
  }

  const now = performance.now();
  const timing = DocumentImpl.getLoadTimingInfo(document);
  timing.domInteractiveTime = now;
  timing.domContentLoadedEventStartTime = now;
  timing.domContentLoadedEventEndTime = now;
  timing.domCompleteTime = now;
  timing.loadEventStartTime = now;
  DocumentImpl.setCurrentDocumentReadiness(document, 'complete');
  DocumentImpl.markReadyForPostLoadTasks(document);
  fireEvent('load', window);
  timing.loadEventEndTime = performance.now();
  DocumentImpl.setCompletelyLoadedTime(document, Date.now());
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
  document: DomletDocument,
  navigationParams: NavigationParams,
): void {
  if (!(navigationParams.navigable instanceof TopLevelTraversable)) {
    throw new Error('Nested Document ancestry is not implemented');
  }
  // A top-level Document has no ancestor origins, so its iframe referrer
  // policy cannot affect either list.
  void navigationParams.iframeReferrerPolicy;
  DocumentImpl.setInternalAncestorOriginObjectsList(document, []);
  DocumentImpl.setAncestorOriginsList(document, []);
}

function initializeDocumentCSP(_document: DomletDocument): void {
  // TODO(Content Security Policy): Run CSP initialization once response policy
  // parsing and CSP lists are implemented.
}

function initializeDocumentReferrer(
  document: DomletDocument,
  request: NavigationRequest | null,
): void {
  if (request === null) return;
  DocumentImpl.setReferrer(
    document,
    request.referrer === 'no-referrer'
      ? ''
      : serializeURL(request.referrer),
  );
}

function createNavigationTimingEntry(
  _document: DomletDocument,
  navigationParams: NavigationParams,
): void {
  if (navigationParams.fetchController !== null) {
    throw new Error('Fetch timing extraction is not implemented');
  }
  // TODO(Navigation Timing): Create the PerformanceNavigationTiming entry.
  void navigationParams.navigationTimingType;
}

function processDocumentResponseIntegrations(
  document: DomletDocument,
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
