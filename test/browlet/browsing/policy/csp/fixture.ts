import { createManualUserAgent } from '../../../../support/browlet-agent';
import { getRelevantRealm } from '../../../../support/browlet-binding';
import { TopLevelTraversable } from '../../../../../src/browlet/browsing/navigation/navigable';
import { CSPList } from '../../../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy, type CSPDisposition } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { FetchRequest } from '../../../../../src/fetch/request';
import { obtainURLOrigin, parseURL } from '../../../../../src/url/url';

/** Real Window bindings with task delivery controlled by the fixture. */
export function createCSPWindow(serialized = '', disposition: CSPDisposition = 'enforce') {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
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
  const request = new FetchRequest(parseURL('https://resource.test/file').url!, env);
  request.client = env;
  request.destination = 'image';
  request.populateFromClient();
  const loop = realm.agent.eventLoop;
  return {
    traversable, realm, env, document, policy, request,
    window: realm.globalObject as unknown as Window & typeof globalThis,
    scope: env.getWindowOrWorkerGlobalScopeMixin(),
    runTask: () => loop.runTaskTurn(),
  };
}
