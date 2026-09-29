import type { TaskSourceKey } from '../../infra/execution';
import { createTaskSource, type TaskSource } from './event-loop';

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

// https://w3c.github.io/FileAPI/#task-source
export const fileTaskSource = createTaskSource('file reading');

// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timer-task-source
export const timerTaskSource = createTaskSource('timer');

// Reporting leaves the task source unnamed; WebKit likewise gives it a distinct source.
export const reportingTaskSource = createTaskSource('reporting');

// Automation entry is embedder work; HTML still owns task execution and checkpoints.
export const automationTaskSource = createTaskSource('automation');

/** Shared source identities selected by an owner's execution facilities. */
export const taskSources: Record<TaskSourceKey, TaskSource> = {
  file: fileTaskSource,
  network: networkingTaskSource,
  'dom-manipulation': domManipulationTaskSource,
  report: reportingTaskSource,
  automation: automationTaskSource,
  timer: timerTaskSource,
};

/** Reference to a queued task that its owner can cancel. */
export type QueuedTaskHandle = {
  /** Remove the task, returning whether it was still queued. */
  remove(): boolean;
};
