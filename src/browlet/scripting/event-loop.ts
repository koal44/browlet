/*
 * Each agent has a unique event loop. The full event-loop model is defined by
 * HTML section 8.1.7; this boundary currently delegates only the microtasks
 * needed by Browlet to Node's event loop.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#event-loops
 */
export class EventLoop {
  queueMicrotask(steps: () => void): void {
    globalThis.queueMicrotask(steps);
  }
}

/*
 * These are provisional seams for HTML section 8.1.7. TaskSource is only an
 * opaque identity for now; its representation may become a class or richer
 * record when Browlet implements task queues and event-loop selection.
 */
export type TaskSource = Readonly<{ name: string; }>;

export function createTaskSource(name: string): TaskSource {
  return { name };
}

export function queueGlobalTask(
  _source: TaskSource,
  _global: object,
  _steps: () => void,
): void {
  throw new Error('queueGlobalTask awaits HTML section 8.1.7');
}
