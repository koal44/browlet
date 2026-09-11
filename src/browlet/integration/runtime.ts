import { EOL } from 'node:os';

import type { RuntimeContext } from '../../js-engine/index';
import type { BindingContext } from '../../web-idl/projection';
import { WindowImpl } from '../browsing/window/window';
import { AbortControllerImpl } from '../dom/abort/abort-controller';
import type { Realm } from '../scripting/realm';
import { queueGlobalTask } from '../scripting/tasks';
import { fetchTaskScheduling } from './fetch';
import { createTaskSource } from '../scripting/event-loop';
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
    clone: (value) => WindowImpl.getWindowOrWorkerGlobalScopeMixin(window).structuredClone(value),
  };
}

const fileReadingTaskSource = createTaskSource('file reading');
