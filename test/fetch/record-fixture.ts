import { BodyRecord, bodyIDL, bodyInitIDL, xmlHttpRequestBodyInitIDL } from '../../src/fetch/body';
import { HeadersImpl, headersIDL, headersInitIDL, type HeadersGuard } from '../../src/fetch/headers';
import {
  RequestImpl, RequestRecord, requestCacheIDL, requestCredentialsIDL, requestDestinationIDL,
  requestDuplexIDL, requestIDL, requestIncludesBodyIDL, requestInfoIDL, requestInitIDL,
  requestModeIDL, requestPriorityIDL, requestRedirectIDL,
} from '../../src/fetch/request';
import {
  ResponseImpl, ResponseRecord, responseIDL, responseIncludesBodyIDL, responseInitIDL, responseTypeIDL,
} from '../../src/fetch/response';
import { fileIDLDefinitions } from '../../src/file/index';
import { createReadableStream, streamsIDLDefinitions } from '../../src/streams/index';
import { urlIDLDefinitions } from '../../src/url/api';
import { parseURL } from '../../src/url/url';
import { createBindings } from '../../src/web-idl/index';
import { xhrIDLDefinitions } from '../../src/xhr/index';
import { TestRealm } from '../web-idl/test-realm';

export function createRequestRecord(url = 'https://example.test/start', client: object | null = null) {
  const parsed = parseURL(url).url;
  if (parsed === null) throw new Error('Invalid fixture URL');
  return new RequestRecord(parsed, client);
}

export function createRecordFixture() {
  const bindings = createBindings([
    ...streamsIDLDefinitions, ...fileIDLDefinitions, ...xhrIDLDefinitions, ...urlIDLDefinitions,
    headersInitIDL, headersIDL, xmlHttpRequestBodyInitIDL, bodyInitIDL, bodyIDL,
    requestInfoIDL, requestInitIDL, requestDestinationIDL, requestModeIDL,
    requestCredentialsIDL, requestCacheIDL, requestRedirectIDL, requestDuplexIDL, requestPriorityIDL,
    requestIDL, requestIncludesBodyIDL, responseInitIDL, responseTypeIDL, responseIDL, responseIncludesBodyIDL,
  ]);
  const realm = new TestRealm();
  const registration = bindings.register(realm);
  const { context } = registration;
  // This fixture allocates implementations. The incomplete API family is not installed.
  return {
    bindings,
    realm,
    context,
    createBody: () => new BodyRecord(createReadableStream(context)),
    createRequest: (record: RequestRecord, signal: object, guard: HeadersGuard = 'request') =>
      context.construct(RequestImpl, record, guard, signal),
    createResponse: (record = new ResponseRecord(), guard: HeadersGuard = 'response') =>
      context.construct(ResponseImpl, record, guard),
    createHeaders: () => context.construct(HeadersImpl),
  };
}
