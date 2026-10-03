import { describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';
import { createMicrotaskQueue } from '../../../src/js-engine/index';
import { installHostHooks } from '../../../src/browlet/scripting/host-hooks';
import { createBoundExecution, registerRealm } from '../../../src/browlet/bindings';

import { createOpaqueOrigin, type Origin } from
  '../../../src/url/origin';
import { parseURL, type URLRecord } from '../../../src/url/url';
import { DefinitionAssembly } from '../../../src/web-idl/assembly/index';
import { RealmBinding } from '../../../src/web-idl/binding/realm';
import { IDLCallbackFunction } from '../../../src/web-idl/values/callback';

import {
  defineCallbackFunction, idlType, reference,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { PolicyContainer } from '../../../src/browlet/browsing/policy/container';
import type { ModuleMap } from
  '../../../src/browlet/dom/nodes/document';
import { Agent } from '../../../src/browlet/scripting/agents';
import { UserAgent } from '../../../src/browlet/user-agent';
import { BrowletEnvironment, EnvironmentRecord } from
  '../../../src/browlet/scripting/environment';
import { WindowOrWorkerGlobalScopeMixin } from '../../../src/browlet/scripting/global-scope';
import type { EventLoopOptions, Task } from
  '../../../src/browlet/scripting/event-loop';
import {
  Moment, monotonicClock, UnsafeMoment,
} from '../../../src/browlet/performance/clock';
import {
  createRealm,
} from '../../../src/browlet/scripting/realm';

describe('HTML callback and script-entry lifecycle', () => {
  it('attaches the environment to its realm during construction', () => {
    const agent = new TestAgent(createEventLoopOptions());
    const { realm, env, context } = createTestRealm(agent, 'attachment');

    expect(realm.hostDefined).toBe(env);
    expect(realm.env).toBe(env);
    expect(realm.envRecord).toBe(env);
    expect(env.realm).toBe(realm);
    expect(context.getEnvironment()).toBe(env);
  });

  it('uses the non-Window environment timer owner for AbortSignal.timeout', () => {
    const options = createEventLoopOptions();
    const agent = new TestAgent(options);
    const { realm, env, context } = createTestRealm(agent, 'abort-timeout');
    context.install(realm.global);
    const timers = env.getWindowOrWorkerGlobalScopeMixin().timers;
    const schedule = vi.spyOn(timers, 'runStepsAfterTimeout')
      .mockReturnValue(Symbol('Timer'));

    realm.evaluate('globalThis.signal = AbortSignal.timeout(10)', 'abort-timeout.js');

    expect(schedule).toHaveBeenCalledWith('AbortSignal-timeout', 10, expect.any(Function));
    expect(realm.evaluate('signal.aborted', 'before-timeout.js')).toBe(false);
    schedule.mock.calls[0]![2]();
    expect(agent.eventLoop.runTaskTurn(options)).toBe(true);
    expect(realm.evaluate('[signal.aborted, signal.reason.name]', 'after-timeout.js'))
      .toEqual([true, 'TimeoutError']);
  });

  itPassesWith('hostHooks')('uses the non-Window environment timer owner for engine timeouts', () => {
    installHostHooks();
    const options = { ...createEventLoopOptions(), createMicrotaskQueue };
    const agent = new TestAgent(options);
    const { realm, env } = createTestRealm(agent, 'engine-timeout');
    const timers = env.getWindowOrWorkerGlobalScopeMixin().timers;
    const schedule = vi.spyOn(timers, 'runStepsAfterTimeout')
      .mockReturnValue(Symbol('Timer'));
    Reflect.set(realm.global, 'waitArray', new Int32Array(new SharedArrayBuffer(4)));
    realm.evaluate(`
      globalThis.result = undefined;
      Atomics.waitAsync(waitArray, 0, 0, 10).value.then(value => { result = value; });
    `, 'engine-timeout.js');

    // The engine supplies the remaining deadline, after any setup time has elapsed.
    expect(schedule).toHaveBeenCalledWith('JavaScript', expect.any(Number), expect.any(Function));
    schedule.mock.calls[0]![2]();
    expect(agent.eventLoop.runTaskTurn(options)).toBe(true);
    expect(realm.evaluate('result', 'after-timeout.js')).toBe('timed-out');
  });

  itPassesWith('hostHooks')('retains each Promise registration incumbent independently of the callback realm', () => {
    installHostHooks();
    const agent = new TestAgent({
      ...createEventLoopOptions(),
      createMicrotaskQueue,
    });
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
      Reflect.set(realm.global, 'promise', promise);
      Reflect.set(realm.global, 'callback', callback);
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
    const agent = new TestAgent(createEventLoopOptions(checkpoint));
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
    Reflect.set(callbackRealm.realm.global, 'observe', observe);
    const callback = callbackRealm.realm.evaluate(
      'observe.bind(undefined)',
      'callback.js',
    );
    Reflect.set(incumbentRealm.realm.global, 'callback', callback);
    Reflect.set(incumbentRealm.realm.global, 'convert', (value: unknown) =>
      incumbentContext.getConverter(incumbentContext.assembly.getIDLType(reference('LifecycleCallback'))).jsToIDL(value));
    const callbackValue = incumbentRealm.realm.evaluate(
      'convert(callback)',
      'convert-callback.js',
    );
    if (!IDLCallbackFunction.is(callbackValue)) {
      throw new Error('LifecycleCallback did not convert to a callback value');
    }
    Reflect.set(incumbentRealm.realm.global, 'invoke', () =>
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

  it('keeps backup incumbent stacks independent per event loop', () => {
    const first = createTestRealm(
      new TestAgent(createEventLoopOptions()),
      'first',
    );
    const second = createTestRealm(
      new TestAgent(createEventLoopOptions()),
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
    const agent = new TestAgent(createEventLoopOptions(checkpoint));
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
    Reflect.set(entry.realm.global, 'convert', (value: unknown) =>
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
  constructor(options: EventLoopOptions) {
    super(false, options);
  }
}

class TestEnvironment extends BrowletEnvironment {
  #moduleMap: ModuleMap = { entries: [] };
  #origin = createOpaqueOrigin();
  #policyContainer = new PolicyContainer();
  #globalScopeMixin = new WindowOrWorkerGlobalScopeMixin(this);

  get apiBaseURL(): URLRecord {
    return this.creationURL;
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
  const realm = createRealm(agent, {
    createGlobalObject: () => ({}),
  }, { globalNames: ['Worker'] });
  const record = new EnvironmentRecord({
    userAgent: new UserAgent(),
    isSecureContext: false,
    creationURL: requireURL(`https://${name}.test/`),
    targetBrowsingContext: null,
    topLevelCreationURL: null,
    topLevelOrigin: null,
  });
  const context = registerRealm(realm, (binding) => new TestEnvironment(realm, record, createBoundExecution(binding)));
  const env = realm.env;
  return { realm, env, context };
}

function createEventLoopOptions(
  performMicrotaskCheckpoint: () => void = () => {},
): EventLoopOptions {
  return {
    createMicrotaskQueue: () => ({
      kind: 'ambient',
      enqueueMicrotask: (steps) => { queueMicrotask(steps); },
      performMicrotaskCheckpoint,
    }),
    requestEventLoopTurn: () => {},
    unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
  };
}

function requireURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new Error(`Could not parse ${input}`);
  return url;
}
