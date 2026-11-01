import { InternalError } from '../../infra/index';
import { setHostHooks, type JSJobCallback, type JSJobRegistration, type JSFunction, type JSRealm } from '../../js-engine/index';

import type { BrowletEnvironment } from '../environment';

import { createTaskSource } from './event-loop';
import { JSExecutionContext } from './execution-context';
import { BrowletRealm } from './realm';
import { JSScriptOrModule } from './script';

export const jsEngineTaskSource = createTaskSource('JavaScript engine');

// One HTML host installation serves all Browlet instances in this runtime.
let installed = false;
/** Install HTML callback and job routing once for this JavaScript runtime. */
// https://html.spec.whatwg.org/multipage/webappapis.html#javascript-specification-host-hooks
export function installHostHooks(): void {
  // SPEC_CLASH(html-private-elements): HostEnsureCanAddPrivateElement is not installed.
  // HTML rejects private elements on WindowProxy/Location; Browlet currently
  // follows Chromium's acceptance. See js-engine/ROADMAP.md#private-elements-on-host-objects.
  if (installed || !setHostHooks) return;
  // HTML §8.1.6.6.2: Realm reporters below deliver cleanup exceptions to the
  // registry's global. V8 owns the queued cleanup operation; make/call hooks
  // only surround individual callbacks after their cells have been removed. Broader HTML task
  // integration is unaudited, but no separate author-visible scheduling failure
  // has been demonstrated. See the roadmap before adding an engine handoff.
  // HostGetImportMetaProperties is installed per source-text module by parseModule().
  // HostLoadImportedModule lives in module-loading.ts. The graph loader calls it
  // directly; BrowletRealm's Node-shaped callbacks route dynamic imports to it.
  setHostHooks({
    makeJobCallback,
    callJobCallback,
    enqueuePromiseJob,
    enqueueGenericJob,
    enqueueTimeoutJob,
  });
  installed = true;
}

/** Install realm hooks during composition, once the HTML environment and global are ready. */
export function installRealmHostHooks(
  env: BrowletEnvironment, getCodeForEval: (argument: unknown) => string | undefined,
): void {
  // HostGetCodeForEval's platform identity check belongs to Binding. Check the
  // current policy at compilation, including cached code and retained functions.
  env.realm.setModifyCodeGenerationFromStringsCallback((argument) => {
    const extracted = getCodeForEval(argument);
    const source = typeof argument === 'string' ? argument : extracted;
    if (source !== undefined && env.policyContainer.cspList?.isStringCompilationBlocked(source, env)) return false;
    // Non-code values and allowed ordinary strings delegate unchanged to Node.
    // Extracted source also goes through Node's existing checks in the addon.
    return extracted;
  });
  // TODO(HTML §8.1.6.2 HostEnsureCanCompileStrings): Complete CSP's preceding
  // Trusted Types validation. V8 supplies neither compilation kind nor original
  // Function arguments. Do not infer these from source or isCodeLike. In particular,
  // require-trusted-types-for and default-policy unchanged-source validation
  // are not enforced here. Keep the four input gaps in code-generation-gaps.test.cjs.
  // Unlike the patched job hooks, rejection tracking uses public V8 APIs on
  // every addon base. Missing metadata retains the modeled running context;
  // foreign or non-HTML code must not inherit an unrelated outer script.
  env.realm.setPromiseRejectionTracker((promise, operation, code) => {
    const script = code === undefined ? undefined :
      code === null ? null : JSScriptOrModule.fromCompiledCode(code)?.script ?? null;
    env.trackPromiseRejection(promise, operation, script);
  });
  // V8 reports native cleanup errors in the registry's context, which can differ
  // from the cleanup callback's realm. Capture the owning environment here.
  env.realm.setExceptionReporter((exception) => env.reportException(exception));
  // https://html.spec.whatwg.org/multipage/webappapis.html#hostsystemutcepochnanoseconds
  // Non-concrete isolation returns false without querying the Document's policy.
  // TODO(Permissions Policy): Before enabling concrete isolation, implement
  // #is-feature-enabled and its inherited/header/container policy inputs (§§9.1–9.10):
  // https://w3c.github.io/webappsec-permissions-policy/#is-feature-enabled
  // Composition precedes Document attachment, so do not eagerly query its policy
  // here. A later callback must also never reach the current throwing placeholder.
  // TODO(Temporal range): The existing native callback accepts int64 nanoseconds
  // (roughly 1677–2262), not HTML's full Instant range. Preserve the HTML clamp;
  // see the roadmap for the accepted native clock limit and Chromium evidence.
  if (env.realm.agent.agentCluster?.crossOriginIsolationMode !== 'concrete') {
    env.realm.setTemporalHostSystemUTCEpochNanosecondsCallback(() => env.getSystemUTCEpochNanoseconds());
  }
}

type JobCallback = JSJobCallback<{
  /** Settings captured at registration, independently of the callback's realm. */
  incumbentEnv: BrowletEnvironment;
  /** Fresh context carrying the registering script into the later invocation. */
  activeScriptContext: JSExecutionContext | null;
} | null>;

