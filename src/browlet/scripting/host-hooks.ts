import { nodeRuntime } from '../../js-engine/index';
import type {
  JavaScriptJobCallback, JavaScriptJobRegistration, JavaScriptFunction,
  JavaScriptRealm,
} from '../../js-engine/index';
import type { EnvironmentSettingsObject } from './environment';
import { createTaskSource } from './event-loop';
import { Realm } from './realm';
import { queueGlobalTask } from './tasks';
import { runStepsAfterTimeout } from './timers';

export const javaScriptEngineTaskSource = createTaskSource('JavaScript engine');

/* One HTML host installation serves all Browlet instances in this runtime. */
export function installHostHooks(): void {
  if (installed || !nodeRuntime.supportsHostHooks) return;
  nodeRuntime.setHostHooks({
    makeJobCallback,
    callJobCallback,
    enqueuePromiseJob,
    enqueueGenericJob,
    enqueueTimeoutJob,
  });
  installed = true;
}

let installed = false;

type JobCallback = JavaScriptJobCallback<EnvironmentSettingsObject | null>;

/* HTML §8.1.6 — HostMakeJobCallback. */
function makeJobCallback(
  callback: JavaScriptFunction,
  registration: JavaScriptJobRegistration,
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
// SPEC_MISMATCH: (job, realm) -> void
function enqueuePromiseJob(
  job: () => void,
  realm: JavaScriptRealm | null,
  queueRealm: JavaScriptRealm | null,
  executionOwner: JavaScriptRealm | undefined,
): false | void {
  // Unowned Node and unrelated vm jobs retain the engine-selected queue.
  const destination = executionOwner ?? queueRealm;
  if (!(destination instanceof Realm) || destination.hostDefined === null) return false;
  // Internal continuations belong to the operation's destination. They do not
  // constitute an author script, even though the implementation is JavaScript.
  const settings = executionOwner === undefined && realm instanceof Realm
    ? realm.hostDefined : null;
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
function enqueueGenericJob(job: () => void, realm: JavaScriptRealm | null): void {
  if (!(realm instanceof Realm) || realm.hostDefined === null) {
    throw new Error('HTML generic jobs require an HTML realm');
  }
  queueGlobalTask(javaScriptEngineTaskSource, realm.globalObject, job);
}

/* HTML §8.1.6 — HostEnqueueTimeoutJob. */
function enqueueTimeoutJob(
  job: () => void,
  realm: JavaScriptRealm | null,
  milliseconds: number,
): void {
  if (!(realm instanceof Realm) || realm.hostDefined === null) {
    throw new Error('HTML timeout jobs require an HTML realm');
  }
  runStepsAfterTimeout(realm.globalObject, 'JavaScript', milliseconds, () => {
    queueGlobalTask(javaScriptEngineTaskSource, realm.globalObject, job);
  });
}
