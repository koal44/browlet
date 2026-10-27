import { describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';
import { createMicrotaskQueue, type JSMicrotaskQueue } from '../../../src/js-engine/index';
import { createManualEventLoop } from '../../support/browlet-agent';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createScriptState } from '../../support/script-state';
import { installHostHooks } from '../../../src/browlet/scripting/host-hooks';
import { createBrowletEnvironmentInit, browletBindingWorld } from '../../../src/browlet/bindings';
import { UserAgent } from '../../../src/browlet/user-agent';

import { createOpaqueOrigin } from '../../../src/url/origin';
import { parseURL } from '../../../src/url/url';
import type { Origin, URLRecord } from '../../../src/url/core/index';
import { DefinitionAssembly } from '../../../src/web-idl/assembly/index';
import { RealmBinding } from '../../../src/web-idl/binding/realm';
import { IDLCallbackFunction } from '../../../src/web-idl/values/callback';

import {
  defineCallbackFunction, idlType, reference,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { PolicyContainer } from '../../../src/browlet/browsing/policy/container';
import { ModuleMap } from '../../../src/browlet/scripting/module-map';
import { Agent, AgentCluster } from '../../../src/browlet/scripting/agents';
import { BrowletEnvironmentBase } from '../../../src/browlet/environment';
import { BrowletEnvironment } from '../../../src/browlet/environment';
import { WindowOrWorkerGlobalScopeMixin } from '../../../src/browlet/global-scope';
import type { Task } from
  '../../../src/browlet/scripting/event-loop';
import { Moment, monotonicClock } from '../../../src/browlet/timing/clock';
import {
  createBrowletRealm,
} from '../../../src/browlet/scripting/realm';
import { JSExecutionContext } from '../../../src/browlet/scripting/execution-context';
import {
  JSScriptOrModule, ClassicScript, JSSourceTextModuleRecord, type JavaScriptModuleScript,
} from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';

describe('HTML callback and script-entry lifecycle', () => {
  it('attaches the environment to its realm during construction', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const { realm, env, context } = createTestRealm(agent, 'attachment');

    expect(realm.hasEnvironment).toBe(true);
    expect(realm.env).toBe(env);
    expect(realm.baseEnv).toBe(env);
    expect(env.realm).toBe(realm);
    expect(env.realmExecutionContext).toBe(realm.executionContext);
    expect(realm.executionContext.realm).toBe(realm);
    expect(context.getEnvironment()).toBe(env);
  });

  it('creates a default global and returns the retained realm execution context', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const context = createBrowletRealm(agent);

    expect(context.realm.executionContext).toBe(context);
    expect(context.function).toBeNull();
    expect(context.scriptOrModule).toBeNull();
    expect(context.skipWhenDeterminingIncumbent).toBe(0);
    expect(context.realm.globalThis).toBe(context.realm.globalObject);
    expect(context.realm.evaluate('typeof Array', 'default-global.js')).toBe('function');
    expect(agent.eventLoop.runningExecutionContext).toBeNull();
  });

  it('does not require an associated document for non-Window script settings', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const { env } = createTestRealm(agent, 'script-policy');
    expect(env.realm.getAssociatedDocument()).toBeNull();
    expect(env.canRunScript()).toBe(true);
    env.userAgent.scriptingEnabled = false;
    expect(env.canRunScript()).toBe(false);
  });

  it('runs global customization with the new context and restores the previous stack on failure', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const outer = createTestRealm(agent, 'outer');
    const loop = agent.eventLoop;
    loop.prepareToRunScript(outer.env);
    try {
      expect(() => createBrowletRealm(agent, {
        createGlobalObject(realm) {
          expect(loop.runningExecutionContext).toBe(realm.executionContext);
          expect(loop.entryExecutionContext).toBe(realm.executionContext);
          throw new Error('global creation failed');
        },
      })).toThrow('global creation failed');
      expect(loop.runningExecutionContext).toBe(outer.realm.executionContext);
    } finally {
      loop.cleanUpAfterRunningScript(outer.env);
    }
    expect(loop.executionContextStack).toEqual([]);
  });

  it('removes SharedArrayBuffer after restoring the previous execution context', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    new AgentCluster().add(agent);
    const outer = createTestRealm(agent, 'outer');
    const loop = agent.eventLoop;
    const deletionContexts: (JSExecutionContext | null)[] = [];
    loop.prepareToRunScript(outer.env);
    try {
      const context = createBrowletRealm(agent, {
        createGlobalObject: (realm) => new Proxy(
          realm.createOrdinaryObject(realm.objectPrototype),
          {
            deleteProperty(target, key) {
              if (key === 'SharedArrayBuffer') deletionContexts.push(loop.runningExecutionContext);
              return Reflect.deleteProperty(target, key);
            },
          },
        ),
      });
      expect(deletionContexts).toEqual([outer.realm.executionContext]);
      expect(Reflect.has(context.realm.globalObject, 'SharedArrayBuffer')).toBe(false);
    } finally {
      loop.cleanUpAfterRunningScript(outer.env);
    }
  });

  it('keeps direct-host callback capture separate from strict incumbent lookup', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const a = createTestRealm(agent, 'a');
    const b = createTestRealm(agent, 'b');
    const loop = agent.eventLoop;

    expect(() => loop.getIncumbentEnvironment()).toThrow('backup incumbent settings stack is empty');
    expect(b.realm.callbacks.captureContext()).toBe(b.env);
    loop.prepareToRunCallback(a.env);
    try {
      expect(b.realm.callbacks.captureContext()).toBe(a.env);
    } finally {
      loop.cleanUpAfterRunningCallback(a.env);
    }
    loop.runScriptEvaluation(a.env, () => {
      expect(b.realm.callbacks.captureContext()).toBe(a.env);
    });
    expect(b.realm.callbacks.captureContext()).toBe(b.env);
  });

  it('distinguishes entry, incumbent, current, and relevant realms, settings, and globals', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const a = createTestRealm(agent, 'a');
    const b = createTestRealm(agent, 'b');
    const c = createTestRealm(agent, 'c');
    const d = createTestRealm(agent, 'd');
    d.context.install(d.realm.globalObject);
    const EventTarget = Reflect.get(d.realm.globalObject, 'EventTarget') as new () => object;
    const target = new EventTarget();
    const loop = agent.eventLoop;
    // Supply the script and built-in records explicitly: this tests selection,
    // not interception of the real calls in HTML's four-page example.
    const script = new JSExecutionContext(b.realm);
    script.scriptOrModule = new JSScriptOrModule(b.realm, null);
    const builtin = new JSExecutionContext(c.realm);
    builtin.function = c.realm.createFunction(() => {}, { name: 'builtin', length: 0 });
    loop.prepareToRunScript(a.env);
    loop.executionContextStack.push(script, builtin);
    try {
      const entry = loop.entryExecutionContext.realm;
      const incumbent = loop.getIncumbentEnvironment();
      const current = loop.runningExecutionContext!.realm;
      const relevant = getRelevantRealm(target);
      expect(entry).toBe(a.realm);
      expect(entry.env).toBe(a.env);
      expect(entry.globalObject).toBe(a.realm.globalObject);
      expect(incumbent).toBe(b.env);
      expect(incumbent.realm).toBe(b.realm);
      expect(incumbent.global).toBe(b.realm.globalObject);
      expect(current).toBe(c.realm);
      expect(current.env).toBe(c.env);
      expect(current.globalObject).toBe(c.realm.globalObject);
      expect(relevant).toBe(d.realm);
      expect(relevant.env).toBe(d.env);
      expect(relevant.globalObject).toBe(d.realm.globalObject);
      expect(loop.topmostScriptHavingExecutionContext).toBe(script);
      // A nested HTML entry is the new entry realm even though B is still the topmost script.
      loop.prepareToRunScript(c.env);
      try {
        expect(loop.entryExecutionContext.realm).toBe(c.realm);
        expect(loop.getIncumbentEnvironment()).toBe(b.env);
        expect(getRelevantRealm(target)).toBe(d.realm);
      } finally {
        loop.cleanUpAfterRunningScript(c.env);
      }
      expect(loop.entryExecutionContext.realm).toBe(a.realm);
    } finally {
      loop.executionContextStack.pop();
      loop.executionContextStack.pop();
      loop.cleanUpAfterRunningScript(a.env);
    }
    expect(loop.runningExecutionContext).toBeNull();
    expect(getRelevantRealm(target)).toBe(d.realm);
    expect(() => loop.entryExecutionContext).toThrow('no entry execution context');
    expect(() => loop.getIncumbentEnvironment()).toThrow('backup incumbent settings stack is empty');
  });

  it('restores nested backup incumbents and lets a newer script take precedence', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const a = createTestRealm(agent, 'a');
    const b = createTestRealm(agent, 'b');
    const c = createTestRealm(agent, 'c');
    const loop = agent.eventLoop;
    loop.runScriptEvaluation(a.env, () => {
      const script = loop.topmostScriptHavingExecutionContext!;
      loop.prepareToRunCallback(b.env);
      try {
        expect(script.skipWhenDeterminingIncumbent).toBe(1);
        expect(loop.getIncumbentEnvironment()).toBe(b.env);
        loop.prepareToRunCallback(c.env);
        try {
          expect(script.skipWhenDeterminingIncumbent).toBe(2);
          expect(loop.getIncumbentEnvironment()).toBe(c.env);
        } finally {
          loop.cleanUpAfterRunningCallback(c.env);
        }
        loop.runScriptEvaluation(c.env, () => {
          expect(loop.getIncumbentEnvironment()).toBe(c.env);
        });
        expect(loop.getIncumbentEnvironment()).toBe(b.env);
      } finally {
        loop.cleanUpAfterRunningCallback(b.env);
      }
      expect(script.skipWhenDeterminingIncumbent).toBe(0);
      expect(loop.getIncumbentEnvironment()).toBe(a.env);
    });
    expect(loop.executionContextStack).toEqual([]);
    expect(() => loop.getIncumbentEnvironment()).toThrow('backup incumbent settings stack is empty');
  });

  it('distinguishes the active script from the running frame and incumbent skipping', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const a = createTestRealm(agent, 'a');
    const b = createTestRealm(agent, 'b');
    const loop = agent.eventLoop;
    const classic = new ClassicScript('', a.env, a.env.apiBaseURL, new ScriptFetchOptions());
    const module: JavaScriptModuleScript = createScriptState(b.env);
    module.baseURL = b.env.apiBaseURL;
    module.record = new JSSourceTextModuleRecord(module);
    const classicContext = new JSExecutionContext(a.realm);
    classicContext.scriptOrModule = classic.record;
    const moduleContext = new JSExecutionContext(b.realm);
    moduleContext.scriptOrModule = module.record;
    const builtin = new JSExecutionContext(a.realm);
    builtin.function = a.realm.createFunction(() => {}, { name: 'builtin', length: 0 });

    expect(loop.activeScript).toBeNull();
    expect(loop.runningScript).toBeNull();
    loop.prepareToRunScript(a.env);
    try {
      expect(loop.activeScript).toBeNull();
      expect(loop.runningScript).toBeNull();
      loop.executionContextStack.push(classicContext);
      try {
        expect(loop.activeScript).toBe(classic);
        expect(loop.runningScript).toBe(classic);
        loop.executionContextStack.push(moduleContext, builtin);
        try {
          loop.prepareToRunCallback(a.env);
          try {
            expect(loop.getIncumbentEnvironment()).toBe(a.env);
            expect(loop.runningExecutionContext?.realm).toBe(a.realm);
            expect(loop.activeScript).toBe(module);
            expect(loop.runningScript).toBeNull();
          } finally {
            loop.cleanUpAfterRunningCallback(a.env);
          }
          // A provisional topmost record must not expose a lower script's base URL.
          loop.runScriptEvaluation(a.env, () => {
            expect(loop.activeScript).toBeNull();
            expect(loop.runningScript).toBeNull();
          });
          expect(loop.activeScript).toBe(module);
        } finally {
          loop.executionContextStack.pop();
          loop.executionContextStack.pop();
        }
        expect(loop.activeScript).toBe(classic);
        expect(loop.runningScript).toBe(classic);
      } finally {
        loop.executionContextStack.pop();
      }
    } finally {
      loop.cleanUpAfterRunningScript(a.env);
    }
    expect(loop.activeScript).toBeNull();
    expect(loop.runningScript).toBeNull();
  });

  it('uses the non-Window environment timer owner for AbortSignal.timeout', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const { realm, env, context } = createTestRealm(agent, 'abort-timeout');
    context.install(realm.globalObject);
    const timers = env.getWindowOrWorkerGlobalScopeMixin().timers;
    const schedule = vi.spyOn(timers, 'runStepsAfterTimeout')
      .mockReturnValue(Symbol('Timer'));

    realm.evaluate('globalThis.signal = AbortSignal.timeout(10)', 'abort-timeout.js');

    expect(schedule).toHaveBeenCalledWith('AbortSignal-timeout', 10, expect.any(Function));
    expect(realm.evaluate('signal.aborted', 'before-timeout.js')).toBe(false);
    schedule.mock.calls[0]![2]();
    expect(agent.eventLoop.runTaskTurn()).toBe(true);
    expect(realm.evaluate('[signal.aborted, signal.reason.name]', 'after-timeout.js'))
      .toEqual([true, 'TimeoutError']);
  });

  itPassesWith('hostHooks')('uses the non-Window environment timer owner for engine timeouts', () => {
    installHostHooks();
    const agent = new TestAgent(createMicrotaskQueue());
    const { realm, env } = createTestRealm(agent, 'engine-timeout');
    const timers = env.getWindowOrWorkerGlobalScopeMixin().timers;
    const schedule = vi.spyOn(timers, 'runStepsAfterTimeout')
      .mockReturnValue(Symbol('Timer'));
    Reflect.set(realm.globalObject, 'waitArray', new Int32Array(new SharedArrayBuffer(4)));
    realm.evaluate(`
      globalThis.result = undefined;
      Atomics.waitAsync(waitArray, 0, 0, 10).value.then(value => { result = value; });
    `, 'engine-timeout.js');

    // The engine supplies the remaining deadline, after any setup time has elapsed.
    expect(schedule).toHaveBeenCalledWith('JavaScript', expect.any(Number), expect.any(Function));
    schedule.mock.calls[0]![2]();
    expect(agent.eventLoop.runTaskTurn()).toBe(true);
    expect(realm.evaluate('result', 'after-timeout.js')).toBe('timed-out');
  });

  itPassesWith('hostHooks')('retains each Promise registration incumbent independently of the callback realm', () => {
    installHostHooks();
    const agent = new TestAgent(createMicrotaskQueue());
    const first = createTestRealm(agent, 'first-registration');
    const second = createTestRealm(agent, 'second-registration');
    const callbackRealm = createTestRealm(agent, 'callback');
    const observations: { incumbent: object; task: Task | null; }[] = [];
    const callback = callbackRealm.realm.createFunction(() => {
      observations.push({
        incumbent: callbackRealm.realm.callbacks.captureContext(),
        task: agent.eventLoop.currentlyRunningTask,
      });
    }, { name: 'observe', length: 0 });
    const promise = callbackRealm.realm.evaluate(`
      globalThis.pending = Promise.withResolvers();
      pending.promise;
    `, 'pending-promise.js');
    for (const { realm } of [first, second]) {
      Reflect.set(realm.globalObject, 'promise', promise);
      Reflect.set(realm.globalObject, 'callback', callback);
      realm.evaluate('promise.then(callback)', 'register-promise.js');
    }
    expect(observations).toEqual([]);

    callbackRealm.realm.evaluate('pending.resolve()', 'settle-promise.js');

    expect(observations.map(({ incumbent }) => incumbent))
      .toEqual([first.env, second.env]);
    for (const { task } of observations) {
      expect(task?.source.name).toBe('microtask');
      expect(task?.scriptEvaluationEnvironments)
        .toEqual(new Set([callbackRealm.env]));
    }
    expect(callbackRealm.realm.callbacks.captureContext()).toBe(callbackRealm.env);
    expect(agent.eventLoop.currentlyRunningTask).toBeNull();
  });

  it('retains the stored incumbent for a bound platform callback', () => {
    const checkpoint = vi.fn();
    const agent = new TestAgent(createTestMicrotaskQueue(checkpoint));
    const callbackRealm = createTestRealm(agent, 'callback');
    const incumbentRealm = createTestRealm(agent, 'incumbent');
    const assembly = new DefinitionAssembly([defineCallbackFunction({
      arguments: [],
      name: 'LifecycleCallback',
      returns: idlType.undefined,
    })]);
    const incumbentContext = new RealmBinding(
      assembly,
      incumbentRealm.realm,
      new BindingWorld([]), (ctx) => ({ realm: ctx.realm }),
    );
    let observation: {
      incumbent: object;
      checkpointCount: number;
      task: Task | null;
    } | undefined;

    const observe = callbackRealm.realm.createFunction(
      () => {
        observation = {
          checkpointCount: checkpoint.mock.calls.length,
          incumbent: callbackRealm.realm.callbacks.captureContext(),
          task: agent.eventLoop.currentlyRunningTask,
        };
      },
      { length: 0, name: 'observe' },
    );
    Reflect.set(callbackRealm.realm.globalObject, 'observe', observe);
    const callback = callbackRealm.realm.evaluate(
      'observe.bind(undefined)',
      'callback.js',
    );
    Reflect.set(incumbentRealm.realm.globalObject, 'callback', callback);
    Reflect.set(incumbentRealm.realm.globalObject, 'convert', (value: unknown) =>
      incumbentContext.getConverter(incumbentContext.assembly.getIDLType(reference('LifecycleCallback'))).jsToIDL(value));
    const callbackValue = incumbentRealm.realm.evaluate(
      'convert(callback)',
      'convert-callback.js',
    );
    if (!IDLCallbackFunction.is(callbackValue)) {
      throw new Error('LifecycleCallback did not convert to a callback value');
    }
    Reflect.set(incumbentRealm.realm.globalObject, 'invoke', () =>
      callbackValue.invoke([], 'rethrow'));
    checkpoint.mockClear();

    incumbentRealm.realm.evaluate('invoke()', 'invoke-callback.js');

    expect(observation?.incumbent).toBe(incumbentRealm.env);
    expect(observation?.checkpointCount).toBe(0);
    expect(observation?.task?.scriptEvaluationEnvironments)
      .toEqual(new Set([
        incumbentRealm.env,
        callbackRealm.env,
      ]));
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(agent.eventLoop.currentlyRunningTask).toBeNull();
  });

  // Skipped by agreement: this translation of HTML §8.1.3.3's examples is uncertain.
  // createFunction supplies an ordinary JavaScript forwarding function; observe
  // is not an established stand-in for a native API that reads the incumbent.
  // Revisit with the actual example pages and platform APIs when supported.
  it.skip('captures B as incumbent when A calls B to register a bound event listener', () => {
    const agent = new TestAgent(createTestMicrotaskQueue());
    const entry = createTestRealm(agent, 'a');
    const author = createTestRealm(agent, 'b');
    entry.context.install(entry.realm.globalObject);
    const observations: string[] = [];
    const observe = entry.realm.createFunction(() => {
      const incumbent = entry.realm.callbacks.captureContext();
      observations.push(incumbent === author.env ? 'B' : incumbent === entry.env ? 'A' : 'other');
    }, { name: 'observe', length: 0 });
    const register = author.realm.evaluate(
      '(target, callback) => target.addEventListener("probe", callback)',
      'b.js',
    );
    Reflect.set(entry.realm.globalObject, 'register', register);
    Reflect.set(entry.realm.globalObject, 'observe', observe);
    entry.realm.evaluate(`
      globalThis.target = new EventTarget();
      register(target, observe.bind(undefined));
    `, 'a.js');

    entry.realm.evaluate('target.dispatchEvent(new Event("probe"))', 'dispatch.js');

    expect(observations).toEqual(['B']);
  });

  it('keeps backup incumbent stacks independent per event loop', () => {
    const first = createTestRealm(
      new TestAgent(createTestMicrotaskQueue()),
      'first',
    );
    const second = createTestRealm(
      new TestAgent(createTestMicrotaskQueue()),
      'second',
    );
    const firstLoop = first.realm.agent.eventLoop;

    firstLoop.prepareToRunCallback(first.env);
    try {
      expect(first.realm.callbacks.captureContext()).toBe(first.env);
      expect(second.realm.callbacks.captureContext()).toBe(second.env);
      expect(() => second.realm.agent.eventLoop
        .prepareToRunCallback(first.env))
        .toThrow('another event loop');
    } finally {
      firstLoop.cleanUpAfterRunningCallback(first.env);
    }
  });

  it('suppresses a reentrant checkpoint during callback cleanup', () => {
    let reenter: (() => void) | undefined;
    const checkpoint = vi.fn(() => {
      const steps = reenter;
      reenter = undefined;
      steps?.();
    });
    const agent = new TestAgent(createTestMicrotaskQueue(checkpoint));
    const entry = createTestRealm(agent, 'reentrant');
    const assembly = new DefinitionAssembly([defineCallbackFunction({
      arguments: [],
      name: 'LifecycleCallback',
      returns: idlType.undefined,
    })]);
    const context = new RealmBinding(
      assembly,
      entry.realm,
      new BindingWorld([]), (ctx) => ({ realm: ctx.realm }),
    );
    Reflect.set(entry.realm.globalObject, 'convert', (value: unknown) =>
      context.getConverter(context.assembly.getIDLType(reference('LifecycleCallback'))).jsToIDL(value));
    const callbackValue = entry.realm.evaluate(
      'convert(() => {})',
      'create-reentrant-callback.js',
    );
    if (!IDLCallbackFunction.is(callbackValue)) {
      throw new Error('LifecycleCallback did not convert to a callback value');
    }
    checkpoint.mockClear();
    reenter = () => {
      callbackValue.invoke([], 'rethrow');
    };

    entry.realm.evaluate('undefined', 'checkpoint-entry.js');

    expect(checkpoint).toHaveBeenCalledOnce();
    expect(agent.eventLoop.currentlyRunningTask).toBeNull();
  });
});

