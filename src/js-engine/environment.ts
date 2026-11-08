import type { InternalPromise } from '../infra/promises';
import type { TaskRecord, TaskHandle, TaskSourceKey } from '../infra/tasks';

import type { JSRealm } from './realm';

/** An environment owning its realm, internal promises, and task delivery. */
export interface JSEnvironment {
  /** JavaScript realm associated with this environment. */
  realm: JSRealm;
  /** Internal Promise constructor retaining this environment's binding conversion and reaction delivery. */
  InternalPromise: typeof InternalPromise;
  /** Schedule background steps without invoking them inline or entering an owner task. */
  runInParallel: (steps: () => void) => void;
  /** Queue a later task for this owner on the selected source. */
  queueTask(source: TaskSourceKey, task: TaskRecord): TaskHandle;
  /**
   * Register internal cleanup for destruction of this owner; return removal steps.
   * Runs immediately if already destroyed. Steps must not invoke author code.
   */
  addDestructionSteps(steps: () => void): () => void;
}
