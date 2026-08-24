import { createDocument } from '../parser/document-construction';
import { fireEvent } from '../dom/events/event-target';
import {
  DocumentImpl, type DocumentLoadTimingInfo, type PermissionsPolicy,
} from '../dom/nodes/document';
import { serializeURL } from '../../url/url';
import { areSameOriginDomain } from '../origin';
import { obtainSimilarOriginWindowAgent } from '../scripting/agents';
import {
  browletBindings, getRelevantRealm, projectWindow,
} from '../bindings';
import { BrowsingContext } from './browsing-context';
import { CustomElementRegistryImpl } from '../elements/custom-element-registry';
import { resolveBrowletElementConstruction } from '../elements/interfaces';
import { setupWindowEnvironmentSettingsObject } from '../scripting/environment';
import type {
  NavigationParams, NavigationRequest, NavigationResponse,
} from './navigation';
import { TopLevelTraversable } from './navigable';
import { createRealm } from '../scripting/realm';
import { WindowImpl } from '../window/window';

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
  let bindings: ReturnType<typeof browletBindings.register>;
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
    bindings = browletBindings.forRealm(getRelevantRealm(window));
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
    bindings = browletBindings.register(realmExecutionContext.realm);
    installBindings = true;
  }

  const document = createDocument({
    nodeFactory: bindings.objects,
    resolveElementConstruction: resolveBrowletElementConstruction,
  });
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
    projectWindow(bindings, window);
  }
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
  document: DocumentImpl,
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

function initializeDocumentCSP(_document: DocumentImpl): void {
  // TODO(Content Security Policy): Run CSP initialization once response policy
  // parsing and CSP lists are implemented.
}

function initializeDocumentReferrer(
  document: DocumentImpl,
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
