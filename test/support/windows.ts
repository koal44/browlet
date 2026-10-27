import type { Browlet } from '../../src/browlet/browlet';
import type { Window } from '../../src/browlet/platform';
import { createWindowEnvironment } from '../../src/browlet/bindings';
import { getRelevantRealm } from './browlet-binding';
import { WindowAgent } from '../../src/browlet/scripting/agents';

/** Create another Window on the same agent without requiring iframe navigation. */
export function createSiblingWindow(first: Browlet): Window {
  const { agent, env } = getRelevantRealm(first.window);
  if (!(agent instanceof WindowAgent)) throw new Error('Expected a Window agent');
  const siblingEnv = createWindowEnvironment({
    agent, userAgent: env.userAgent, creationURL: env.creationURL,
    origin: env.origin, parent: null,
    topLevelCreationURL: env.creationURL, topLevelOrigin: env.origin,
  });
  const { window, realm } = siblingEnv;
  window.setAssociatedDocument(realm.env.createDocument());
  const proxy = realm.windowProxy;
  proxy.setAssociatedWindow(window.env.realm.globalObject);
  return proxy.platform;
}
