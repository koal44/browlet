import { TypeError } from '../infra/exceptions';
import type { InternalPromiseWithResolvers } from '../infra/promises';
import { idlType } from '../web-idl/core/index';
import { ReadableStreamImpl } from '../streams/index';

import { FetchBody } from './body';
import type { FetchParams } from './params';
import { isFilteredResponse, type FetchResponse } from './response';

/** Deliver a realm-owned response body while retaining browser-owned Fetch execution. */
// SPEC_GAP(keepalive-delivery-lifetime): HTML #4483 leaves inactive-page Fetch work unresolved.
// Keep transport on the browser owner. Destruction retires page delivery and drains the response;
// it neither transfers an author stream into the sandbox nor cancels the network request.
export function deliverKeepaliveResponse(params: FetchParams, response: FetchResponse): FetchResponse {
  const internal = isFilteredResponse(response) ? response.internalResponse : response;
  const body = internal.body;
  if (body === null) return response;
  if (params.controller.responseDeliveryCanceled || (params.processResponseConsumeBody === null &&
    (response.body === null || params.processResponse === null))) {
    // Opaque and detached responses still need to reach EOF without accumulating an unread body.
    body.incrementallyRead(() => {}, () => {}, () => {});
    return response;
  }
  // Whole-body consumption already owns the internal reader; it needs no second stream consumer.
  if (params.processResponseConsumeBody !== null) return response;
  const delivered = response.copy(createDeliveryBody(body, params));
  // Transfer/timing counters remain live until the browser finishes receiving the response.
  delivered.bodyInfo = response.bodyInfo;
  return delivered;
}

/** Keep one pending chunk under backpressure; after detachment, consume and discard instead. */
function createDeliveryBody(body: FetchBody, params: FetchParams): FetchBody {
  const { env: sourceEnv, responseEnv: env, controller } = params;
  const reader = body.stream.getDefaultReader();
  reader.closed.observe(() => {}, () => {});
  let reading = false;
  let finished = false;
  let detached = false;
  let pull: InternalPromiseWithResolvers<void> | undefined;
  let removeCancellation = (): void => {};
  const stream = ReadableStreamImpl.createWithByteReadingSupport(
    () => {
      pull = env.InternalPromise.withResolvers(idlType.undefined);
      read();
      return pull.promise;
    },
    (reason) => {
      finished = true;
      detached = true;
      pull?.resolve(undefined);
      pull = undefined;
      removeCancellation();
      const result = env.InternalPromise.withResolvers(idlType.undefined);
      sourceEnv.queueTask('network', {
        run: () => {
          reader.cancel(reason).observe(() => {
            reader.release(sourceEnv);
            result.resolve(undefined);
          }, (error) => result.reject(error));
        },
      });
      return result.promise;
    },
    0, env,
  );
  removeCancellation = controller.addDeliveryCancellationSteps(detach);
  return new FetchBody(stream, env);

  function detach(): void {
    if (detached) return;
    detached = true;
    stream.error(new TypeError('Keepalive response delivery was discarded'));
    pull?.resolve(undefined);
    pull = undefined;
    read();
  }

  function read(): void {
    if (reading || finished) return;
    reading = true;
    sourceEnv.queueTask('network', {
      run: () => body.readChunk(
        reader, sourceEnv.realm.globalObject,
        (bytes) => deliver(() => stream.enqueueChunk(new env.realm.Uint8Array(bytes))),
        () => finish(() => stream.close()),
        // The internal stream has already realized its failure in the browser realm.
        // Copy it across this ownership boundary before storing it in the page's stream.
        (error) => finish(() => stream.error(env.deserialize(sourceEnv.serialize(error)))),
      ),
    });
  }

  function finish(steps: () => void): void {
    if (finished) return;
    finished = true;
    reader.release(sourceEnv);
    deliver(steps);
  }

  function deliver(steps: () => void): void {
    if (detached) {
      reading = false;
      if (finished) removeCancellation();
      else read();
      return;
    }
    env.queueTask('network', {
      run: () => {
        reading = false;
        if (!detached) steps();
        pull?.resolve(undefined);
        pull = undefined;
        if (finished) removeCancellation();
        else if (detached) read();
      },
      discard: () => { reading = false; detach(); read(); },
    });
  }
}
