import { vi } from 'vitest';

import { browletBindings, getRelevantRealm } from '../../src/browlet/bindings';
import {
  createNewTopLevelTraversable,
} from '../../src/browlet/browsing/navigable';
import { domExceptionCapabilities } from '../../src/browlet/integration/dom-exception';
import {
  createFetchStructuredData, queueGlobalFetchTask,
} from '../../src/browlet/integration/fetch';
import { monotonicClock, UnsafeMoment } from '../../src/browlet/performance/clock';
import { EventLoop } from '../../src/browlet/scripting/event-loop';
import { Realm } from '../../src/browlet/scripting/realm';
import type {
  StructuredDataEnvironment,
} from '../../src/browlet/scripting/structured-data/environment';
import { networkingTaskSource } from '../../src/browlet/scripting/tasks';
import { UserAgent } from '../../src/browlet/user-agent';
import { queueFetchTask } from '../../src/fetch/tasks';
import { createBindings } from '../../src/web-idl/index';
import { createControllerFixture } from '../fetch/control-fixture';

export function createFetchWindow() {
  const traversable = createNewTopLevelTraversable(new UserAgent(), null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  const context = browletBindings.forRealm(realm).context;
  const eventLoop = realm.agent.eventLoop;
  return {
    ...createFetchRealmFixture({
      agentCluster: realm.agent.agentCluster!,
      context,
      realm,
    }),
    document: traversable.activeDocument,
    queueTask(steps: () => void) {
      queueFetchTask(steps, realm.global, queueGlobalFetchTask);
    },
    networkingTasks() {
      return [...EventLoop.getTaskQueue(eventLoop, networkingTaskSource)];
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
  const registration = createBindings([], {
    capabilities: domExceptionCapabilities,
  }).register(realm);
  registration.install(realm.global);
  return createFetchRealmFixture({
    agentCluster: {},
    context: registration.context,
    realm,
  });
}

function createFetchRealmFixture(environment: StructuredDataEnvironment) {
  const structuredData = createFetchStructuredData(environment);
  return {
    ...createControllerFixture(structuredData, environment.context),
    realm: environment.realm,
    structuredData,
  };
}
