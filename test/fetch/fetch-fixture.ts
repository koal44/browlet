import { createRuntime } from '../js-engine/runtime-fixture';
import { vi } from 'vitest';
import type { FetchEnvironmentSettingsObject } from '../../src/fetch/infrastructure';
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

export function createFetchRequest(
  url = 'https://example.test/start',
  client: FetchEnvironmentSettingsObject | null = null,
) {
  const parsed = parseURL(url).url;
  if (parsed === null) throw new Error('Invalid fixture URL');
  return new FetchRequest(parsed, client);
}

export function createFetchFixture() {
  const bindings = new BindingWorld([
    ...streamsIDLDefinitions, ...fileIDLDefinitions, ...xhrIDLDefinitions, ...urlIDLDefinitions,
    headersInitIDL, headersIDL, xmlHttpRequestBodyInitIDL, bodyInitIDL, bodyIDL,
    requestInfoIDL, requestInitIDL, requestDestinationIDL, requestModeIDL,
    requestCredentialsIDL, requestCacheIDL, requestRedirectIDL, requestDuplexIDL, requestPriorityIDL,
    requestIDL, requestIncludesBodyIDL, responseInitIDL, responseTypeIDL, responseIDL, responseIncludesBodyIDL,
  ]);
  const realm = new TestRealm();
  const context = bindings.register(realm);
  const scheduling = { queueGlobalTask: vi.fn(), runInParallel: vi.fn() };
  const runtime = { ...createRuntime(realm), networking: scheduling };
  // This fixture allocates implementations. The incomplete API family is not installed.
  return {
    bindings,
    realm,
    context,
    createBody: () => new FetchBody(ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, runtime), runtime),
    createRequest: (record: FetchRequest, signal: object, guard: HeadersGuard = 'request') =>
      context.construct(RequestImpl, record, guard, signal),
    createResponse: (record = new FetchResponse(), guard: HeadersGuard = 'response') =>
      context.construct(ResponseImpl, record, guard),
    createHeaders: () => context.construct(HeadersImpl),
  };
}
