import type { URLRecord } from '../../url/index';
import type { Destination, FetchResponse } from '../../fetch/index';

import type { ScriptFetchOptions } from './script-fetch-options';
import type { PerformScriptFetch } from './script-fetching';

/** The source-fetching view of a script's client environment, including a creator reached across isolates. */
export interface ScriptEnvironment {
  /** Construct and fetch a module request with this client's policies and stores, before parsing in the target realm. */
  fetchModuleSource(
    url: URLRecord, destination: Destination, options: ScriptFetchOptions,
    referrer: URLRecord | 'client' | 'no-referrer', isTopLevel: boolean,
    processResponse: ScriptSourceCallback, performFetch?: PerformScriptFetch,
  ): void;
}

/** Consumed response data; Fetch retains ownership of its network resources and body streams. */
export type ScriptSourceCallback = (response: FetchResponse, bodyBytes: Uint8Array | null | 'failure') => void;
