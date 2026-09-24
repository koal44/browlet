import { getRelevantRealm } from '../../../../../src/browlet/bindings';
import { createNewTopLevelTraversable } from '../../../../../src/browlet/browsing/navigable';
import { CSPList } from '../../../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy, type CSPDisposition } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { monotonicClock, UnsafeMoment } from '../../../../../src/browlet/performance/clock';
import { UserAgent } from '../../../../../src/browlet/user-agent';
import { FetchRequest } from '../../../../../src/fetch/request';
import { obtainURLOrigin, parseURL } from '../../../../../src/url/url';

/** Real Window bindings with an unstarted HTML loop, so tests choose task delivery explicitly. */
export function createCSPWindow(serialized = '', disposition: CSPDisposition = 'enforce') {
  const traversable = createNewTopLevelTraversable(new UserAgent(), null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  const env = realm.env;
  const document = realm.windowImplementation.document;
  document.url = parseURL('https://protected.test/page#section').url!;
  document.origin = obtainURLOrigin(document.url);
  document.httpStatus = 201;
  env.creationURL = document.url;
  document.policyContainer.cspList = new CSPList(document.origin);
  const policy = ContentSecurityPolicy.parse(serialized, 'header', disposition);
  document.policyContainer.cspList.policies.push(policy);
  const request = new FetchRequest(parseURL('https://resource.test/file').url!, env, env.userAgent);
  request.destination = 'image';
  request.populateFromClient();
  const loop = realm.agent.eventLoop;
  return {
    traversable, realm, env, document, policy, request,
    window: realm.global as unknown as Window & typeof globalThis,
    scope: env.getWindowOrWorkerGlobalScopeMixin(),
    runTask: () => loop.runTaskTurn({
      createMicrotaskQueue: () => loop.microtaskQueue,
      requestEventLoopTurn: () => {},
      unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
    }),
  };
}
