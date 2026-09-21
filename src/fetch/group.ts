import type { FetchController } from './controller';
import type { FetchRequest } from './request';

/** https://fetch.spec.whatwg.org/#fetch-groups */
export class FetchGroup {
  fetchRecords: FetchRecord[] = [];
  deferredFetchRecords: DeferredFetchRecord[] = [];

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
      throw new Error('Deferred fetch processing is not implemented');
    }
  }
}

export type FetchRecord = {
  request: FetchRequest;
  controller: FetchController | null;
};

export type DeferredFetchRecord = {
  request: FetchRequest;
  notifyInvoked: () => void;
  invokeState: 'pending' | 'sent' | 'aborted';
};