class TestAgent extends Agent {
  constructor(microtaskQueue: JSMicrotaskQueue) {
    super(false, createManualEventLoop());
    this.eventLoop.microtaskQueue = microtaskQueue;
  }
}

class TestEnvironment extends BrowletEnvironment {
  #moduleMap = new ModuleMap();
  #origin = createOpaqueOrigin();
  #policyContainer = new PolicyContainer();
  #globalScopeMixin = new WindowOrWorkerGlobalScopeMixin(this);

  get apiBaseURL(): URLRecord {
    return this.creationURL;
  }

  get globalImplementation(): never {
    throw new Error('This callback fixture has no HTML global implementation');
  }

  get crossOriginIsolatedCapability(): boolean {
    return false;
  }

  get hasCrossSiteAncestor(): boolean {
    return false;
  }

  get moduleMap(): ModuleMap {
    return this.#moduleMap;
  }

  get origin(): Origin {
    return this.#origin;
  }

  get policyContainer(): PolicyContainer {
    return this.#policyContainer;
  }

  get timeOrigin(): Moment {
    return new Moment(monotonicClock, 0);
  }

  getReportingSource(): URLRecord | null {
    return null;
  }

  getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    return this.#globalScopeMixin;
  }
}

function createTestRealm(
  agent: Agent,
  name: string,
) {
  const { realm } = createBrowletRealm(agent, {
    createGlobalObject: () => ({}),
  }, { globalNames: ['Worker'] });
  const baseEnv = new BrowletEnvironmentBase({
    userAgent: new UserAgent(),
    isSecureContext: false,
    creationURL: requireURL(`https://${name}.test/`),
    targetBrowsingContext: null,
    topLevelCreationURL: null,
    topLevelOrigin: null,
  });
  const context = browletBindingWorld.register(realm, (binding) =>
    new TestEnvironment(realm, baseEnv, createBrowletEnvironmentInit(binding)),
  );
  const env = realm.env;
  return { realm, env, context };
}

function createTestMicrotaskQueue(
  performMicrotaskCheckpoint: () => void = () => {},
): JSMicrotaskQueue {
  return {
    kind: 'ambient',
    enqueueMicrotask: (steps) => { queueMicrotask(steps); },
    performMicrotaskCheckpoint,
  };
}

function requireURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new Error(`Could not parse ${input}`);
  return url;
}
