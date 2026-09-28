import { createEnvironment, type TestEnvironment } from '../js-engine/execution-fixture';
import type { AbortSignalCapability } from '../../src/js-engine/index';
import type { FetchEnvironment } from '../../src/fetch/environment';
import {
  FetchBody, bodyIDL, bodyInitIDL, xmlHttpRequestBodyInitIDL,
} from '../../src/fetch/body';
import {
  HeadersImpl, headersIDL, headersInitIDL, type HeadersGuard,
} from '../../src/fetch/headers';
import {
  RequestImpl, FetchRequest, requestCacheIDL, requestCredentialsIDL,
  requestDestinationIDL, requestDuplexIDL, requestIDL, requestIncludesBodyIDL,
  requestInfoIDL, requestInitIDL, requestModeIDL, requestPriorityIDL, requestRedirectIDL,
} from '../../src/fetch/request';
import {
  ResponseImpl, FetchResponse, responseIDL, responseIncludesBodyIDL, responseInitIDL,
  responseTypeIDL,
} from '../../src/fetch/response';
import { fileIDLDefinitions } from '../../src/file/index';
import { streamsIDLDefinitions, ReadableStreamImpl } from '../../src/streams/index';
import { urlIDLDefinitions } from '../../src/url/api';
import { parseURL } from '../../src/url/url';
import { BindingWorld } from '../../src/web-idl/index';
import { xhrIDLDefinitions } from '../../src/xhr/index';
import { TestRealm } from '../web-idl/test-realm';
import { createFetchUserAgent } from './client-fixture';

export function createFetchRequest(
  url = 'https://example.test/start',
  client: FetchEnvironment | null = null,
) {
  const parsed = parseURL(url).url;
  if (parsed === null) throw new Error('Invalid fixture URL');
  return new FetchRequest(parsed, client, client?.userAgent ?? createFetchUserAgent());
}

export function createFetchFixture(world?: BindingWorld<TestEnvironment>) {
  const bindings = world ?? new BindingWorld<TestEnvironment>(fetchDefinitions);
  const realm = new TestRealm();
  const context = bindings.register(realm, (ctx) => createEnvironment(realm, ctx));
  const env = context.getEnvironment();
  // This fixture allocates implementations without installing the browser API.
  return {
    bindings,
    realm,
    context,
    env,
    createBody: () => new FetchBody(ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, env), env),
    createRequest: (record: FetchRequest, signal: AbortSignalCapability, guard: HeadersGuard = 'request') =>
      context.construct(RequestImpl, record, guard, signal),
    createResponse: (record = new FetchResponse(), guard: HeadersGuard = 'response') =>
      context.construct(ResponseImpl, record, guard),
    createHeaders: () => context.construct(HeadersImpl),
  };
}

export const fetchDefinitions = [
  ...streamsIDLDefinitions, ...fileIDLDefinitions, ...xhrIDLDefinitions, ...urlIDLDefinitions,
  headersInitIDL, headersIDL, xmlHttpRequestBodyInitIDL, bodyInitIDL, bodyIDL,
  requestInfoIDL, requestInitIDL, requestDestinationIDL, requestModeIDL,
  requestCredentialsIDL, requestCacheIDL, requestRedirectIDL, requestDuplexIDL, requestPriorityIDL,
  requestIDL, requestIncludesBodyIDL, responseInitIDL, responseTypeIDL, responseIDL, responseIncludesBodyIDL,
];
