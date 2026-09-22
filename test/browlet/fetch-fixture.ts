import { vi } from 'vitest';

import { getBindingContext, getRelevantRealm } from '../../src/browlet/bindings';
import {
  createNewTopLevelTraversable,
} from '../../src/browlet/browsing/navigable';
import { domExceptionCapabilities } from '../../src/browlet/integration/dom-exception';
import { deserializeFetchAbortReason } from '../../src/browlet/integration/fetch';
import { createExecution } from '../../src/browlet/integration/execution';
import { monotonicClock, UnsafeMoment } from '../../src/browlet/performance/clock';
import { Realm } from '../../src/browlet/scripting/realm';
import { AgentCluster } from '../../src/browlet/scripting/agents';
import { networkingTaskSource } from '../../src/browlet/scripting/tasks';
import { UserAgent } from '../../src/browlet/user-agent';
import { queueFetchTask } from '../../src/fetch/tasks';
import { BindingWorld, type BindingContext } from '../../src/web-idl/index';
import { createControllerFixture } from '../fetch/control-fixture';

/** Create a Window for task inspection; the default UserAgent leaves its event loop unstarted. */
export function createFetchWindow(userAgent = new UserAgent()) {
  const traversable = createNewTopLevelTraversable(userAgent, null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  const context = getBindingContext(realm);
  const eventLoop = realm.agent.eventLoop;
  return {
    ...createFetchRealmFixture(context),
    realm,
    document: traversable.activeDocument,
    queueTask(steps: () => void) {
      queueFetchTask(steps, realm.global, context.getExecution());
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
  const registration = new BindingWorld<Realm>([], {
    capabilities: domExceptionCapabilities,
  }).register(realm, createExecution);
  registration.install(realm.global);
  return createFetchRealmFixture(registration);
}

function createFetchRealmFixture(context: BindingContext<Realm>) {
  return {
    ...createControllerFixture(context.getExecution()),
    context,
    realm: context.realm,
    deserialize: (reason: object | null) => deserializeFetchAbortReason(reason, context),
  };
}
