import type { TaskSourceKey } from '../../infra/index';

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

// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timer-task-source
export const timerTaskSource = createTaskSource('timer');

// https://w3c.github.io/requestidlecallback/#start-an-idle-period-algorithm
export const idleTaskSource = createTaskSource('idle');

// https://w3c.github.io/FileAPI/#task-source
export const fileTaskSource = createTaskSource('file reading');

// https://storage.spec.whatwg.org/#task-source
export const storageTaskSource = createTaskSource('storage');

// https://w3c.github.io/permissions/#dfn-permissions-task-source
export const permissionsTaskSource = createTaskSource('permissions');

// Reporting leaves the task source unnamed; WebKit likewise gives it a distinct source.
export const reportingTaskSource = createTaskSource('reporting');

// Automation entry is embedder work; HTML still owns task execution and checkpoints.
export const automationTaskSource = createTaskSource('automation');

// JavaScript engine completions and host jobs share this source.
export const jsEngineTaskSource = createTaskSource('JavaScript engine');

/** Shared source identities selected by an owner's execution facilities. */
export const taskSources: Record<TaskSourceKey, TaskSource> = {
  'dom-manipulation': domManipulationTaskSource,
  'navigation-and-traversal': navigationAndTraversalTaskSource,
  network: networkingTaskSource,
  timer: timerTaskSource,
  file: fileTaskSource,
  storage: storageTaskSource,
  permissions: permissionsTaskSource,
  report: reportingTaskSource,
  automation: automationTaskSource,
  engine: jsEngineTaskSource,
};

/** Reference to a queued task that its owner can cancel. */
export type QueuedTaskHandle = {
  /** Remove the task, returning whether it was still queued. */
  remove(): boolean;
};
