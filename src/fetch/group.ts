import { InternalError } from '../infra/internal-error';

import type { FetchController } from './controller';
import type { FetchRequest } from './request';

/** Requests and deferred invocations associated with one environment's lifetime. */
// https://fetch.spec.whatwg.org/#concept-fetch-group
export class FetchGroup {
  /** Requests tracked for one environment, including the controllers used during termination. */
  fetchRecords: FetchRecord[] = [];
  /** Deferred requests and invocation state retained for that environment. */
  deferredFetchRecords: DeferredFetchRecord[] = [];

  /** Whether an environment's Fetch work is still awaiting end-of-body delivery. */
  hasPendingFetches(): boolean {
    // Aborting the controller alone does not deliver completion. Fetch sets done
    // in its queued end-of-body task, including for failed or aborted requests.
    return this.fetchRecords.some(({ request }) => !request.done);
  }

  /** Stop unfinished requests and their pending delivery; report whether any work was canceled. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#abort-a-document
  cancel(): boolean {
    const controllers = new Set<FetchController>();
    for (const { request, controller } of this.fetchRecords) {
      if (controller === null) continue;
      if ((request.done || controller.state !== 'ongoing') && !controller.hasPendingDelivery) continue;
      // SPEC_CLASH(keepalive-document-stop): Firefox preserves transport and delivery through
      // stop(); Chromium/WebKit retire delivery and can cancel an already-delivered body.
      // Destruction separately detaches delivery from browser-owned keepalive execution.
      if (request.keepalive) continue;
      controllers.add(controller);
    }
    // SPEC_GAP(document-fetch-cancellation): HTML does not select Fetch's controller state.
    // SPEC_CLASH(document-fetch-cancellation-error): Termination gives TypeError like Chromium/WebKit;
    // Firefox uses AbortError for an already-delivered body. Do not invent an author abort reason.
    for (const controller of controllers) {
      controller.cancelResponseDelivery();
      if (controller.state === 'ongoing') controller.terminate();
    }
    // Upload/response callback tasks are removed; internal completion still runs.
    return controllers.size !== 0;
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
