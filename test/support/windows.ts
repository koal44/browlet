import type { Browlet } from '../../src/browlet/browlet';
import type { Window } from '../../src/browlet/platform';
import { createWindowEnvironment } from '../../src/browlet/bindings';
import { getRelevantRealm } from './browlet-binding';
import { WindowAgent } from '../../src/browlet/scripting/agents';

/** Create a same-origin Window on the same agent without requiring iframe navigation. */
export function createSiblingWindow(first: Browlet): Window {
  const { agent, env } = getRelevantRealm(first.window);
  if (!(agent instanceof WindowAgent)) throw new Error('Expected a Window agent');
  const siblingEnv = createWindowEnvironment({
    agent, userAgent: env.userAgent, creationURL: env.creationURL,
    origin: env.origin, parent: null,
    topLevelCreationURL: env.creationURL, topLevelOrigin: env.origin,
  });
  const { window, realm } = siblingEnv;
  const document = realm.env.createDocument();
  document.origin = env.origin;
  window.setAssociatedDocument(document);
  const proxy = realm.windowProxy;
  proxy.setAssociatedWindow(window.env.realm.globalObject);
  return proxy.platform;
}
