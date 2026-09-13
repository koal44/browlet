import type { RuntimeContext } from '../js-engine/index';
import { createDOMException } from '../web-idl/index';
import type { FetchTimingInfo } from './timing';

/** Fetch §2, fetch controller and its operations. */
export class FetchController {
  state: 'ongoing' | 'terminated' | 'aborted' = 'ongoing';
  fullTimingInfo: FetchTimingInfo | null = null;
  reportTimingSteps: ((global: object) => void) | null = null;
  serializedAbortReason: object | null = null;
  nextManualRedirectSteps: (() => void) | null = null;

  reportTiming(global: object): void {
    const steps = this.reportTimingSteps;
    if (steps === null) throw new Error('Fetch timing steps are not set');
    steps(global);
  }

  processNextManualRedirect(): void {
    const steps = this.nextManualRedirectSteps;
    if (steps === null) throw new Error('Fetch manual redirect steps are not set');
    steps();
  }

  extractFullTimingInfo(): FetchTimingInfo {
    if (this.fullTimingInfo === null) {
      throw new Error('Fetch full timing info is not set');
    }
    return this.fullTimingInfo;
  }

  /** Fetch §2, abort a fetch controller; an omitted error differs from explicit undefined. */
  abort(
    ...args: [runtime: RuntimeContext] | [error: unknown, runtime: RuntimeContext]
  ): void {
    this.state = 'aborted';
    const fallbackError = createDOMException('AbortError');
    const runtime = args.length === 1 ? args[0] : args[1];
    const error = args.length === 1 ? fallbackError : args[0];
    let serializedError: object;
    try {
      serializedError = runtime.serialize(error);
    } catch {
      serializedError = runtime.serialize(fallbackError);
    }
    this.serializedAbortReason = serializedError;
  }

  terminate(): void {
    this.state = 'terminated';
  }
}

/** Fetch §2, deserialize a serialized abort reason in the target runtime's realm. */
export function deserializeAbortReason(
  abortReason: object | null,
  runtime: RuntimeContext,
): unknown {
  const fallbackError = createDOMException('AbortError');
  if (abortReason !== null) {
    try {
      const error = runtime.deserialize(abortReason);
      return error === undefined ? fallbackError : error;
    } catch {
      return fallbackError;
    }
  }
  return fallbackError;
}
