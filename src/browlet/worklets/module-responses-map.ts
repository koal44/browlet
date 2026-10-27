import { InternalError } from '../../infra/index';
import { urlsEqual, type URLRecord } from '../../url/index';
import type { FetchResponse } from '../../fetch/index';

/** Downloaded responses shared by a Worklet's globals, independently of their module maps. */
// https://html.spec.whatwg.org/multipage/worklets.html#concept-Worklet-module-responses-map
export class ModuleResponsesMap {
  #entries: ModuleResponseEntry[] = [];

  get(url: URLRecord): ModuleResponse | 'fetching' | undefined {
    return this.#entries.find((entry) => urlsEqual(entry.url, url))?.value;
  }

  set(url: URLRecord, value: ModuleResponse | 'fetching'): void {
    const entry = this.#entries.find((candidate) => urlsEqual(candidate.url, url));
    if (entry === undefined) {
      this.#entries.push({ url, value, callbacks: [] });
      return;
    }
    entry.value = value;
    if (value !== 'fetching') {
      const callbacks = entry.callbacks;
      entry.callbacks = [];
      for (const callback of callbacks) callback(value);
    }
  }

  /** Observe a pending entry; the caller queues continuation on its own networking task source. */
  whenReady(url: URLRecord, callback: (response: ModuleResponse) => void): void {
    const entry = this.#entries.find((candidate) => urlsEqual(candidate.url, url));
    if (entry === undefined || entry.value !== 'fetching') {
      throw new InternalError('Only a pending worklet response can be awaited');
    }
    entry.callbacks.push(callback);
  }
}

export type ModuleResponse = [response: FetchResponse, body: Uint8Array | null | 'failure'];

interface ModuleResponseEntry {
  url: URLRecord;
  value: ModuleResponse | 'fetching';
  callbacks: ((response: ModuleResponse) => void)[];
}
