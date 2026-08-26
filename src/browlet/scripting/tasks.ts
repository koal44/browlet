import type { DocumentImpl } from '../dom/nodes/document';
import {
  type EventLoop, queueTask, type TaskSource,
} from './event-loop';

export { queueTask } from './event-loop';

/*
 * HTML's global wrapper derives its destination from the global's relevant
 * agent and, for a Window, its associated Document. JavaScript does not expose
 * those internal links, so Realm installation registers their narrow task
 * counterpart here. WindowProxy retargeting can intentionally replace an
 * existing association.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#queuing-tasks
 */
export function associateGlobalTaskDestination(
  global: object,
  destination: GlobalTaskDestination,
): void {
  globalTaskDestinations.set(global, destination);
}

export function queueGlobalTask(
  source: TaskSource,
  global: object,
  steps: () => void,
): void {
  const destination = globalTaskDestinations.get(global);
  if (destination === undefined) {
    throw new Error('A global object must have a task destination');
  }
  queueTask(
    source,
    destination.eventLoop,
    destination.getDocument(),
    steps,
  );
}

export type GlobalTaskDestination = {
  readonly eventLoop: EventLoop;
  readonly getDocument: () => DocumentImpl | null;
};

const globalTaskDestinations =
  new WeakMap<object, GlobalTaskDestination>();
