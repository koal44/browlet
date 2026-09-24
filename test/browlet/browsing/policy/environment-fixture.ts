import { createDocument, createWindowEnvironment } from '../../../../src/browlet/bindings';
import { BrowsingContext } from '../../../../src/browlet/browsing/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/session-history';
import type { WindowProxy } from '../../../../src/browlet/browsing/window/window-proxy';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import type { WindowEnvironment } from '../../../../src/browlet/scripting/environment';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { obtainURLOrigin, parseURL } from '../../../../src/url/url';

/** Compose real Window and navigable state while iframe construction is unfinished. */
export function createPolicyEnvironment(
  url: string, parent?: WindowEnvironment, userAgent = parent?.userAgent ?? new UserAgent(),
): WindowEnvironment {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  const env = createWindowEnvironment({
    agent: new WindowAgent(), userAgent, creationURL, origin,
    parent: parent?.window ?? null,
    topLevelCreationURL: parent?.topLevelCreationURL ?? creationURL,
    topLevelOrigin: parent?.topLevelOrigin ?? origin,
  });
  const document = createDocument(env.realm);
  document.url = creationURL;
  document.origin = origin;
  document.browsingContext = new BrowsingContext(env.realm.globalThis as WindowProxy);
  env.window.setAssociatedDocument(document);
  const state = createDocumentState(document);
  if (parent) new Navigable(state, parent.window.getAssociatedDocument().getNodeNavigable());
  else new TopLevelTraversable(state);
  return env;
}
