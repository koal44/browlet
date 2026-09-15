import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { promiseHooks } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { Browlet } from '../../../src/browlet/browlet';
import {
  createDocument, createStructuredClone, createWindowRealm, getRelevantRealm,
} from '../../../src/browlet/bindings';
import { WindowImpl } from '../../../src/browlet/browsing/window/window';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import { setupWindowEnvironmentSettingsObject } from '../../../src/browlet/scripting/environment';
import { networkingTaskSource, queueGlobalTask } from '../../../src/browlet/scripting/tasks';
import { runInParallel } from '../../../src/browlet/integration/scripting';
import { unsafeSharedCurrentTime } from '../../../src/browlet/performance/high-resolution-time';
import {
  BindingWorld, arg, atArg, ctor, defineCallbackFunction, defineInterface, idlType, impl, op,
  promise, reference, roAttr,
} from '../../../src/web-idl/index';
import type { Promises, PromiseValue } from '../../../src/js-engine/index';

describe('implementation Promise delivery', () => {
  it('keeps runtime instrumentation on Node during projected construction', async () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    new BindingWorld([initializationIDL]).register(realm).install(realm.global);
    const constructor = Reflect.get(browlet.window, 'InitializationProbe') as new () => object;
    const unrelated = new AsyncLocalStorage<string>();
    let reported: string | undefined;
    // Stop before creating the report so it cannot instrument itself.
    const stop = promiseHooks.onInit(() => {
      stop();
      void Promise.resolve().then(() => { reported = unrelated.getStore(); });
    }) as () => void;
    try {
      unrelated.run('instrumentation', () => { Reflect.construct(constructor, []); });
      await setImmediate();
      expect(reported).toBe('instrumentation');
    } finally {
      stop();
      realm.agent.eventLoop.performMicrotaskCheckpoint();
    }
  });

  itPassesWith('explicitQueues')('completes initialization started by a projected constructor', () => {
    const browlet = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browlet.window);
    new BindingWorld([initializationIDL]).register(realm).install(realm.global);
    const trace: string[] = [];
    browlet.expose('record', (value: string) => { trace.push(value); });
    realm.evaluate('new InitializationProbe().ready.then(value => record(value))', 'construct.js');
    expect(trace).toEqual(['ready']);
  });

  itPassesWith('explicitQueues')('keeps Node I/O separate and completes on the destination task checkpoint', async () => {
    const { a, trace, pending } = createFixture();
    a.expose('operation', a.object);
    a.realm.evaluate('operation.read().then(value => record(value))', 'read.js');
    const ready = Promise.withResolvers<void>();
    const unrelated = new AsyncLocalStorage<string>();
    unrelated.run('backend library', () => {
      runInParallel(() => {
        void readFile('package.json').then((bytes) => {
          expect(bytes.length).toBeGreaterThan(0);
          expect(unrelated.getStore()).toBe('backend library');
          queueGlobalTask(networkingTaskSource, a.realm.globalObject, () => {
            expect(unrelated.getStore()).toBe('backend library');
            trace.push('completion task');
            pending.resolve('done');
          });
          ready.resolve();
        }, ready.reject);
      });
    });
    a.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(trace).toEqual([]);
    await ready.promise;
    void Promise.resolve().then(() => trace.push('unrelated Node'));
    const loop = a.realm.agent.eventLoop;
    expect(loop.runTaskTurn({
      createMicrotaskQueue: () => loop.microtaskQueue,
      requestEventLoopTurn: () => {},
      unsafeSharedCurrentTime,
    })).toBe(true);
    expect(trace).toEqual(['completion task', 'A continues', 'A after continuation', 'A done']);
    await Promise.resolve();
    expect(trace.at(-1)).toBe('unrelated Node');
  });

  itPassesWith('explicitQueues')('routes shared-source continuations by receiver, independently of the settler', async () => {
    const { a, b, trace, pending } = createFixture();
    const unrelated = new AsyncLocalStorage<string>();
    unrelated.run('other library', () => {
      a.implementation.observe = () => expect(unrelated.getStore()).toBe('other library');
      b.implementation.observe = a.implementation.observe;
      // A borrowed method still operates for A; a getter enters for B too.
      const borrowed = Reflect.get(b.object, 'read') as CallableFunction;
      a.expose('result', Reflect.apply(borrowed, a.object, []));
      b.expose('result', Reflect.get(b.object, 'result'));
      for (const entry of [a, b]) {
        entry.realm.evaluate('result.then(value => record(value))', 'observe.js');
      }
    });
    const c = getRelevantRealm(new Browlet({ route: () => '' }).window);
    c.createFunction(() => { pending.resolve('done'); }, { name: 'settle', length: 0 })();
    void Promise.resolve().then(() => trace.push('Node promise'));
    queueMicrotask(() => trace.push('Node microtask'));

    a.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(trace).toEqual(['A continues', 'A after continuation', 'A done']);
    b.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(trace).toEqual([
      'A continues', 'A after continuation', 'A done',
      'B continues', 'B after continuation', 'B done',
    ]);
    await Promise.resolve();
    expect(trace.slice(-2)).toEqual(['Node promise', 'Node microtask']);
  });

  itPassesWith('hostHooks').each(['fulfill', 'reject'] as const)('delivers an author callback result to its caller on %s', async (mode) => {
    const { a, b, trace, pending } = createFixture(true);
    b.expose('operation', b.object);
    const callback = b.realm.evaluate(`() => {
      Promise.resolve().then(() => record('author B'));
      return operation.read().then(value => {
        ${mode === 'reject' ? 'throw 17;' : 'return value;'}
      });
    }`, 'callback.js');
    a.expose('callback', callback);
    a.expose('operation', a.object);
    a.realm.evaluate(`operation.invoke(callback).then(
      value => record(value), reason => record('rejected ' + reason))`, 'invoke.js');
    expect(trace).toEqual(['author B']);
    expect(b.callbackSettings).toEqual([new Set([b.realm.hostDefined])]);
    pending.resolve('done');
    a.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(trace).toEqual(mode === 'fulfill'
      ? ['author B', 'B continues', 'B after continuation', 'A callback returned', 'A B done']
      : ['author B', 'B continues', 'B after continuation', 'rejected 17']);
    await Promise.resolve();
  });

  itPassesWith('explicitQueues').each(['pending', 'settled'] as const)('converts a %s promise argument for the receiver of a borrowed method', (state) => {
    const { a, b, trace } = createFixture();
    const pending = new a.realm.intrinsics.promise.constructor<string>((resolve) => {
      a.expose('settle', () => { resolve('input'); });
    });
    if (state === 'settled') (Reflect.get(a.realm.globalThis, 'settle') as () => void)();
    const borrowed = Reflect.get(b.object, 'consume') as CallableFunction;
    a.expose('result', Reflect.apply(borrowed, a.object, [pending]));
    a.realm.evaluate('result.then(value => record(value))', 'consume.js');
    if (state === 'pending') {
      expect(trace).toEqual([]);
      (Reflect.get(a.realm.globalThis, 'settle') as () => void)();
    }
    a.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(trace).toEqual(['A input']);
  });
});

