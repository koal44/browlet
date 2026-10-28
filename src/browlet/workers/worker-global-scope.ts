import { InternalError } from '../../infra/index';
import type { URLRecord } from '../../url/index';
import { isLocalURL, type FetchResponse } from '../../fetch/index';

import { ImportMap, mergeExistingAndNewImportMaps, type BrowletGlobalObject, type SpecifierResolutionRecord } from '../scripting/index';
import { EventTargetImpl } from '../dom/events/index';
import { EmbedderPolicy, PolicyContainer } from '../browsing/policy/index';
import type { DocumentImpl } from '../dom/nodes/index';
import type { BrowletEnvironment, BrowletEnvironmentBase } from '../environment';

/** Common worker scripting and policy state. */
// https://html.spec.whatwg.org/multipage/workers.html#workerglobalscope
// TODO(HTML §10): Web IDL declaration, worker settings/startup, remaining members, and platform projection.
export abstract class WorkerGlobalScopeImpl extends EventTargetImpl implements BrowletGlobalObject {
  // TODO(HTML worker startup): Set the URL and owners before initializing response policies.
  abstract url: URLRecord;
  ownerSet = new Set<DocumentImpl | WorkerGlobalScopeImpl>();
  policyContainer = new PolicyContainer();
  inErrorReportingMode = false;
  outstandingRejectedPromises = new WeakSet<Promise<unknown>>();
  aboutToBeNotifiedRejectedPromises: Promise<unknown>[] = [];
  importMap = new ImportMap();
  resolvedModuleSet = new Set<SpecifierResolutionRecord>();
  // https://html.spec.whatwg.org/multipage/workers.html#concept-workerglobalscope-embedder-policy
  embedderPolicy = new EmbedderPolicy();

  /** Local non-Blob workers inherit their owner's policies; other workers use the response. */
  // https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container
  initializePolicyContainer(response: FetchResponse, env: BrowletEnvironmentBase): void {
    if (isLocalURL(this.url) && this.url.scheme !== 'blob') {
      if (this.ownerSet.size !== 1) throw new InternalError('Local worker policy inheritance requires exactly one owner');
      const [owner] = this.ownerSet;
      this.policyContainer = owner!.policyContainer.clone();
    } else {
      this.policyContainer = env.userAgent.createPolicyContainerFromResponse(response, env);
    }
  }

  /** Non-dedicated workers do not participate in the owner's COEP inheritance check. */
  // https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy
  checkEmbedderPolicy(_ownerEnv: BrowletEnvironment, _response: FetchResponse): boolean {
    return true;
  }

  /** Shared global contract; HTML currently registers author import maps only in Windows. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#merge-existing-and-new-import-maps
  mergeImportMap(newImportMap: ImportMap): void {
    mergeExistingAndNewImportMaps(this, newImportMap);
  }
}
