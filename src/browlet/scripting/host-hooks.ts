import { setHostHooks } from '../../js-engine/index';
import type {
  JSJobCallback, JSJobRegistration, JSFunction,
  JSRealm,
} from '../../js-engine/index';
import type { BrowletEnvironment } from './environment';
import { createTaskSource } from './event-loop';
import { Realm } from './realm';
import { InternalError } from '../../infra/internal-error';

export const jsEngineTaskSource = createTaskSource('JavaScript engine');

// One HTML host installation serves all Browlet instances in this runtime.
let installed = false;
/** Install HTML callback and job routing once for this JavaScript runtime. */
// https://html.spec.whatwg.org/multipage/webappapis.html#javascript-specification-host-hooks
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

type JobCallback = JSJobCallback<BrowletEnvironment | null>;

// https://html.spec.whatwg.org/multipage/webappapis.html#hostmakejobcallback
function makeJobCallback(
  callback: JSFunction,
  registration: JSJobRegistration,
): JobCallback {
  const incumbent = registration.incumbent;
  // TODO(HTML §8.1.4.1): Capture an active-script execution context when the
  // classic-script pipeline supplies HTML Script records. Realm.evaluate()
  // currently supplies only a controlled realm/settings entry.
  return {
    callback,
    hostDefined: incumbent instanceof Realm ? incumbent.hostDefined ?? null : null,
  };
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostcalljobcallback
function callJobCallback(
  record: JobCallback,
  receiver: unknown,
  argumentsList: unknown[],
): unknown {
  const env = record.hostDefined;
  if (env === null) {
    return Reflect.apply(record.callback, receiver, argumentsList);
  }
  const loop = env.responsibleEventLoop;
  loop.prepareToRunCallback(env);
  try {
    return Reflect.apply(record.callback, receiver, argumentsList);
  } finally {
    loop.cleanUpAfterRunningCallback(env);
  }
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuepromisejob
function enqueuePromiseJob(
  job: () => void,
  realm: JSRealm | null,
  queueRealm: JSRealm | null,
): false | void {
  // Node and unrelated vm jobs retain the engine-selected queue.
  const destination = queueRealm;
  if (!(destination instanceof Realm) || destination.hostDefined === undefined) return false;
  const env = realm instanceof Realm ? realm.hostDefined : undefined;
  destination.queueMicrotask(() => {
    try {
      if (env !== undefined) env.responsibleEventLoop.prepareToRunScript(env);
      try {
        job();
      } finally {
        if (env !== undefined) env.responsibleEventLoop.cleanUpAfterRunningScript(env);
      }
    } catch (exception) {
      destination.reportException(exception);
    }
  });
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuegenericjob
function enqueueGenericJob(job: () => void, realm: JSRealm | null): void {
  if (!(realm instanceof Realm) || realm.hostDefined === undefined) {
    throw new InternalError('HTML generic jobs require an HTML realm');
  }
  realm.queueGlobalTask(jsEngineTaskSource, job);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuetimeoutjob
function enqueueTimeoutJob(
  job: () => void,
  realm: JSRealm | null,
  milliseconds: number,
): void {
  if (!(realm instanceof Realm) || realm.hostDefined === undefined) {
    throw new InternalError('HTML timeout jobs require an HTML realm');
  }
  const timers = realm.env.getWindowOrWorkerGlobalScopeMixin().timers;
  timers.runStepsAfterTimeout('JavaScript', milliseconds, () => {
    realm.queueGlobalTask(jsEngineTaskSource, job);
  });
}
