import { workerGlobalScopeIDL } from './worker-global-scope';
import { workerLocationIDL } from './worker-location';
import { dedicatedWorkerGlobalScopeIDL, dedicatedWorkerIncludesMessageEventTargetIDL } from './dedicated-worker-global-scope';
import { sharedWorkerGlobalScopeIDL } from './shared-worker-global-scope';
import { serviceWorkerIDL } from './service-worker';

/** Worker declarations; concrete global setup remains with the worker processing model. */
export const workerIDLDefinitions = [
  workerGlobalScopeIDL,
  dedicatedWorkerGlobalScopeIDL,
  dedicatedWorkerIncludesMessageEventTargetIDL,
  sharedWorkerGlobalScopeIDL,
  workerLocationIDL,
  serviceWorkerIDL,
];
