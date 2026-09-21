import type { Definition } from '../web-idl/index';
import { headersIDL, headersInitIDL } from './headers';
import { bodyIDL, bodyInitIDL, xmlHttpRequestBodyInitIDL } from './body';
import {
  requestIDL, requestIncludesBodyIDL, requestInitIDL, requestInfoIDL, requestCacheIDL,
  requestCredentialsIDL, requestDestinationIDL, requestDuplexIDL, requestModeIDL,
  requestPriorityIDL, requestRedirectIDL,
} from './request';
import { responseIDL, responseIncludesBodyIDL, responseInitIDL, responseTypeIDL } from './response';

export { FetchController, deserializeAbortReason } from './controller';
export { FetchGroup } from './group';
export { ConnectionPool } from './http/connections';
export { HTTPCachePartitions } from './http/cache/partitions';
export type {
  FetchEnvironmentSettingsObject, FetchEnvironment, FetchUserAgent,
  FetchPolicyContainer, FetchPromptTarget, ReferrerPolicy,
} from './infrastructure';
export { fetchEnvironmentSettingsObject } from './infrastructure';
export { requestIDL, type FetchRequest } from './request';
export { responseIDL, type FetchResponse } from './response';
export { isLocalScheme } from './url';

export const fetchIDLDefinitions: Definition[] = [
  headersInitIDL,
  headersIDL,
  xmlHttpRequestBodyInitIDL, bodyInitIDL, bodyIDL,
  requestInfoIDL, requestInitIDL, requestDestinationIDL, requestModeIDL,
  requestCredentialsIDL, requestCacheIDL, requestRedirectIDL, requestDuplexIDL, requestPriorityIDL,
  requestIDL, requestIncludesBodyIDL,
  responseInitIDL, responseTypeIDL, responseIDL, responseIncludesBodyIDL,
];
