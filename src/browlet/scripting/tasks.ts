import { createTaskSource } from './event-loop';

/*
 * HTML section 8.1.7.4 defines these shared source identities for otherwise
 * unrelated features. They do not own queues: each EventLoop independently
 * associates a source with one of its task queues.
 */
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

export type QueuedTaskHandle = {
  remove(): boolean;
};
