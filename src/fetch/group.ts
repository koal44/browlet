import type { FetchController } from './controller';
import type { FetchRequest } from './request';
import { InternalError } from '../infra/internal-error';

/** https://fetch.spec.whatwg.org/#fetch-groups */
export class FetchGroup {
  /** Requests tracked for one environment, including the controllers used during termination. */
  fetchRecords: FetchRecord[] = [];
  /** Deferred requests and invocation state retained for that environment. */
  deferredFetchRecords: DeferredFetchRecord[] = [];

  /** Cancel document-owned fetch work, reporting whether any work was discarded. */
  // PROVISIONAL: entry now registers controllers, but cancellation of ongoing work is not connected.
  // Implement task/data cancellation and its keepalive/deferred-fetch rules there.
  // terminate() is not a substitute: it only changes controller state.
  cancel(): boolean {
    return false;
  }

  /** https://fetch.spec.whatwg.org/#concept-fetch-group-terminate */
  terminate(): void {
    for (const { request, controller } of this.fetchRecords) {
      if (controller !== null && !request.done && !request.keepalive) {
        controller.terminate();
      }
    }
    this.#processDeferredFetches();
  }

  /** https://fetch.spec.whatwg.org/#process-deferred-fetches */
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
