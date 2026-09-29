import { createTaskSource } from './event-loop';

// https://html.spec.whatwg.org/multipage/webappapis.html#generic-task-sources
// HTML defines these shared source identities for otherwise
// unrelated features. They do not own queues: each EventLoop independently
// associates a source with one of its task queues.
export const domManipulationTaskSource =
  createTaskSource('DOM manipulation');
export const userInteractionTaskSource =
  createTaskSource('user interaction');
export const networkingTaskSource =
  createTaskSource('networking');
export const navigationAndTraversalTaskSource =
  createTaskSource('navigation and traversal');
export const renderingTaskSource =
  createTaskSource('rendering');

/** Reference to a queued task that its owner can cancel. */
export type QueuedTaskHandle = {
  /** Remove the task, returning whether it was still queued. */
  remove(): boolean;
};