function createFixture(sharedAgent = false) {
  const trace: string[] = [];
  const pending = Promise.withResolvers<string>();
  const bindings = new BindingWorld([operationIDL, callbackIDL]);
  const first = new Browlet({ route: () => '' });
  const secondWindow = sharedAgent
    ? createSiblingWindow(first)
    : new Browlet({ route: () => '' }).window;
  const entries = [first.window, secondWindow].map((window, index) => {
    const name = index === 0 ? 'A' : 'B';
    const realm = getRelevantRealm(window);
    const callbackSettings: unknown[] = [];
    const expose = (key: string, value: unknown) => {
      Object.defineProperty(window, key, { configurable: true, value });
    };
    const binding = bindings.register(realm);
    const implementation = new OwnershipProbeImpl(
      name, realm.promises.import(pending.promise, String), trace, realm.promises,
    );
    const object = binding.project(OwnershipProbeImpl, implementation);
    expose('record', (value: string) => {
      if (value === 'author B') {
        const settings = realm.agent.eventLoop.currentlyRunningTask
          ?.scriptEvaluationEnvironmentSettingsObjectSet;
        callbackSettings.push(settings && new Set(settings));
      }
      trace.push(value);
    });
    return { expose, realm, object, implementation, callbackSettings };
  });
  return { a: entries[0]!, b: entries[1]!, trace, pending };
}

