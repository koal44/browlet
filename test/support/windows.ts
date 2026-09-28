import type { Browlet } from '../../src/browlet/browlet';
import { createDocument, createWindowEnvironment, getRelevantRealm, retargetWindowProxy } from '../../src/browlet/bindings';
import type { WindowProxy } from '../../src/browlet/browsing/window/window-proxy';
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
  window.setAssociatedDocument(createDocument(realm));
  const proxy = realm.globalThis as WindowProxy;
  retargetWindowProxy(proxy, window);
  return proxy;
}
