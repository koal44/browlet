import { EOL } from 'node:os';

import type { RuntimeContext } from '../../js-engine/index';
import type { BindingContext } from '../../web-idl/projection';
import type { WindowImpl } from '../browsing/window/window';
import { AbortControllerImpl } from '../dom/abort/abort-controller';
import { createTaskSource } from '../scripting/event-loop';
import type { StructuredCloneSteps } from '../scripting/global-scope';
import type { Realm } from '../scripting/realm';
import { structuredDeserialize } from '../scripting/structured-data/deserialize';
import type { StructuredDataEnvironment } from '../scripting/structured-data/environment';
import type { SerializedRecord } from '../scripting/structured-data/records';
import { structuredSerialize } from '../scripting/structured-data/serialize';
import { structuredClone } from '../scripting/structured-data/structured-clone';
import { queueGlobalTask } from '../scripting/tasks';
import { fetchTaskScheduling } from './fetch';
import { runInParallel } from './scripting';

/** BINDING_INTEGRATION: compose implementation facilities for a Window realm. */
export function createWindowRuntime(
  realm: Realm,
  window: WindowImpl,
  context: BindingContext,
): RuntimeContext {
  // Global installation completes after registration. Host operations run later.
  return {
    nativeLineEnding: EOL === '\r\n' ? '\r\n' : '\n',
    promises: realm.promises,
    buffers: realm.createRuntimeBuffers(),
    queueMicrotask: (steps) => { realm.queueMicrotask(steps); },
    fileReading: {
      queueTask: (steps) => queueGlobalTask(fileReadingTaskSource, realm.global, steps),
      runInParallel,
    },
    networking: fetchTaskScheduling,
    createAbortController: () => context.construct(AbortControllerImpl),
    clone: (value) => window.getWindowOrWorkerGlobalScopeMixin().structuredClone(value),
    ...createRuntimeSerialization(realm, context),
  };
}

/** Supply HTML serialization with the owning realm and its platform bindings. */
export function createRuntimeSerialization(
  realm: Realm,
  context: BindingContext,
): Pick<RuntimeContext, 'serialize' | 'deserialize'> {
  return {
    // Exception requests become recognizable platform objects at serialization.
    serialize: (value) => structuredSerialize(
      context.realizeException(value),
      getStructuredDataEnvironment(realm, context),
    ),
    deserialize: (record) => structuredDeserialize(
      record as SerializedRecord,
      getStructuredDataEnvironment(realm, context),
    ),
  };
}

/** Supply HTML cloning with the destination realm and its platform bindings. */
export function createStructuredClone(
  realm: Realm,
  context: BindingContext,
): StructuredCloneSteps {
  return (value, transferList) =>
    structuredClone(value, transferList, getStructuredDataEnvironment(realm, context));
}

function getStructuredDataEnvironment(
  realm: Realm,
  context: BindingContext,
): StructuredDataEnvironment {
  const agentCluster = realm.agent.agentCluster;
  if (!agentCluster) throw new Error('Realm agent has no agent cluster');
  return { agentCluster, context, realm };
}

const fileReadingTaskSource = createTaskSource('file reading');
