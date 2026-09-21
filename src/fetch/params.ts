import type { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject } from '../js-engine/index';
import { FetchController } from './controller';
import type { FetchRequest } from './request';
import type { FetchResponse } from './response';
import type { FetchTimingInfo } from './timing';

/** Fetch §2 bookkeeping; processing-step signatures are specified by §4.1. */
export class FetchParams {
  request: FetchRequest;
  processRequestBodyChunkLength: ((length: number) => void) | null = null;
  processRequestEndOfBody: (() => void) | null = null;
  processEarlyHintsResponse: ((response: FetchResponse) => void) | null = null;
  processResponse: ((response: FetchResponse) => void) | null = null;
  processResponseEndOfBody: ((response: FetchResponse) => void) | null = null;
  processResponseConsumeBody: ((response: FetchResponse, body: Uint8Array | null | 'failure') => void) | null = null;
  taskDestination: GlobalObject | ParallelQueue | null = null;
  crossOriginIsolatedCapability = false;
  controller = new FetchController();
  timingInfo: FetchTimingInfo;
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
