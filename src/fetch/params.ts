import type { ParallelQueue } from '../infra/parallel-queue';
import type { InternalPromise } from '../infra/promises';
import type { GlobalObject } from '../js-engine/index';
import { FetchController } from './controller';
import type { FetchEnvironment } from './environment';
import type { FetchRequest } from './request';
import type { FetchResponse } from './response';
import type { FetchTimingInfo } from './timing';

/** State and processing steps for one Fetch execution. */
// https://fetch.spec.whatwg.org/#fetch-params
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
  /** Response selected from preload, its pending completion, or null when none is selected. */
  // A Promise represents the draft's "pending" state and wakes the waiting fetch without polling.
  preloadedResponseCandidate: FetchResponse | InternalPromise<FetchResponse> | null = null;
  /** Execution owner for body streams, separate from the request's optional client. */
  env: FetchEnvironment;

  constructor(request: FetchRequest, timingInfo: FetchTimingInfo, env: FetchEnvironment) {
    this.request = request;
    this.timingInfo = timingInfo;
    this.env = env;
  }

  // https://fetch.spec.whatwg.org/#fetch-params-aborted
  get aborted(): boolean {
    return this.controller.state === 'aborted';
  }

  // https://fetch.spec.whatwg.org/#fetch-params-canceled
  get canceled(): boolean {
    return this.controller.state !== 'ongoing';
  }
}
