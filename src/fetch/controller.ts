import type { JSEnvironment } from '../js-engine/index';
import { createDOMException } from '../web-idl/index';
import type { FetchTimingInfo } from './timing';
import type { FetchEnvironment } from './environment';
import { InternalError } from '../infra/internal-error';

/** Fetch §2, fetch controller and its operations. */
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
  reportTiming(env: FetchEnvironment): void {
    const steps = this.reportTimingSteps;
    if (steps === null) throw new InternalError('Fetch timing steps are not set');
    steps(env);
  }

  processNextManualRedirect(): void {
    const steps = this.nextManualRedirectSteps;
    if (steps === null) throw new InternalError('Fetch manual redirect steps are not set');
    steps();
  }

  extractFullTimingInfo(): FetchTimingInfo {
    if (this.fullTimingInfo === null) {
      throw new InternalError('Fetch full timing info is not set');
    }
    return this.fullTimingInfo;
  }

  /** Fetch §2, abort a fetch controller; an omitted error differs from explicit undefined. */
  abort(
    ...args: [env: JSEnvironment] | [error: unknown, env: JSEnvironment]
  ): void {
    this.state = 'aborted';
    const fallbackError = createDOMException('AbortError');
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

/** Fetch §2, deserialize a serialized abort reason in the target runtime's realm. */
export function deserializeAbortReason(
  abortReason: object | null,
  env: JSEnvironment,
): unknown {
  const fallbackError = createDOMException('AbortError');
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
