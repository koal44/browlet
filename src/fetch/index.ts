import type { Definition } from '../web-idl/index';
import { headersIDL, headersInitIDL } from './headers';
import { bodyIDL, bodyInitIDL, xmlHttpRequestBodyInitIDL } from './body';
import {
  requestIDL, requestIncludesBodyIDL, requestInitIDL, requestInfoIDL, requestCacheIDL,
  requestCredentialsIDL, requestDestinationIDL, requestDuplexIDL, requestModeIDL,
  requestPriorityIDL, requestRedirectIDL,
} from './request';
import { responseIDL, responseIncludesBodyIDL, responseInitIDL, responseTypeIDL } from './response';
import { fetchGlobalScopeIDL } from './fetch-global';

export { FetchController, deserializeAbortReason } from './controller';
export { fetch, type FetchOptions } from './fetch';
export { fetchForGlobal } from './fetch-global';
export { FetchGroup } from './group';
export type { FetchBody } from './body';
export { ConnectionPool, networkPartitionKeysEqual, type NetworkPartitionKey } from './transport';
export type {
  HTTPTransport, HTTPTransportRequest, HTTPTransportListener, HTTPTransportControl, HTTPConnection, HTTPUploadSource,
  HTTPContentDecoder, HTTPContentDecoderListener,
} from './transport';
export { HTTPCacheStore } from './cache-http';
export { CORSPreflightCache } from './cache-cors';
export type {
  FetchEnvironment, FetchEnvironmentRecord, FetchUserAgent,
  HTTPAuthentication, AuthenticationCredentials, AuthenticationEntry,
  FetchInsecureRequestsPolicy, FetchEmbedderPolicy,
  FetchPolicyContainer, FetchCSPList, FetchPromptTarget, fetchPromptTargetBrand, FetchEmbedderPolicyValue, ReferrerPolicy,
} from './environment';
export { fetchEnvironment } from './environment';
export { getEnvironmentDefaultUserAgent, isHeaderValue, isOkStatus, FetchHeaders } from './headers';
export {
  requestIDL, FetchRequest, isScriptLikeDestination,
  type Destination, type FetchMode, type RequestCredentials, type RequestInternalPriority,
  type FetchRequestInfo, type FetchRequestInit,
} from './request';
export { responseIDL, FetchResponse, isFilteredResponse, type CacheUsage, type ResponseImpl } from './response';
export { ConnectionTimingInfo, type FetchTimingInfo, type ResponseBodyInfo, type ServiceWorkerTimingInfo } from './timing';
export {
  parseIntegrityMetadata, applyIntegrityAlgorithm, type IntegrityMetadata, type IntegrityAlgorithm,
} from './integrity';
export type { FetchIntegrityPolicy, IntegrityViolationReportBody } from './policy';
export { isLocalScheme, isLocalURL } from './url';

export const fetchIDLDefinitions: Definition[] = [
  headersInitIDL,
  headersIDL,
  xmlHttpRequestBodyInitIDL, bodyInitIDL, bodyIDL,
  requestInfoIDL, requestInitIDL, requestDestinationIDL, requestModeIDL,
  requestCredentialsIDL, requestCacheIDL, requestRedirectIDL, requestDuplexIDL, requestPriorityIDL,
  requestIDL, requestIncludesBodyIDL,
  responseInitIDL, responseTypeIDL, responseIDL, responseIncludesBodyIDL,
  fetchGlobalScopeIDL,
];
