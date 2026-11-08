import { InternalError } from '../infra/internal-error';
import { DOMExceptionImpl } from '../web-idl/core/index';

import type { FetchTimingInfo } from './timing';
import type { FetchClient, FetchEnvironment } from './environment';
import type { FetchRequest } from './request';

/** Cancellation, timing, and manual-redirect controls for an ongoing fetch. */
// https://fetch.spec.whatwg.org/#fetch-controller
export class FetchController {
  /** Controls whether fetch work may continue and how cancellation is reported. */
  state: 'ongoing' | 'terminated' | 'aborted' = 'ongoing';
  /** Document cancellation invalidates queued response delivery, independently of transport failure. */
  responseDeliveryCanceled = false;
  /** Full timing data retained for extraction, or null before it is supplied. */
  fullTimingInfo: FetchTimingInfo | null = null;
  /** Reporting callback for a selected environment, or null before reporting is configured. */
  reportTimingSteps: ((env: FetchClient) => void) | null = null;
  /** Structured-serialized abort reason, or null before an abort reason is recorded. */
  serializedAbortReason: object | null = null;
  /** Continuation for a pending manual redirect, or null when none is installed. */
  nextManualRedirectSteps: (() => void) | null = null;
  /** Active operations watching the specification's "abort when canceled" condition. */
  #cancellationSteps = new Set<() => void>();
  /** Fetch-owned reads and callbacks awaiting delivery, even after transport completion. */
  #deliveryCancellationSteps = new Set<() => void>();
  /** Release the execution owner's destruction registration once Fetch delivery finishes. */
  #removeDestructionSteps: (() => void) | null = null;

  get hasPendingDelivery(): boolean { return this.#deliveryCancellationSteps.size !== 0; }

  /** Stop this subresource fetch when its execution owner is destroyed, independently of the client. */
  observeDestruction(request: FetchRequest, env: FetchEnvironment): void {
    this.#removeDestructionSteps = env.addDestructionSteps(() => {
      // TODO(HTML §7.5.11): Detach keepalive transport before releasing its execution owner.
      if (request.keepalive) throw new InternalError('Execution-owner destruction of keepalive fetches is not implemented');
      this.cancelResponseDelivery();
      if (this.state === 'ongoing') this.terminate();
    });
  }

  /** Release lifetime retention at end-of-body delivery; cancellation alone does not finish that delivery. */
  stopObservingDestruction(): void {
    this.#removeDestructionSteps?.();
    this.#removeDestructionSteps = null;
  }

  /** Retain Fetch-owned delivery until its callback runs or is discarded. */
  addDeliveryCancellationSteps(steps: () => void): () => void {
    if (this.responseDeliveryCanceled) steps();
    else this.#deliveryCancellationSteps.add(steps);
    return () => { this.#deliveryCancellationSteps.delete(steps); };
  }

  /** Invalidate response delivery without replacing an existing transport abort reason. */
  cancelResponseDelivery(): void {
    this.responseDeliveryCanceled = true;
    const steps = [...this.#deliveryCancellationSteps];
    this.#deliveryCancellationSteps.clear();
    for (const step of steps) step();
  }

  /** Register active work; return its removal steps for normal completion. */
  addCancellationSteps(steps: () => void): () => void {
    if (this.state !== 'ongoing') steps();
    else this.#cancellationSteps.add(steps);
    return () => { this.#cancellationSteps.delete(steps); };
  }

  // The selected global's environment supplies its time origin and Resource Timing owner.
  // https://fetch.spec.whatwg.org/#finalize-and-report-timing
  reportTiming(env: FetchClient): void {
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
    ...args: [env: FetchEnvironment] | [error: unknown, env: FetchEnvironment]
  ): void {
    this.state = 'aborted';
    const fallbackError = new DOMExceptionImpl('', 'AbortError');
    const env = args.length === 1 ? args[0] : args[1];
    const error = args.length === 1 ? fallbackError : args[0];
    let serializedError: object;
    try {
      serializedError = env.serialize(error);
    } catch {
      serializedError = env.serialize(fallbackError);
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
  env: FetchEnvironment,
): unknown {
  const fallbackError = new env.DOMException('', 'AbortError');
  if (abortReason !== null) {
    try {
      const error = env.deserialize(abortReason);
      return error === undefined ? fallbackError : error;
    } catch {
      return fallbackError;
    }
  }
  return fallbackError;
}
