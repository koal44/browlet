import type { InternalPromise } from '../../../infra/index';

import type { UserAgent } from '../../user-agent';

import type { Navigable } from './navigable';

/** Serial background work shared by a traversable's Documents and descendant Agents. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#session-history-traversal-parallel-queue
export class SessionHistoryTraversalQueue {
  /** Pending algorithms, exposed for history application's selective synchronous-navigation removal. */
  algorithmSet = new Set<SessionHistoryTraversalSteps>();
  /** Browser owner retained independently of any Document or event loop. */
  #userAgent: UserAgent;
  /** Whether the current algorithm is executing or waiting for its completion. */
  #running = false;
  /** Whether a later host turn has already been requested. */
  #drainScheduled = false;

  /** Start a queue that sleeps while empty and wakes when work is appended. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#starting-a-new-session-history-traversal-parallel-queue
  // The UserAgent supplies scheduling; suspended algorithms return an InternalPromise to keep the queue occupied.
  constructor(userAgent: UserAgent) {
    this.#userAgent = userAgent;
  }

  /** Append an algorithm and wake this queue, preserving ordered-set identity. */
  append(steps: SessionHistoryTraversalSteps): void {
    this.algorithmSet.add(steps);
    this.#requestDrain();
  }

  /** Request one later turn without polling an idle queue or interrupting an unfinished algorithm. */
  #requestDrain(): void {
    if (this.algorithmSet.size === 0 || this.#running || this.#drainScheduled) return;
    this.#drainScheduled = true;
    try {
      this.#userAgent.runInParallel(() => { this.#drain(); });
    } catch (error) {
      this.#drainScheduled = false;
      throw error;
    }
  }

  /** Run queued algorithms in order, leaving pending work visible during a suspended algorithm. */
  #drain(): void {
    this.#drainScheduled = false;
    this.#running = true;
    try {
      while (this.algorithmSet.size !== 0) {
        const steps = this.algorithmSet.values().next().value!;
        this.algorithmSet.delete(steps);
        const completion = steps();
        if (completion !== undefined) {
          this.#userAgent.HostPromise.fromInternal(completion).observe(
            () => { this.#finish(); },
            (error) => {
              this.#finish();
              this.#userAgent.runInParallel(() => { throw error; });
            },
          );
          return;
        }
      }
    } catch (error) {
      this.#finish();
      throw error;
    }
    this.#finish();
  }

  /** Release the current algorithm and resume any work appended while it was waiting. */
  #finish(): void {
    this.#running = false;
    this.#requestDrain();
  }
}

/** Steps may return their completion when waiting; only synchronous navigation steps have a target tag. */
export type SessionHistoryTraversalSteps = (() => void | InternalPromise<void>) & {
  /** Present only for synchronous navigation steps that history application may run ahead of other work. */
  targetNavigable?: Navigable;
};
