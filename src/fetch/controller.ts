import { InternalError } from '../infra/internal-error';
import type { JSEnvironment } from '../js-engine/index';
import { DOMExceptionImpl } from '../web-idl/core/index';
import type { FetchTimingInfo } from './timing';
import type { FetchEnvironment } from './environment';

/** Cancellation, timing, and manual-redirect controls for an ongoing fetch. */
// https://fetch.spec.whatwg.org/#fetch-controller
export class FetchController {
  /** Controls whether fetch work may continue and how cancellation is reported. */
  state: 'ongoing' | 'terminated' | 'aborted' = 'ongoing';
  /** Full timing data retained for extraction, or null before it is supplied. */
  fullTimingInfo: FetchTimingInfo | null = null;
  /** Reporting callback for a selected environment, or null before reporting is configured. */
  reportTimingSteps: ((env: FetchEnvironment) => void) | null = null;
  /** Structured-serialized abort reason, or null before an abort reason is recorded. */
  serializedAbortReason: object | null = null;
  /** Continuation for a pending manual redirect, or null when none is installed. */
  nextManualRedirectSteps: (() => void) | null = null;
  /** Active operations watching the specification's "abort when canceled" condition. */
  #cancellationSteps = new Set<() => void>();

  /** Register active work; return its removal steps for normal completion. */
  addCancellationSteps(steps: () => void): () => void {
    if (this.state !== 'ongoing') steps();
    else this.#cancellationSteps.add(steps);
    return () => { this.#cancellationSteps.delete(steps); };
  }

  // The selected global's environment supplies its time origin and Resource Timing owner.
  // https://fetch.spec.whatwg.org/#finalize-and-report-timing
  reportTiming(env: FetchEnvironment): void {
    const steps = this.reportTimingSteps;
    if (steps === null) throw new InternalError('Fetch timing steps are not set');
    steps(env);
  }

  // https://fetch.spec.whatwg.org/#fetch-controller-process-the-next-manual-redirect
  processNextManualRedirect(): void {
    const steps = this.nextManualRedirectSteps;
    if (steps === null) throw new InternalError('Fetch manual redirect steps are not set');
    steps();
  }

  // https://fetch.spec.whatwg.org/#extract-full-timing-info
  extractFullTimingInfo(): FetchTimingInfo {
    if (this.fullTimingInfo === null) {
      throw new InternalError('Fetch full timing info is not set');
    }
    return this.fullTimingInfo;
  }

  /** Abort active work, serializing the reason; omission differs from explicit undefined. */
  // https://fetch.spec.whatwg.org/#fetch-controller-abort
  abort(
    ...args: [env: JSEnvironment] | [error: unknown, env: JSEnvironment]
  ): void {
    this.state = 'aborted';
    const fallbackError = new DOMExceptionImpl('', 'AbortError');
    const env = args.length === 1 ? args[0] : args[1];
    const error = args.length === 1 ? fallbackError : args[0];
    let serializedError: object;
    try {
      serializedError = env.exec.serialize(error);
    } catch {
      serializedError = env.exec.serialize(fallbackError);
    }
    this.serializedAbortReason = serializedError;
    this.#cancelOperations();
  }

  // https://fetch.spec.whatwg.org/#fetch-controller-terminate
  terminate(): void {
    this.state = 'terminated';
    this.#cancelOperations();
  }

  #cancelOperations(): void {
    const steps = [...this.#cancellationSteps];
    this.#cancellationSteps.clear();
    for (const step of steps) step();
  }
}

/** Restore an abort reason in the target environment, falling back to AbortError. */
// https://fetch.spec.whatwg.org/#deserialize-a-serialized-abort-reason
export function deserializeAbortReason(
  abortReason: object | null,
  env: JSEnvironment,
): unknown {
  const fallbackError = new env.exec.DOMException('', 'AbortError');
  if (abortReason !== null) {
    try {
      const error = env.exec.deserialize(abortReason);
      return error === undefined ? fallbackError : error;
    } catch {
      return fallbackError;
    }
  }
  return fallbackError;
}
