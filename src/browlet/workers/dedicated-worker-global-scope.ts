import type { FetchResponse } from '../../fetch/index';

import { EmbedderPolicy, queueCOEPInheritanceViolation } from '../browsing/policy/index';
import type { BrowletEnvironment } from '../environment';

import { WorkerGlobalScopeImpl } from './worker-global-scope';

/** Dedicated-worker policy checks; startup and messaging remain with HTML §10. */
// https://html.spec.whatwg.org/multipage/workers.html#dedicatedworkerglobalscope
// TODO(HTML §10): Web IDL declaration and global binding with worker startup and messaging.
export abstract class DedicatedWorkerGlobalScopeImpl extends WorkerGlobalScopeImpl {
  // https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy
  override checkEmbedderPolicy(ownerEnv: BrowletEnvironment, response: FetchResponse): boolean {
    const ownerPolicy = ownerEnv.policyContainer.embedderPolicy;
    const compatible = EmbedderPolicy.isCompatibleWithCrossOriginIsolation(this.embedderPolicy.value);
    if (EmbedderPolicy.isCompatibleWithCrossOriginIsolation(ownerPolicy.reportOnlyValue) && !compatible) {
      queueCOEPInheritanceViolation(response, 'worker initialization', ownerPolicy.reportOnlyReportingEndpoint, 'reporting', ownerEnv);
    }
    if (!EmbedderPolicy.isCompatibleWithCrossOriginIsolation(ownerPolicy.value) || compatible) return true;
    queueCOEPInheritanceViolation(response, 'worker initialization', ownerPolicy.reportingEndpoint, 'enforce', ownerEnv);
    return false;
  }
}
