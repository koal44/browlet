import { createTaskSource } from './event-loop';

/*
 * This is the timer task source's provisional opaque identity. Its concrete
 * representation belongs to the eventual HTML section 8.1.7 scheduler.
 */
export const timerTaskSource = createTaskSource('timer');

/*
 * The eventual global-owned timer entry must retain completionSteps until it
 * runs or is canceled. AbortSignal.timeout() relies on that ordinary closure
 * ownership to keep its captured signal reachable while delivery is pending.
 */
export function runStepsAfterTimeout(
  _global: object,
  _orderingIdentifier: string,
  _milliseconds: number,
  _completionSteps: () => void,
): TimerKey {
  throw new Error('runStepsAfterTimeout awaits HTML section 8.7');
}

/*
 * A timer key is deliberately opaque here. This alias may become a class or
 * structured handle when the ordered timer map and cancellation APIs exist.
 */
type TimerKey = unknown;
