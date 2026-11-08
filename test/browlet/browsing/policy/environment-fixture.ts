import { createManualEventLoop } from '../../../support/browlet-agent';
import { createWindowEnvironment } from '../../../../src/browlet/integration/web-idl/index';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import type { WindowEnvironment } from '../../../../src/browlet/environment/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/url';

/** Compose real Window and navigable state while iframe construction is unfinished. */
export function createPolicyEnvironment(
  url: string, parent?: WindowEnvironment, userAgent = parent?.userAgent ?? new UserAgent(),
): WindowEnvironment {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  const env = createWindowEnvironment({
    agent: new WindowAgent(createManualEventLoop()), userAgent, creationURL, origin,
    parent: parent?.window ?? null,
    topLevelCreationURL: parent?.topLevelCreationURL ?? creationURL,
    topLevelOrigin: parent?.topLevelOrigin ?? origin,
  });
  const document = env.createDocument();
  document.url = creationURL;
  document.origin = origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  const state = DocumentState.create(document);
  if (parent) new Navigable(state, parent.window.getAssociatedDocument().getNodeNavigable());
  else new TopLevelTraversable(state);
  return env;
}
