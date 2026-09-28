import { EOL } from 'node:os';

import type { RealmExecution } from '../../js-engine/index';
import type { BindingContext } from '../../web-idl/index';
import { AbortControllerImpl } from '../dom/abort/abort-controller';
import { AbortSignalImpl } from '../dom/abort/abort-signal';
import { EventImpl } from '../dom/events/event';
import type { EventExecution } from '../dom/environment';
import { createTaskSource } from '../scripting/event-loop';
import type { BrowletEnvironment } from '../scripting/environment';
import { structuredDeserialize } from '../scripting/structured-data/deserialize';
import type { SerializedRecord } from '../scripting/structured-data/records';
import { structuredSerialize } from '../scripting/structured-data/serialize';
import { structuredClone } from '../scripting/structured-data/structured-clone';
import { fetchTaskScheduling } from './fetch';
import { runInParallel } from './scripting';

/** BINDING_INTEGRATION: compose execution facilities for one realm and binding. */
export function createExecution(context: BindingContext<BrowletEnvironment>): BrowletExecution {
  const { realm } = context;
  return {
    // Window installation follows binding registration.
    get global() { return realm.global; },
    nativeLineEnding: EOL === '\r\n' ? '\r\n' : '\n',
    Promise: context.Promise,
    NativePromise: realm.intrinsics.promise.constructor,
    TypeError: realm.intrinsics.typeError,
    RangeError: realm.intrinsics.rangeError,
    // Execution is composed before interface binding registration finishes.
    get DOMException() { return context.DOMException; },
    buffers: realm.createRuntimeBuffers(),
    queueMicrotask: (steps) => { realm.queueMicrotask(steps); },
    runInParallel,
    fileReading: {
      queueTask: (steps) => realm.queueGlobalTask(fileReadingTaskSource, steps),
    },
    networking: fetchTaskScheduling,
    createEvent: (EventConstructor = EventImpl) => {
      const event = context.construct(EventConstructor, '', {});
      event.setTrusted(true);
      return event;
    },
    createAbortController: () => context.construct(AbortControllerImpl),
    createDependentAbortSignal: (signals) => AbortSignalImpl.any(
      context.construct(AbortSignalImpl), signals as AbortSignalImpl[],
    ),
    parseJSON: (text) => realm.parseJSON(text),
    stringifyJSON: (value) => realm.stringifyJSON(value),
    clone: (value, transferList = []) => structuredClone(value, transferList, context),
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

/** Engine and DOM facilities composed for one Browlet execution owner. */
export interface BrowletExecution extends RealmExecution, EventExecution {}

const fileReadingTaskSource = createTaskSource('file reading');
