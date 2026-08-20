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
