import { atArg, defineInterface, impl } from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment/index';

/** Worker-specific navigator identity; never shares a Window's Navigator object. */
// https://html.spec.whatwg.org/multipage/workers.html#the-workernavigator-object
// TODO(HTML §§8.10, 10.2.7, 10.3.2): NavigatorID, NavigatorLanguage, NavigatorOnLine,
// and NavigatorConcurrentHardware. Permissions and Storage need the worker settings integration.
export class WorkerNavigatorImpl {
  /** Relevant environment supplied by the owning worker global. */
  env: BrowletEnvironment;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }
}

/*
 * [Exposed=Worker]
 * interface WorkerNavigator {};
 */
export const workerNavigatorIDL = defineInterface<BrowletEnvironment>({
  name: 'WorkerNavigator',
  exposed: 'Worker',
  implementation: impl(WorkerNavigatorImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [],
});
