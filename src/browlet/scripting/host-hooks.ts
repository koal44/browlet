import { setHostHooks } from '../../js-engine/index';
import type {
  JSJobCallback, JSJobRegistration, JSFunction,
  JSRealm,
} from '../../js-engine/index';
import type { EnvironmentSettingsObject } from './environment';
import { createTaskSource } from './event-loop';
import { Realm } from './realm';
import { queueGlobalTask } from './tasks';
import { runStepsAfterTimeout } from './timers';

export const jsEngineTaskSource = createTaskSource('JavaScript engine');

/* One HTML host installation serves all Browlet instances in this runtime. */
let installed = false;
export function installHostHooks(): void {
  if (installed || !setHostHooks) return;
  setHostHooks({
    makeJobCallback,
    callJobCallback,
    enqueuePromiseJob,
    enqueueGenericJob,
    enqueueTimeoutJob,
  });
  installed = true;
}

type JobCallback = JSJobCallback<EnvironmentSettingsObject | null>;

/* HTML §8.1.6 — HostMakeJobCallback. */
function makeJobCallback(
  callback: JSFunction,
  registration: JSJobRegistration,
): JobCallback {
  const incumbent = registration.incumbent;
  /*
   * TODO(HTML §8.1.4.1): Capture an active-script execution context when the
   * classic-script pipeline supplies HTML Script records. Realm.evaluate()
   * currently supplies only a controlled realm/settings entry.
   */
  return {
    callback,
    hostDefined: incumbent instanceof Realm ? incumbent.hostDefined : null,
  };
}

/* HTML §8.1.6 — HostCallJobCallback. */
function callJobCallback(
  record: JobCallback,
  receiver: unknown,
  argumentsList: unknown[],
): unknown {
  const settings = record.hostDefined;
  if (settings === null) {
    return Reflect.apply(record.callback, receiver, argumentsList);
  }
  const loop = settings.responsibleEventLoop;
  loop.prepareToRunCallback(settings);
  try {
    return Reflect.apply(record.callback, receiver, argumentsList);
  } finally {
    loop.cleanUpAfterRunningCallback(settings);
  }
}

/* HTML §8.1.6 — HostEnqueuePromiseJob. */
function enqueuePromiseJob(
  job: () => void,
  realm: JSRealm | null,
  queueRealm: JSRealm | null,
): false | void {
  // Node and unrelated vm jobs retain the engine-selected queue.
  const destination = queueRealm;
  if (!(destination instanceof Realm) || destination.hostDefined === null) return false;
  const settings = realm instanceof Realm ? realm.hostDefined : null;
  destination.queueMicrotask(() => {
    try {
      if (settings !== null) settings.responsibleEventLoop.prepareToRunScript(settings);
      try {
        job();
      } finally {
        if (settings !== null) settings.responsibleEventLoop.cleanUpAfterRunningScript(settings);
      }
    } catch (exception) {
      destination.callbacks.reportException(exception);
    }
  });
}

/* HTML §8.1.6 — HostEnqueueGenericJob. */
function enqueueGenericJob(job: () => void, realm: JSRealm | null): void {
  if (!(realm instanceof Realm) || realm.hostDefined === null) {
    throw new Error('HTML generic jobs require an HTML realm');
  }
  queueGlobalTask(jsEngineTaskSource, realm.globalObject, job);
}

/* HTML §8.1.6 — HostEnqueueTimeoutJob. */
function enqueueTimeoutJob(
  job: () => void,
  realm: JSRealm | null,
  milliseconds: number,
): void {
  if (!(realm instanceof Realm) || realm.hostDefined === null) {
    throw new Error('HTML timeout jobs require an HTML realm');
  }
  runStepsAfterTimeout(realm.globalObject, 'JavaScript', milliseconds, () => {
    queueGlobalTask(jsEngineTaskSource, realm.globalObject, job);
  });
}