// https://html.spec.whatwg.org/multipage/webappapis.html#hostmakejobcallback
// SPEC_MISMATCH: HostMakeJobCallback(callable)
// registration supplies the incumbent observed before the native bridge enters
// Node's JavaScript hooks; looking it up here would include those host frames.
function makeJobCallback(
  callback: JSFunction,
  registration: JSJobRegistration,
): JobCallback {
  const incumbent = registration.incumbent;
  // Registrations outside HTML retain the ordinary engine call path.
  if (!(incumbent instanceof BrowletRealm) || !incumbent.hasEnvironment) {
    return { callback, hostDefined: null };
  }
  const env = incumbent.env;
  // Steps 2–4 select the active script independently of incumbent settings and
  // the callback's realm. Capture a new context, not the frame's skip counter.
  const code = registration.compiledCode;
  const activeScript = code === undefined ? env.responsibleEventLoop.activeScript :
    code === null ? null : JSScriptOrModule.fromCompiledCode(code)?.script ?? null;
  let activeScriptContext: JSExecutionContext | null = null;
  if (activeScript !== null) {
    activeScriptContext = new JSExecutionContext({
      realm: activeScript.env.realm, scriptOrModule: activeScript.record,
    });
  }
  // The metadata identifies the registering code, not the callback's code or
  // the outer modeled script. Built-ins without metadata retain HTML's saved
  // context; foreign code must not inherit it. This observes registration only,
  // not every author call or module resumption on the modeled stack.
  return {
    callback,
    hostDefined: { incumbentEnv: env, activeScriptContext },
  };
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostcalljobcallback
function callJobCallback(
  record: JobCallback,
  receiver: unknown,
  argumentsList: unknown[],
): unknown {
  const state = record.hostDefined;
  if (state === null) {
    return Reflect.apply(record.callback, receiver, argumentsList);
  }
  const { incumbentEnv, activeScriptContext } = state;
  const loop = incumbentEnv.responsibleEventLoop;
  loop.prepareToRunCallback(incumbentEnv);
  if (activeScriptContext !== null) loop.executionContextStack.push(activeScriptContext);
  try {
    return Reflect.apply(record.callback, receiver, argumentsList);
  } finally {
    if (activeScriptContext !== null) {
      if (loop.runningExecutionContext !== activeScriptContext) {
        // eslint-disable-next-line no-unsafe-finally -- Stack corruption is an internal error even if the author callback threw.
        throw new InternalError('Job callback script contexts were cleaned up out of order');
      }
      loop.executionContextStack.pop();
    }
    loop.cleanUpAfterRunningCallback(incumbentEnv);
  }
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuepromisejob
// SPEC_MISMATCH: HostEnqueuePromiseJob(job, realm)
// queueRealm preserves the engine-selected queue when the job realm is null;
// returning false leaves jobs outside HTML with the engine's original queue.
function enqueuePromiseJob(
  job: () => void,
  realm: JSRealm | null,
  queueRealm: JSRealm | null,
): false | void {
  // Node and unrelated vm jobs retain the engine-selected queue.
  const destination = queueRealm;
  if (!(destination instanceof BrowletRealm) || !destination.hasEnvironment) return false;
  const env = realm instanceof BrowletRealm && realm.hasEnvironment ? realm.env : undefined;
  destination.queueMicrotask(() => {
    try {
      if (env !== undefined) env.responsibleEventLoop.prepareToRunScript(env);
      try {
        job();
      } finally {
        if (env !== undefined) env.responsibleEventLoop.cleanUpAfterRunningScript(env);
      }
    } catch (exception) {
      // Step 2.4 uses the job realm, which can differ from the queue realm for
      // revoked Proxy handlers. Reporting follows script cleanup above.
      // SPEC_GAP(promise-job-null-realm): HTML leaves the reporting global undefined
      // when realm is null (whatwg/html#10526). Retain our queue-realm fallback.
      (env?.realm ?? destination).reportException(exception);
    }
  });
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuegenericjob
function enqueueGenericJob(job: () => void, realm: JSRealm | null): void {
  if (!(realm instanceof BrowletRealm) || !realm.hasEnvironment) {
    // TODO(runtime ownership): The isolate-wide native hook cannot decline a
    // job for an unrelated Node/VM realm. Keep that unsupported boundary explicit.
    throw new InternalError('HTML generic jobs require an HTML realm');
  }
  // Steps 1–2: the supplied realm selects its global's loop and Document.
  // This is an engine task; author Promise reactions use their separate hook.
  realm.queueGlobalTask(jsEngineTaskSource, job);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuetimeoutjob
function enqueueTimeoutJob(
  job: () => void,
  realm: JSRealm | null,
  milliseconds: number,
): void {
  if (!(realm instanceof BrowletRealm) || !realm.hasEnvironment) {
    // TODO(runtime ownership): Like generic jobs, this isolate-wide native hook
    // cannot decline an unrelated Node/VM job. Keep that boundary explicit.
    throw new InternalError('HTML timeout jobs require an HTML realm');
  }
  // Steps 1–3: retain this realm's global for both active-time waiting and the
  // eventual engine task. The JavaScript ordering group is separate from timers
  // created by setTimeout/setInterval, without their nesting or delay clamping.
  const timers = realm.env.getWindowOrWorkerGlobalScopeMixin().timers;
  timers.runStepsAfterTimeout('JavaScript', milliseconds, () => {
    realm.queueGlobalTask(jsEngineTaskSource, job);
  });
}
