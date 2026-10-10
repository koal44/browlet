import { InternalError } from '../../../infra/internal-error';
import { areSameOriginDomain } from '../../../url/index';

import { obtainSimilarOriginWindowAgent } from '../../scripting/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import { CustomElementRegistryImpl } from '../../dom/nodes/html/custom-elements/index';
import type { WindowImpl } from '../window/index';

import type { NavigationParams } from './params';

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
    navigationParams.url;
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
    window = group.userAgent.createWindowEnvironment({
      agent, userAgent: group.userAgent,
      creationURL,
      origin: navigationParams.origin,
      parent: navigationParams.navigable.parent?.activeWindow ?? null,
      topLevelCreationURL: creationURL,
      topLevelOrigin: navigationParams.origin,
      reservedEnv: navigationParams.reservedEnv,
      previousRealm: browsingContext.activeWindow.env.realm,
    }).window;
  }

  const document = window.env.exec.createDocument();

  document.type = type;
  document.contentType = contentType;
  document.origin = navigationParams.origin;
  document.browsingContext = browsingContext;
  document.policyContainer = navigationParams.policyContainer;
  document.permissionsPolicy = permissionsPolicy;
  document.setActiveSandboxingFlagSet(navigationParams.finalSandboxingFlagSet);
  document.openerPolicy = navigationParams.openerPolicy;
  document.initializeLoadTimingInfo(navigationParams.startTime);
  document.wasCreatedViaCrossOriginRedirects = navigationParams.response.redirectTaint !== 'same-origin';
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
