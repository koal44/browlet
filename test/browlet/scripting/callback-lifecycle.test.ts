import { describe, expect, it, vi } from 'vitest';
import { nodeRuntime } from '../../../src/js-engine/index';
import { installHostHooks } from '../../../src/browlet/scripting/host-hooks';

import { createOpaqueOrigin, type Origin } from
  '../../../src/url/origin';
import { parseURL, type URLRecord } from '../../../src/url/url';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { RealmBinding } from '../../../src/web-idl/binding';
import { invokeCallbackFunction } from '../../../src/web-idl/callback';
import { isCallbackFunctionValue } from
  '../../../src/web-idl/callback-value';
import { convertToIDL } from '../../../src/web-idl/conversion';
import {
  defineCallbackFunction, idlType, reference,
} from '../../../src/web-idl/declaration/index';
import { PlatformObjectRegistry } from
  '../../../src/web-idl/platform-object';
import type { PolicyContainer } from
  '../../../src/browlet/browsing/policy/container';
import type { ModuleMap } from
  '../../../src/browlet/dom/nodes/document';
import { Agent } from '../../../src/browlet/scripting/agents';
import { EnvironmentSettingsObject } from
  '../../../src/browlet/scripting/environment';
import type { EventLoopOptions, Task } from
  '../../../src/browlet/scripting/event-loop';
import {
  Moment, monotonicClock, UnsafeMoment,
} from '../../../src/browlet/performance/clock';
import {
  createRealm, Realm,
} from '../../../src/browlet/scripting/realm';

describe('HTML callback and script-entry lifecycle', () => {
  it('retains each Promise registration incumbent independently of the callback realm', () => {
    installHostHooks();
    const agent = new TestAgent({
      ...createEventLoopOptions(),
      createMicrotaskQueue: nodeRuntime.createMicrotaskQueue,
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
      .toEqual([first.settings, second.settings]);
    for (const { task } of observations) {
      expect(task?.source.name).toBe('microtask');
      expect(task?.scriptEvaluationEnvironmentSettingsObjectSet)
        .toEqual(new Set([callbackRealm.settings]));
    }
    expect(callbackRealm.realm.callbacks.captureContext()).toBe(callbackRealm.settings);
    expect(agent.eventLoop.currentlyRunningTask).toBeNull();
  });

  it('retains the stored incumbent for a bound platform callback', () => {
    const checkpoint = vi.fn();
    const agent = new TestAgent(createEventLoopOptions(checkpoint));
    const callbackRealm = createTestRealm(agent, 'callback');
    const incumbentRealm = createTestRealm(agent, 'incumbent');
    const definitions = assembleDefinitions([defineCallbackFunction({
      arguments: [],
      name: 'LifecycleCallback',
      returns: idlType.undefined,
    })]);
    const incumbentContext = new RealmBinding(
      definitions,
      incumbentRealm.realm,
      new PlatformObjectRegistry(),
    );
    let observation: {
      readonly incumbent: object;
      readonly checkpointCount: number;
      readonly task: Task | null;
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
      convertToIDL(
        value,
        reference('LifecycleCallback'),
        incumbentContext,
      ));
    const callbackValue = incumbentRealm.realm.evaluate(
      'convert(callback)',
      'convert-callback.js',
    );
    if (!isCallbackFunctionValue(callbackValue)) {
      throw new Error('LifecycleCallback did not convert to a callback value');
    }
    Reflect.set(incumbentRealm.realm.global, 'invoke', () =>
      invokeCallbackFunction(callbackValue, [], 'rethrow'));
    checkpoint.mockClear();

    incumbentRealm.realm.evaluate('invoke()', 'invoke-callback.js');

    expect(observation?.incumbent).toBe(incumbentRealm.settings);
    expect(observation?.checkpointCount).toBe(0);
    expect(observation?.task?.scriptEvaluationEnvironmentSettingsObjectSet)
      .toEqual(new Set([
        incumbentRealm.settings,
        callbackRealm.settings,
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

    firstLoop.prepareToRunCallback(first.settings);
    try {
      expect(first.realm.callbacks.captureContext()).toBe(first.settings);
      expect(second.realm.callbacks.captureContext()).toBe(second.settings);
      expect(() => second.realm.agent.eventLoop
        .prepareToRunCallback(first.settings))
        .toThrow('another event loop');
    } finally {
      firstLoop.cleanUpAfterRunningCallback(first.settings);
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
    const definitions = assembleDefinitions([defineCallbackFunction({
      arguments: [],
      name: 'LifecycleCallback',
      returns: idlType.undefined,
    })]);
    const context = new RealmBinding(
      definitions,
      entry.realm,
      new PlatformObjectRegistry(),
    );
    Reflect.set(entry.realm.global, 'convert', (value: unknown) =>
      convertToIDL(value, reference('LifecycleCallback'), context));
    const callbackValue = entry.realm.evaluate(
      'convert(() => {})',
      'create-reentrant-callback.js',
    );
    if (!isCallbackFunctionValue(callbackValue)) {
      throw new Error('LifecycleCallback did not convert to a callback value');
    }
    checkpoint.mockClear();
    reenter = () => {
      invokeCallbackFunction(callbackValue, [], 'rethrow');
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

class TestEnvironmentSettingsObject extends EnvironmentSettingsObject {
  readonly #moduleMap: ModuleMap = { entries: [] };
  readonly #origin = createOpaqueOrigin();
  readonly #policyContainer: PolicyContainer = {
    cspList: [],
    embedderPolicy: {},
    integrityPolicy: {},
    referrerPolicy: 'strict-origin-when-cross-origin',
    reportOnlyIntegrityPolicy: {},
  };

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
}

function createTestRealm(
  agent: Agent,
  name: string,
): {
  readonly realm: Realm;
  readonly settings: EnvironmentSettingsObject;
} {
  const executionContext = createRealm(agent, {
    createGlobalObject: () => ({}),
  });
  const settings = new TestEnvironmentSettingsObject({
    creationURL: requireURL(`https://${name}.test/`),
    realmExecutionContext: executionContext,
    targetBrowsingContext: null,
    topLevelCreationURL: null,
    topLevelOrigin: null,
  });
  Realm.setHostDefined(executionContext.realm, settings);
  return { realm: executionContext.realm, settings };
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
