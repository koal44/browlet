import type { Definition } from '../web-idl/core/index';

import type { FetchEnvironment } from './environment';
import { headersIDL, headersInitIDL } from './headers';
import { bodyIDL, bodyInitIDL, xmlHttpRequestBodyInitIDL } from './body';
import {
  requestIDL, requestIncludesBodyIDL, requestInitIDL, requestInfoIDL, requestCacheIDL,
  requestCredentialsIDL, requestDestinationIDL, requestDuplexIDL, requestModeIDL,
  requestPriorityIDL, requestRedirectIDL,
} from './request';
import { referrerPolicyIDL } from './policy';
import { responseIDL, responseIncludesBodyIDL, responseInitIDL, responseTypeIDL } from './response';
import { fetchGlobalScopeIDL } from './fetch-global';

/** Fetch declarations and global-scope contributions supplied to the host binding. */
export const fetchIDLDefinitions: Definition<FetchEnvironment>[] = [
  headersInitIDL,
  headersIDL,
  xmlHttpRequestBodyInitIDL, bodyInitIDL, bodyIDL,
  requestInfoIDL, requestInitIDL, requestDestinationIDL, requestModeIDL,
  requestCredentialsIDL, requestCacheIDL, requestRedirectIDL, requestDuplexIDL, requestPriorityIDL,
  referrerPolicyIDL,
  requestIDL, requestIncludesBodyIDL,
  responseInitIDL, responseTypeIDL, responseIDL, responseIncludesBodyIDL,
  fetchGlobalScopeIDL,
];