// Compose a second Window on the existing agent without requiring iframe navigation.
function createSiblingWindow(first: Browlet): Window {
  const firstRealm = getRelevantRealm(first.window);
  const { agent, hostDefined: settings } = firstRealm;
  if (!(agent instanceof WindowAgent) || !settings) throw new Error('Expected a Window agent');
  const window = new WindowImpl(new URL('about:blank'));
  const execution = createWindowRealm(agent, window);
  const document = createDocument(execution.realm);
  window.setAssociatedDocument(document);
  setupWindowEnvironmentSettingsObject(settings.creationURL, execution, null,
    settings.creationURL, settings.origin, createStructuredClone(execution.realm));
  return execution.realm.globalThis as Window;
}

class OwnershipProbeImpl {
  observe = () => {};
  constructor(
    readonly name: string,
    readonly pending: PromiseValue<string>,
    readonly trace: string[],
    readonly promises: Promises,
  ) {}

  get result(): PromiseValue<string> { return this.read(); }

  read(): PromiseValue<string> {
    return this.pending.then((value) => {
      this.observe();
      this.trace.push(`${this.name} continues`);
      return this.promises.resolve().then(() => {
        this.observe();
        this.trace.push(`${this.name} after continuation`);
        return `${this.name} ${value}`;
      });
    });
  }

  invoke(callback: () => PromiseValue<string>): PromiseValue<string> {
    return callback().then((value) => {
      this.trace.push(`${this.name} callback returned`);
      return `${this.name} ${value}`;
    });
  }

  consume(value: PromiseValue<string>): PromiseValue<string> {
    return value.then((value) => `${this.name} ${value}`);
  }
}

// callback OwnershipCallback = Promise<DOMString> ();
const callbackIDL = defineCallbackFunction({
  name: 'OwnershipCallback', returns: promise(idlType.DOMString), arguments: [],
});
// interface OwnershipProbe {
//   readonly attribute Promise<DOMString> result;
//   Promise<DOMString> read();
//   Promise<DOMString> invoke(OwnershipCallback callback);
//   Promise<DOMString> consume(Promise<DOMString> value);
// };
const operationIDL = defineInterface({
  name: 'OwnershipProbe', exposed: '*', implementation: impl(OwnershipProbeImpl),
  members: [
    roAttr('result', promise(idlType.DOMString)),
    op('read', promise(idlType.DOMString)),
    op('invoke', promise(idlType.DOMString), [arg('callback', reference('OwnershipCallback'))]),
    op('consume', promise(idlType.DOMString), [arg('value', promise(idlType.DOMString))]),
  ],
});

class InitializationProbeImpl {
  readonly #ready: PromiseValue<string>;

  constructor(promises: Promises) {
    this.#ready = promises.resolve().then(() => promises.resolve().then(() => 'ready'));
  }

  get ready(): PromiseValue<string> { return this.#ready; }
}

// interface InitializationProbe {
//   constructor();
//   readonly attribute Promise<DOMString> ready;
// };
const initializationIDL = defineInterface({
  name: 'InitializationProbe', exposed: '*', implementation: impl(InitializationProbeImpl, {
    constructWith: [atArg(0, (ctx) => ctx.promises)],
  }),
  members: [ctor(), roAttr('ready', promise(idlType.DOMString))],
});
