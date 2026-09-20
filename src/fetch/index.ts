import type { Definition } from '../web-idl/index';
import { headersIDL, headersInitIDL } from './headers';

export { FetchController, deserializeAbortReason } from './controller';
export { FetchGroup } from './group';
export { ConnectionPool } from './http/connections';
export { HTTPCachePartitions } from './http/cache/partitions';
export type { FetchEnvironmentSettingsObject, FetchEnvironment, FetchUserAgent } from './infrastructure';

export const fetchIDLDefinitions: Definition[] = [
  headersInitIDL,
  headersIDL,
];
