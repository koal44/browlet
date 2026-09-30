import { SandboxEnvironment, type BrowletEnvironment } from '../../src/browlet/scripting/environment';
import { vi } from 'vitest';

import { createBoundExecution, getBindingContext, getRelevantRealm } from '../../src/browlet/bindings';
import { TopLevelTraversable } from '../../src/browlet/browsing/navigable';
import { monotonicClock, UnsafeMoment } from '../../src/browlet/performance/clock';
import { Realm } from '../../src/browlet/scripting/realm';
import { AgentCluster } from '../../src/browlet/scripting/agents';
import { networkingTaskSource } from '../../src/browlet/scripting/tasks';
import { UserAgent } from '../../src/browlet/user-agent';
import { fetch, type FetchOptions } from '../../src/fetch/fetch';
import type { FetchController } from '../../src/fetch/controller';
import type { FetchRequest } from '../../src/fetch/request';
import type { FetchResponse } from '../../src/fetch/response';
import type { TaskCreationOptions } from '../../src/infra/execution';
import type { JSEnvironment } from '../../src/js-engine/environment';
import { BindingWorld, type BindingContext } from '../../src/web-idl/index';
import { createControllerFixture } from '../fetch/controller-fixture';

/** Configure a fetch through its public entry; start() supplies the controller and awaits response delivery. */
export function createFetchOperation(request: FetchRequest, env: JSEnvironment) {
  let controller: FetchController;
  const options: FetchOptions = { useParallelQueue: true };
  return {
    request, env, options,
    start() {
      const response = Promise.withResolvers<FetchResponse>();
      controller = fetch(request, {
        ...options,
        processResponse: (value) => {
          options.processResponse?.(value);
          response.resolve(value);
        },
      }, env);
      return response.promise;
    },
    get controller() { return controller; },
  };
}

/** Capture an invariant failure thrown on Fetch's owning task, without changing ordinary task delivery. */
export function nextFetchTaskError(env: JSEnvironment) {
  const failure = Promise.withResolvers<unknown>();
  const queue = env.exec.queueTask.bind(env.exec);
  const spy = vi.spyOn(env.exec, 'queueTask').mockImplementation((source, steps, options?: TaskCreationOptions) => {
    if (source === 'timer' && options !== undefined) return queue(source, steps, options);
    if (source !== 'network') return queue(source, steps);
    return queue(source, () => {
      try { steps(); }
      catch (error) { spy.mockRestore(); failure.resolve(error); }
    });
  });
  return failure.promise;
}

/** Create a Window for task inspection; the default UserAgent leaves its event loop unstarted. */
export function createFetchWindow(userAgent = new UserAgent()) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  const context = getBindingContext(realm);
  const eventLoop = realm.agent.eventLoop;
  return {
    ...createFetchRealmFixture(context),
    realm,
    document: traversable.activeDocument,
    queueTask(steps: () => void) {
      context.getEnvironment().exec.queueTask('network', steps);
    },
    networkingTasks() {
      return [...eventLoop.getTaskQueue(networkingTaskSource)];
    },
    runTask() {
      return eventLoop.runTaskTurn({
        createMicrotaskQueue: () => eventLoop.microtaskQueue,
        requestEventLoopTurn: vi.fn(),
        unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
      });
    },
  };
}

export function createIsolatedFetchRealm() {
  const realm = new Realm({ crossOriginIsolated: true });
  new AgentCluster('concrete').add(realm.agent);
  const registration = new BindingWorld<BrowletEnvironment>([]).register(realm, (context) => new SandboxEnvironment(realm, createBoundExecution(context)));
  registration.install(realm.global);
  return createFetchRealmFixture(registration);
}

function createFetchRealmFixture(context: BindingContext<BrowletEnvironment>) {
  return {
    ...createControllerFixture(context.getEnvironment()),
    context,
    realm: context.realm,
  };
}
