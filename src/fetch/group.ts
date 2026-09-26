import type { FetchController } from './controller';
import type { FetchRequest } from './request';
import { InternalError } from '../infra/internal-error';

/** Requests and deferred invocations associated with one environment's lifetime. */
// https://fetch.spec.whatwg.org/#concept-fetch-group
export class FetchGroup {
  /** Requests tracked for one environment, including the controllers used during termination. */
  fetchRecords: FetchRecord[] = [];
  /** Deferred requests and invocation state retained for that environment. */
  deferredFetchRecords: DeferredFetchRecord[] = [];

  /** Placeholder for document cancellation; currently discards no work. */
  // PROVISIONAL: complete HTML's task/data cleanup and keepalive/deferred-fetch rules.
  cancel(): boolean {
    return false;
  }

  /** Terminate unfinished non-keepalive requests, then process deferred invocations. */
  // https://fetch.spec.whatwg.org/#concept-fetch-group-terminate
  terminate(): void {
    for (const { request, controller } of this.fetchRecords) {
      if (controller !== null && !request.done && !request.keepalive) {
        controller.terminate();
      }
    }
    this.#processDeferredFetches();
  }

  // https://fetch.spec.whatwg.org/#process-deferred-fetches
  // TODO: fetch pending records and queue their invocation notifications.
  #processDeferredFetches(): void {
    for (const record of this.deferredFetchRecords) {
      if (record.invokeState !== 'pending') continue;
      throw new InternalError('Deferred fetch processing is not implemented');
    }
  }
}

export type FetchRecord = {
  /** Request registered with the fetch group. */
  request: FetchRequest;
  /** Controller for stopping the request, or null when none is associated. */
  controller: FetchController | null;
};

export type DeferredFetchRecord = {
  /** Request awaiting deferred execution. */
  request: FetchRequest;
  /** Notification steps run when the deferred fetch is invoked. */
  notifyInvoked: () => void;
  /** Tracks whether invocation is pending, has been sent, or has been aborted. */
  invokeState: 'pending' | 'sent' | 'aborted';
};
