import { vi } from 'vitest';
import type { FetchUserAgent } from '../../src/fetch/environment';
import type { HTTPTransportListener, HTTPTransportRequest } from '../../src/fetch/transport';

/** Control wire responses while retaining Fetch's request preparation and response processing. */
export function mockHTTPTransport(
  userAgent: FetchUserAgent, respond: (request: HTTPTransportRequest, listener: HTTPTransportListener) => void,
) {
  return vi.spyOn(userAgent.httpTransport, 'dispatch').mockImplementation((request, listener) => {
    respond(request, listener);
    return { pause() {}, resume() {}, abort() {} };
  });
}
