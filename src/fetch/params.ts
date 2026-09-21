import type { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject } from '../js-engine/index';
import { FetchController } from './controller';
import type { FetchRequest } from './request';
import type { FetchResponse } from './response';
import type { FetchTimingInfo } from './timing';

/** Fetch §2 bookkeeping; processing-step signatures are specified by §4.1. */
export class FetchParams {
  /** Request being processed by this fetch execution. */
  request: FetchRequest;
  /** Optional upload-progress callback receiving the byte length of each transmitted chunk. */
  processRequestBodyChunkLength: ((length: number) => void) | null = null;
  /** Optional callback invoked after the request body has been transmitted. */
  processRequestEndOfBody: (() => void) | null = null;
  /** Optional callback for a 103 Early Hints response received before the final response. */
  processEarlyHintsResponse: ((response: FetchResponse) => void) | null = null;
  /** Optional callback receiving the response before its body necessarily finishes. */
  processResponse: ((response: FetchResponse) => void) | null = null;
  /** Optional callback invoked when response end-of-body processing completes. */
  processResponseEndOfBody: ((response: FetchResponse) => void) | null = null;
  /** Optional callback receiving consumed bytes, null for no body, or failure when reading fails. */
  processResponseConsumeBody: ((response: FetchResponse, body: Uint8Array | null | 'failure') => void) | null = null;
  /** Global or parallel queue receiving fetch callbacks; null until a destination is selected. */
  taskDestination: GlobalObject | ParallelQueue | null = null;
  /** Selects the timing precision permitted by the client's cross-origin isolation. */
  crossOriginIsolatedCapability = false;
  /** Cancellation, timing-reporting, and manual-redirect control for this execution. */
  controller = new FetchController();
  /** Timing observations accumulated while the request is processed. */
  timingInfo: FetchTimingInfo;
  /** Preloaded response to reuse, pending while being fetched, or null when none is selected. */
  preloadedResponseCandidate: FetchResponse | 'pending' | null = null;

  constructor(request: FetchRequest, timingInfo: FetchTimingInfo) {
    this.request = request;
    this.timingInfo = timingInfo;
  }

  get aborted(): boolean {
    return this.controller.state === 'aborted';
  }

  get canceled(): boolean {
    return this.controller.state !== 'ongoing';
  }
}
