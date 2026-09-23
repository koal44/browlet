import type { DocumentImpl } from '../dom/nodes/document';
import { areSameOriginDomain } from '../../url/index';
import { obtainSimilarOriginWindowAgent } from '../scripting/agents';
import { createDocument, createWindowEnvironment, getRelevantRealm } from '../bindings';
import { CustomElementRegistryImpl } from '../html/custom-elements/registry';
import type { NavigationParams } from './navigation/navigation';
import type { WindowImpl } from './window/window';
import { InternalError } from '../../infra/internal-error';

/** Select the Window and realm, then create the document for a navigation response. */
// https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object
export function createAndInitializeDocument(
  type: 'html' | 'xml',
  contentType: string,
  navigationParams: NavigationParams,
): DocumentImpl {
  const browsingContext = navigationParams.obtainBrowsingContext();
  const permissionsPolicy = navigationParams.createPermissionsPolicy();
  const creationURL = navigationParams.request?.currentURL ??
    navigationParams.response.url;
  const activeDocument = browsingContext.activeDocument;

  let window: WindowImpl;
  if (
    activeDocument.isInitialAboutBlank &&
    areSameOriginDomain(
      activeDocument.origin,
      navigationParams.origin,
    )
  ) {
    window = browsingContext.activeWindow;
  } else {
    const group = browsingContext.group;
    if (group === null) {
      throw new InternalError('Navigation browsing context has no group');
    }
    const requestsOAC = navigationParams.requestsOriginAgentCluster();
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
      reservedEnv: navigationParams.reservedEnv,
      previousRealm: getRelevantRealm(activeDocument),
    }).window;
  }

  const document = createDocument(getRelevantRealm(window));

  document.type = type;
  document.contentType = contentType;
  document.origin = navigationParams.origin;
  document.browsingContext = browsingContext;
  document.policyContainer = navigationParams.policyContainer;
  document.permissionsPolicy = permissionsPolicy;
  document.setActiveSandboxingFlagSet(navigationParams.finalSandboxingFlagSet);
  document.openerPolicy = navigationParams.openerPolicy;
  document.initializeLoadTimingInfo(navigationParams.response.timingInfo.startTime);
  document.wasCreatedViaCrossOriginRedirects = navigationParams.response.hasCrossOriginRedirects;
  document.duringLoadingNavigationID = navigationParams.id;
  document.url = creationURL;
  document.currentDocumentReadiness = 'loading';
  document.aboutBaseURL = navigationParams.aboutBaseURL;
  document.allowDeclarativeShadowRoots = true;
  document.customElementRegistry = new CustomElementRegistryImpl();

  window.setAssociatedDocument(document);
  document.initializeAncestry(navigationParams);
  document.initializeInsecureRequestsPolicy();
  document.initializeCSP();
  document.initializeReferrer(navigationParams.request);
  document.createNavigationTimingEntry(navigationParams);
  document.processResponseIntegrations(navigationParams);
  return document;
}
