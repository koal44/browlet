import type { DocumentImpl } from '../dom/nodes/document';
import {
  createTaskSource, type EventLoop, queueTask, type TaskSource,
} from './event-loop';

export { queueTask } from './event-loop';

/*
 * HTML section 8.1.7.4 defines these shared source identities for otherwise
 * unrelated features. They do not own queues: each EventLoop independently
 * associates a source with one of its task queues.
 */
export const domManipulationTaskSource =
  createTaskSource('DOM manipulation');
export const userInteractionTaskSource =
  createTaskSource('user interaction');
export const networkingTaskSource = createTaskSource('networking');
export const navigationAndTraversalTaskSource =
  createTaskSource('navigation and traversal');
export const renderingTaskSource = createTaskSource('rendering');

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
