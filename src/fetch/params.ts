import type { ParallelQueue } from '../infra/parallel-queue';
import type { GlobalObject } from '../js-engine/index';
import { FetchController } from './controller';
import type { RequestRecord } from './request';
import type { ResponseRecord } from './response';
import type { FetchTimingInfo } from './timing';

/** Fetch §2 bookkeeping; processing-step signatures are specified by §4.1. */
export class FetchParams {
  request: RequestRecord;
  processRequestBodyChunkLength: ((length: number) => void) | null = null;
  processRequestEndOfBody: (() => void) | null = null;
  processEarlyHintsResponse: ((response: ResponseRecord) => void) | null = null;
  processResponse: ((response: ResponseRecord) => void) | null = null;
  processResponseEndOfBody: ((response: ResponseRecord) => void) | null = null;
  processResponseConsumeBody: ((response: ResponseRecord, body: Uint8Array | null | 'failure') => void) | null = null;
  taskDestination: GlobalObject | ParallelQueue | null = null;
  crossOriginIsolatedCapability = false;
  controller = new FetchController();
  timingInfo: FetchTimingInfo;
  preloadedResponseCandidate: ResponseRecord | 'pending' | null = null;

  constructor(request: RequestRecord, timingInfo: FetchTimingInfo) {
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
