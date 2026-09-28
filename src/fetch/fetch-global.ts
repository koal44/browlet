import { TypeError } from '../infra/exceptions';
import { InternalError } from '../infra/internal-error';
import type { InternalPromise, InternalPromiseWithResolvers } from '../infra/promises';
import {
  arg, definePartialInterfaceMixin, emptyDictionary, op, promise, reference, xattr,
} from '../web-idl/index';
import { FetchBody } from './body';
import { deserializeAbortReason, type FetchController } from './controller';
import type { FetchEnvironment } from './environment';
import { fetch } from './fetch';
import { RequestImpl, type FetchRequest, type FetchRequestInfo, type FetchRequestInit } from './request';
import { ResponseImpl } from './response';

/** Fetch from a global using converted arguments and its relevant environment. */
// https://fetch.spec.whatwg.org/#dom-global-fetch
export function fetchForGlobal(
  input: FetchRequestInfo, init: FetchRequestInit, env: FetchEnvironment,
): InternalPromise<ResponseImpl> {
  // Web IDL turns construction failures into rejected promises in the method
  // realm. The ongoing fetch and its Response use the receiver's environment.
  const requestObject = RequestImpl.create(input, init, env);
  // SPEC_CLASH(fetch-borrowed-realm): Blink/Gecko use the receiver realm for
  // successful promises and Responses; WebKit uses the method realm. Keep the receiver.
  const result = env.exec.Promise.withResolvers(reference(ResponseImpl));
  const request = requestObject.getRequest();
  const signal = requestObject.signal;
  if (signal.aborted) {
    abortFetch(result, request, null, signal.reason);
    return result.promise;
  }
  if (env.isServiceWorker) request.allowServiceWorkerInterception = false;

  let responseObject: ResponseImpl | null = null;
  let locallyAborted = false;
  let controller: FetchController | null = null;
  const abortHandle = signal.addAlgorithm(() => {
    locallyAborted = true;
    if (controller === null) throw new InternalError('Fetch abort steps ran before its controller was created');
    controller.abort(signal.reason, env);
    abortFetch(result, request, responseObject, signal.reason);
  });
  controller = fetch(request, {
    processResponse(response) {
      if (locallyAborted) return;
      if (response.aborted) {
        if (controller === null) throw new InternalError('Fetch delivered a response before creating its controller');
        abortFetch(result, request, responseObject, deserializeAbortReason(controller.serializedAbortReason, env));
        abortHandle?.remove();
      } else if (response.type === 'error') {
        result.reject(new TypeError('Failed to fetch'));
        abortHandle?.remove();
      } else {
        responseObject = new ResponseImpl(response, 'immutable', env);
        result.resolve(responseObject);
      }
    },
  }, env);
  return result.promise;
}

// Fetch contributes this operation to HTML's existing global-scope implementation.
export const fetchGlobalScopeIDL = definePartialInterfaceMixin({
  name: 'WindowOrWorkerGlobalScope',
  members: [
    op('fetch', promise(reference('Response')),
      [
        arg('input', reference('RequestInfo')),
        arg('init', reference('RequestInit'), { optional: true, default: emptyDictionary }),
      ],
      xattr('NewObject'),
    ),
  ],
});

// https://fetch.spec.whatwg.org/#abort-fetch
// The internal capability supplies the promise's settlement operations.
function abortFetch(
  result: InternalPromiseWithResolvers<ResponseImpl>, request: FetchRequest, response: ResponseImpl | null, error: unknown,
): void {
  result.reject(error);
  if (request.body instanceof FetchBody && request.body.stream.isReadable) {
    void request.body.stream.cancelInternal(error).catch(() => {});
  }
  const stream = response?.body;
  if (stream?.isReadable) stream.errorInternal(error);
}
