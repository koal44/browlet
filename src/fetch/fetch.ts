import type { FetchParams } from './params';
import type { FetchRequest } from './request';

/** Entry to Fetch processing; currently does nothing until Slice 8A is implemented. */
// https://fetch.spec.whatwg.org/#concept-fetch
// PROVISIONAL: no dispatch, response callbacks, or fetch controller yet.
export function fetch(_request: FetchRequest, _options: FetchOptions = {}): void {}

/** Optional processing steps and callback destination for a fetch. */
export type FetchOptions = Partial<Pick<FetchParams,
  'processRequestBodyChunkLength' | 'processRequestEndOfBody' | 'processEarlyHintsResponse' |
  'processResponse' | 'processResponseEndOfBody' | 'processResponseConsumeBody'
>> & {
  /** Deliver processing steps on a parallel queue instead of the client's global. */
  useParallelQueue?: boolean;
};
