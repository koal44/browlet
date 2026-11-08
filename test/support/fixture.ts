import { afterEach, beforeEach } from 'vitest';

/**
 * Prepare fresh state for sequential tests under the hook deadline, with cleanup before the next test.
 * Use this for prerequisite environments and resources; keep the operation being tested in the test body.
 * Group cases by their setup needs so a fixture does not allocate unused browsers for other cases.
 */
export function useFixture<Value>(setUp: (fixture: Fixture) => Value | Promise<Value>): () => Value {
  let current: { fixture: Fixture; result?: { value: Value; }; } | undefined;
  beforeEach(async ({ signal }) => {
    current = { fixture: new Fixture(signal) };
    current.result = { value: await current.fixture.waitFor(Promise.resolve(setUp(current.fixture))) };
  });
  afterEach(async () => {
    try { await current?.fixture.dispose(); }
    finally { current = undefined; }
  });
  return () => {
    if (!current?.result) throw new Error('Fixture setup has not completed');
    return current.result.value;
  };
}

/** Own test waits and explicit resource cleanup; this does not replace browser destruction. */
export class Fixture {
  #controller = new AbortController();
  #signal: AbortSignal;
  #cleanups: (() => void | Promise<void>)[] = [];
  #disposal: Promise<void> | undefined;

  constructor(signal?: AbortSignal) {
    this.#signal = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal;
  }

  /** Register cleanup in acquisition order; disposal runs it in reverse order, including after failures. */
  onCleanup(steps: () => void | Promise<void>): void {
    this.#signal.throwIfAborted();
    this.#cleanups.push(steps);
  }

  /** Stop the test continuation on timeout or disposal; the resource's cleanup must stop its underlying work. */
  waitFor<Value>(promise: PromiseLike<Value>): Promise<Value> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        // Preserve the runner's cancellation reason, including its error identity.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(this.#signal.reason);
      };
      if (this.#signal.aborted) {
        // Observe eventual rejection even when the caller's wait is already canceled.
        void Promise.resolve(promise).catch(() => {});
        abort();
        return;
      }
      this.#signal.addEventListener('abort', abort, { once: true });
      void Promise.resolve(promise).then((value) => {
        this.#signal.removeEventListener('abort', abort);
        if (this.#signal.aborted) abort();
        else resolve(value);
      }, (error: unknown) => {
        this.#signal.removeEventListener('abort', abort);
        // Keep the tested operation's rejection value and realm unchanged.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      });
    });
  }

  dispose(): Promise<void> {
    return this.#disposal ??= this.#dispose();
  }

  async #dispose(): Promise<void> {
    this.#controller.abort(new Error('Fixture disposed'));
    const errors: unknown[] = [];
    for (let cleanup = this.#cleanups.pop(); cleanup; cleanup = this.#cleanups.pop()) {
      try { await cleanup(); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed');
  }
}
