import type { InternalPromise } from '../infra/promises';
import type { TaskCreationOptions, TaskHandle, TaskSourceKey } from '../infra/tasks';

import type { JSRealm } from './realm';

/** An environment owning its realm, internal promises, and task delivery. */
export interface JSEnvironment {
  /** JavaScript realm associated with this environment. */
  realm: JSRealm;
  /** Internal Promise constructor retaining this environment's binding conversion and reaction delivery. */
  InternalPromise: typeof InternalPromise;
  /** Schedule background steps without invoking them inline or entering an owner task. */
  runInParallel: (steps: () => void) => void;
  /** Queue timer work with the nesting level inherited by timers created inside it. */
  queueTask(source: 'timer', steps: () => void, options: TaskCreationOptions): TaskHandle;
  /** Queue a later task for this owner on the selected source. */
  queueTask(source: TaskSourceKey, steps: () => void): TaskHandle;
}
