import { vi } from 'vitest';

import { getRealmBindings, getRelevantRealm } from '../../src/browlet/bindings';
import {
  createNewTopLevelTraversable,
} from '../../src/browlet/browsing/navigable';
import { domExceptionCapabilities } from '../../src/browlet/integration/dom-exception';
import {
  deserializeFetchAbortReason, queueGlobalFetchTask,
} from '../../src/browlet/integration/fetch';
import { createRuntimeSerialization } from '../../src/browlet/integration/runtime';
import { monotonicClock, UnsafeMoment } from '../../src/browlet/performance/clock';
import { Realm } from '../../src/browlet/scripting/realm';
import { AgentCluster } from '../../src/browlet/scripting/agents';
import { networkingTaskSource } from '../../src/browlet/scripting/tasks';
import { UserAgent } from '../../src/browlet/user-agent';
import { queueFetchTask } from '../../src/fetch/tasks';
import { createBindings, type BindingContext } from '../../src/web-idl/index';
import { createControllerFixture } from '../fetch/control-fixture';
import { createRuntime } from '../js-engine/runtime-fixture';

export function createFetchWindow() {
  const traversable = createNewTopLevelTraversable(new UserAgent(), null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  const context = getRealmBindings(realm).context;
  const eventLoop = realm.agent.eventLoop;
  return {
    ...createFetchRealmFixture(context),
    document: traversable.activeDocument,
    queueTask(steps: () => void) {
      queueFetchTask(steps, realm.global, queueGlobalFetchTask);
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
  const registration = createBindings([], {
    capabilities: domExceptionCapabilities,
  }).register(realm, {
    createRuntime: (context) => ({
      ...createRuntime(realm),
      ...createRuntimeSerialization(realm, context),
    }),
  });
  registration.install(realm.global);
  return createFetchRealmFixture(registration.context);
}

function createFetchRealmFixture(context: BindingContext) {
  return {
    ...createControllerFixture(context.getRuntime()),
    context,
    realm: context.realm,
    deserialize: (reason: object | null) => deserializeFetchAbortReason(reason, context),
  };
}
