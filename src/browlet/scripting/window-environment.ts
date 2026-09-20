import { createStructuredClone, createWindowRealm } from '../bindings';
import { WindowImpl } from '../browsing/window/window';
import type { UserAgent } from '../user-agent';
import type { Origin } from '../../url/origin';
import { serializeURL, type URLRecord } from '../../url/url';
import type { WindowAgent } from './agents';
import {
  Environment, setupWindowEnvironmentSettingsObject, type WindowEnvironmentSettingsObject,
} from './environment';
import { WindowOrWorkerGlobalScopeMixin } from './global-scope';
import type { Realm } from './realm';
import { timerTaskSource } from './timers';

/*
 * Shared Window initialization for HTML's initial browsing context and navigation
 * algorithms. Each caller selects the origin and still initializes its Document.
 */
export function createWindowEnvironment(
  agent: WindowAgent,
  initialization: WindowEnvironmentInitialization,
): { window: WindowImpl; settings: WindowEnvironmentSettingsObject; } {
  const {
    userAgent, creationURL, origin, parent, topLevelCreationURL, topLevelOrigin,
    reservedEnvironment = null, previousRealm,
  } = initialization;
  // https://html.spec.whatwg.org/multipage/webappapis.html#secure-context
  // Follow browser ancestry checks: the parent's decision includes its ancestors.
  // https://w3c.github.io/webappsec-secure-contexts/#ancestors
  const environment = reservedEnvironment ?? new Environment({
    userAgent, creationURL, topLevelCreationURL, topLevelOrigin,
    targetBrowsingContext: null,
    isSecureContext: userAgent.isOriginPotentiallyTrustworthy(origin) &&
      (parent === null || parent.isSecureContext),
  });
  const window = new WindowImpl(new URL(serializeURL(creationURL)));
  const executionContext = createWindowRealm(agent, window, environment, previousRealm);
  const settings = setupWindowEnvironmentSettingsObject(
    creationURL, executionContext, reservedEnvironment, topLevelCreationURL, topLevelOrigin,
  );
  const { realm } = executionContext;
  window.setWindowOrWorkerGlobalScopeMixin(new WindowOrWorkerGlobalScopeMixin({
    settings,
    queueTimerTask: (steps, options) => realm.queueGlobalTask(timerTaskSource, steps, options),
    structuredClone: createStructuredClone(realm),
  }));
  return { window, settings };
}

type WindowEnvironmentInitialization = {
  userAgent: UserAgent;
  creationURL: URLRecord;
  origin: Origin;
  parent: WindowImpl | null;
  topLevelCreationURL: URLRecord;
  topLevelOrigin: Origin;
  reservedEnvironment?: Environment | null;
  previousRealm?: Realm;
};
