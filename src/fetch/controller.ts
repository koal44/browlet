import { createDOMException } from '../web-idl/exceptions/dom-exception-core';
import type { BindingContext } from '../web-idl/projection';
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

  abort(
    context: BindingContext,
    structuredData: FetchStructuredData,
    error?: unknown,
  ): void {
    this.state = 'aborted';
    const fallbackError = context.realizeException(
      createDOMException('AbortError'),
    );
    let serializedError: object;
    try {
      serializedError = structuredData.serialize(
        arguments.length < 3 ? fallbackError : error,
      );
    } catch {
      serializedError = structuredData.serialize(fallbackError);
    }
    this.serializedAbortReason = serializedError;
  }

  terminate(): void {
    this.state = 'terminated';
  }
}

/** Fetch §2, deserialize a serialized abort reason in the target realm. */
export function deserializeAbortReason(
  abortReason: object | null,
  context: BindingContext,
  structuredData: FetchStructuredData,
): unknown {
  const fallbackError = context.realizeException(
    createDOMException('AbortError'),
  );
  if (abortReason !== null) {
    try {
      const error = structuredData.deserialize(abortReason);
      return error === undefined ? fallbackError : error;
    } catch {
      return fallbackError;
    }
  }
  return fallbackError;
}

/*
 * HTML's StructuredSerialize/StructuredDeserialize operations, bound to their
 * source or target realm. Fetch retains the resulting record opaquely; the
 * provider owns its representation. This is serialization, not cloning or
 * StructuredSerializeForStorage.
 */
export type FetchStructuredData = {
  serialize(value: unknown): object;
  deserialize(record: object): unknown;
};
