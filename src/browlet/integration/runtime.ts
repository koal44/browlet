import { EOL } from 'node:os';

import type { RuntimeContext } from '../../js-engine/index';
import type { BindingContext } from '../../web-idl/index';
import type { WindowImpl } from '../browsing/window/window';
import { AbortControllerImpl } from '../dom/abort/abort-controller';
import { createTaskSource } from '../scripting/event-loop';
import type { StructuredCloneSteps } from '../scripting/global-scope';
import type { Realm } from '../scripting/realm';
import { structuredDeserialize } from '../scripting/structured-data/deserialize';
import type { SerializedRecord } from '../scripting/structured-data/records';
import { structuredSerialize } from '../scripting/structured-data/serialize';
import { structuredClone } from '../scripting/structured-data/structured-clone';
import { fetchTaskScheduling } from './fetch';
import { runInParallel } from './scripting';

/** BINDING_INTEGRATION: compose implementation facilities for a Window realm. */
export function createWindowRuntime(
  window: WindowImpl,
  context: BindingContext<Realm>,
): RuntimeContext {
  const { realm } = context;
  // Global installation completes after registration. Host operations run later.
  return {
    nativeLineEnding: EOL === '\r\n' ? '\r\n' : '\n',
    promises: realm.promises,
    buffers: realm.createRuntimeBuffers(),
    queueMicrotask: (steps) => { realm.queueMicrotask(steps); },
    fileReading: {
      queueTask: (steps) => realm.queueGlobalTask(fileReadingTaskSource, steps),
      runInParallel,
    },
    networking: fetchTaskScheduling,
    createAbortController: () => context.construct(AbortControllerImpl),
    clone: (value) => window.getWindowOrWorkerGlobalScopeMixin().structuredClone(value),
    ...createRuntimeSerialization(context),
  };
}

/** Supply HTML serialization with the owning realm and its platform bindings. */
export function createRuntimeSerialization(
  context: BindingContext<Realm>,
): Pick<RuntimeContext, 'serialize' | 'deserialize'> {
  return {
    // Exception requests become recognizable platform objects at serialization.
    serialize: (value) => structuredSerialize(
      context.realizeException(value),
      context,
    ),
    deserialize: (record) => structuredDeserialize(
      record as SerializedRecord,
      context,
    ),
  };
}

/** Supply HTML cloning with the destination realm and its platform bindings. */
export function createStructuredClone(
  context: BindingContext<Realm>,
): StructuredCloneSteps {
  return (value, transferList) =>
    structuredClone(value, transferList, context);
}

const fileReadingTaskSource = createTaskSource('file reading');
