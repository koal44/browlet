import { workerGlobalScopeIDL } from './worker-global-scope';
import { workerLocationIDL } from './worker-location';
import { abstractWorkerIDL } from './abstract-worker';
import { dedicatedWorkerGlobalScopeIDL, dedicatedWorkerIncludesMessageEventTargetIDL } from './dedicated-worker-global-scope';
import { sharedWorkerGlobalScopeIDL } from './shared-worker-global-scope';
import { serviceWorkerIDL, serviceWorkerIncludesAbstractWorkerIDL } from './service-worker';
import {
  workerIDL, workerOptionsIDL, workerTypeIDL, workerIncludesAbstractWorkerIDL, workerIncludesMessageEventTargetIDL,
} from './worker';

/** Worker declarations; concrete global setup remains with the worker processing model. */
export const workerIDLDefinitions = [
  workerGlobalScopeIDL,
  dedicatedWorkerGlobalScopeIDL,
  dedicatedWorkerIncludesMessageEventTargetIDL,
  sharedWorkerGlobalScopeIDL,
  workerLocationIDL,
  abstractWorkerIDL,
  workerIDL,
  workerOptionsIDL,
  workerTypeIDL,
  workerIncludesAbstractWorkerIDL,
  workerIncludesMessageEventTargetIDL,
  serviceWorkerIDL,
  serviceWorkerIncludesAbstractWorkerIDL,
];
