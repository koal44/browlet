import { createEnvironment } from '../js-engine/execution-fixture';
import type { AbortSignalCapability } from '../../src/js-engine/index';
import type { FetchEnvironment } from '../../src/fetch/environment';
import { fetchIDLDefinitions } from '../../src/fetch/index';
import { fetchGlobalScopeIDL } from '../../src/fetch/fetch-global';
import { FetchBody } from '../../src/fetch/body';
import { HeadersImpl, type HeadersGuard } from '../../src/fetch/headers';
import { RequestImpl, FetchRequest } from '../../src/fetch/request';
import { ResponseImpl, FetchResponse } from '../../src/fetch/response';
import { fileIDLDefinitions } from '../../src/file/index';
import { streamsIDLDefinitions, ReadableStreamImpl } from '../../src/streams/index';
import { urlIDLDefinitions } from '../../src/url/api';
import { parseURL } from '../../src/url/url';
import { BindingWorld, defineInterface } from '../../src/web-idl/index';
import { xhrIDLDefinitions } from '../../src/xhr/index';
import { TestRealm } from '../web-idl/test-realm';
import { createClientEnvironment, createFetchUserAgent, type ClientEnvironment } from './client-fixture';

export function createFetchRequest(
  url = 'https://example.test/start',
  client: FetchEnvironment | null = null,
) {
  const parsed = parseURL(url).url;
  if (parsed === null) throw new Error('Invalid fixture URL');
  return new FetchRequest(parsed, client, client?.userAgent ?? createFetchUserAgent());
}

export function createFetchFixture(world?: BindingWorld<ClientEnvironment>) {
  const bindings = world ?? new BindingWorld<ClientEnvironment>(fetchDefinitions);
  const realm = new TestRealm();
  const context = bindings.register(realm, (ctx) => createClientEnvironment(undefined, createEnvironment(realm, ctx)));
  const env = context.getEnvironment();
  // This fixture allocates implementations without installing the browser API.
  return {
    bindings,
    realm,
    context,
    env,
    createBody: () => new FetchBody(ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, env), env),
    createRequest: (record: FetchRequest, signal: AbortSignalCapability, guard: HeadersGuard = 'request') =>
      context.construct(RequestImpl, [record, guard, signal]),
    createResponse: (record = new FetchResponse(), guard: HeadersGuard = 'response') =>
      context.construct(ResponseImpl, [record, guard]),
    createHeaders: () => context.construct(HeadersImpl),
  };
}

export const fetchDefinitions = [
  // There is no WindowOrWorkerGlobalScope in this standalone host.
  ...fetchIDLDefinitions.filter((definition) => definition !== fetchGlobalScopeIDL),
  ...streamsIDLDefinitions, ...fileIDLDefinitions,
  ...xhrIDLDefinitions, ...urlIDLDefinitions,
  // Cross-specification type identities; this host does not expose DOM or form APIs.
  // Those conversions are exercised through the browser's complete declarations.
  defineInterface({ name: 'AbortSignal', members: [] }),
  defineInterface({ name: 'HTMLElement', members: [] }),
  defineInterface({ name: 'HTMLFormElement', inherits: 'HTMLElement', members: [] }),
];
