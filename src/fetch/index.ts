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
export { fetch, type FetchOptions } from './fetch';
export { FetchGroup } from './group';
export { ConnectionPool } from './http/connections';
export { HTTPCachePartitions } from './http/cache/partitions';
export { CORSPreflightCache } from './http/cors-preflight-cache';
export type {
  FetchEnvironment, FetchEnvironmentRecord, FetchUserAgent,
  FetchInsecureRequestsPolicy, FetchEmbedderPolicy,
  FetchPolicyContainer, FetchCSPList, FetchPromptTarget, fetchPromptTargetBrand, FetchEmbedderPolicyValue, ReferrerPolicy,
} from './environment';
export { fetchEnvironment } from './environment';
export { getEnvironmentDefaultUserAgent, isHeaderValue, type FetchHeaders } from './headers';
export {
  requestIDL, FetchRequest, isScriptLikeDestination,
  type Destination, type FetchMode, type RequestCredentials, type RequestInternalPriority,
} from './request';
export { responseIDL, FetchResponse, type CacheUsage } from './response';
export type { FetchTimingInfo, ResponseBodyInfo, ServiceWorkerTimingInfo } from './timing';
export {
  parseIntegrityMetadata, applyIntegrityAlgorithm, type IntegrityMetadata, type IntegrityAlgorithm,
  type FetchIntegrityPolicy, type IntegrityViolationReportBody,
} from './integrity';
export { isLocalScheme } from './url';
export { isOkStatus } from './http/statuses';

export const fetchIDLDefinitions: Definition[] = [
  headersInitIDL,
  headersIDL,
  xmlHttpRequestBodyInitIDL, bodyInitIDL, bodyIDL,
  requestInfoIDL, requestInitIDL, requestDestinationIDL, requestModeIDL,
  requestCredentialsIDL, requestCacheIDL, requestRedirectIDL, requestDuplexIDL, requestPriorityIDL,
  requestIDL, requestIncludesBodyIDL,
  responseInitIDL, responseTypeIDL, responseIDL, responseIncludesBodyIDL,
];
