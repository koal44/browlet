import { BlobData, BlobImpl } from '../../file/index';
import { TypeError } from '../../infra/exceptions';
import { InternalError } from '../../infra/internal-error';
import type { PromiseValue, PromiseValueCapability } from '../../infra/promises';
import { ReadableStreamImpl } from '../../streams/index';
import { FetchBody } from '../body';
import { deserializeAbortReason } from '../controller';
import type { FetchParams } from '../params';
import { FetchResponse } from '../response';
import { queueFetchTask } from '../tasks';
import type { HTTPTransportControl } from './transport';

/** HTTP-network fetch's wire exchange and demand-driven response body (Fetch §4.7). */
// PROVISIONAL(Fetch 9B): connection timing, request-body consumption/progress, upload streams,
// decoding, informational responses, and HTTP processing precede network-or-cache integration.
export function httpNetworkFetch(
  params: FetchParams, includeCredentials = false, forceNewConnection = false,
): PromiseValue<FetchResponse> {
  const { request, env, controller } = params;
  const result = request.userAgent.hostPromises.withResolvers<FetchResponse>();
  if (params.canceled) {
    result.resolve(FetchResponse.appropriateNetworkError(params));
    return result.promise;
  }
  const source = request.body instanceof FetchBody ? request.body.source : null;
  if (source instanceof BlobImpl || source instanceof BlobData || (request.body !== null && source === null)) {
    throw new InternalError('Streaming HTTP uploads require Fetch 9B');
  }

  // Stream creation and all subsequent stream mutations belong to this execution owner.
  queueFetchTask(() => {
    if (params.canceled) {
      result.resolve(FetchResponse.appropriateNetworkError(params));
      return;
    }
    const response = new FetchResponse();
    response.urlList = [...request.urlList];
    response.requestIncludesCredentials = includeCredentials;
    let removeCancellation = () => {};
    const body = new NetworkBody(params, () => removeCancellation());
    response.body = new FetchBody(body.stream, env);
    const cancel = () => {
      body.fail(() => params.aborted
        ? deserializeAbortReason(controller.serializedAbortReason, env)
        : new TypeError('Network request was terminated'));
      if (result.pending) result.resolve(FetchResponse.appropriateNetworkError(params));
    };
    removeCancellation = controller.addCancellationSteps(cancel);
    try {
      body.setControl(request.userAgent.httpTransport.dispatch({
        url: request.currentURL,
        method: request.method,
        headers: request.headerList,
        body: source,
        partitionKey: request.determineNetworkPartitionKey(),
        includeCredentials,
        forceNewConnection,
      }, {
        onHeaders(status, statusMessage, headers, _hasValidTLS) {
          if (params.canceled || status < 200) return;
          response.status = status;
          response.statusMessage = statusMessage;
          response.headerList = headers;
          // TODO(Fetch 9B): process HSTS here using _hasValidTLS, before redirect handling.
          result.resolve(response);
        },
        onData(bytes) {
          if (params.canceled) return;
          response.bodyInfo.encodedSize += bytes.byteLength;
          body.receive(bytes);
        },
        onEnd() { body.end(); },
        onError() {
          // Native transport errors do not become page-owned exception objects.
          if (!params.canceled) controller.terminate();
        },
      }));
    } catch (error) {
      removeCancellation();
      body.fail(() => new TypeError('Network request failed'));
      result.reject(error);
    }
  }, env.exec.global, env);
  return result.promise;
}

/** Fetch's network byte buffer, retaining chunks until the response stream pulls them. */
class NetworkBody {
  stream: ReadableStreamImpl;
  #params: FetchParams;
  #finish: () => void;
  #control: HTTPTransportControl | undefined;
  #chunks: (Uint8Array | undefined)[] = [];
  #head = 0;
  #offset = 0;
  #size = 0;
  #paused = false;
  #ended = false;
  #finished = false;
  #failure: (() => unknown) | undefined;
  #pull: PromiseValueCapability<void> | undefined;
  #taskQueued = false;

  constructor(params: FetchParams, finish: () => void) {
    this.#params = params;
    this.#finish = finish;
    this.stream = ReadableStreamImpl.createWithByteReadingSupport(
      () => {
        this.#pull = params.env.exec.promises.withResolvers<void>();
        this.#scheduleDelivery();
        return this.#pull.promise;
      },
      (reason) => { params.controller.abort(reason, params.env); },
      0, params.env,
    );
  }

  setControl(control: HTTPTransportControl): void {
    this.#control = control;
    if (this.#failure) control.abort();
    else if (this.#paused) control.pause();
  }

  receive(bytes: Uint8Array): void {
    if (this.#finished || this.#failure || bytes.byteLength === 0) return;
    this.#chunks.push(bytes);
    this.#size += bytes.byteLength;
    if (!this.#paused && this.#size >= upperBufferLimit) {
      this.#paused = true;
      this.#control?.pause();
    }
    this.#scheduleDelivery();
  }

  end(): void {
    this.#ended = true;
    this.#scheduleDelivery();
  }

  fail(reason: () => unknown): void {
    if (this.#finished || this.#failure) return;
    this.#failure = reason;
    this.#chunks = [];
    this.#head = this.#offset = this.#size = 0;
    this.#control?.abort();
    this.#scheduleDelivery();
  }

  #scheduleDelivery(): void {
    if (this.#finished || this.#taskQueued) return;
    if (!this.#failure && !(this.#ended && this.#size === 0) &&
      !(this.#pull && this.#size > 0)) return;
    this.#taskQueued = true;
    const { env } = this.#params;
    queueFetchTask(() => {
      this.#taskQueued = false;
      this.#deliver();
    }, env.exec.global, env);
  }

  #deliver(): void {
    if (this.#finished) return;
    const pull = this.#pull;
    this.#pull = undefined;
    if (this.#failure) {
      this.stream.error(this.#failure());
      this.#complete();
    } else {
      if (pull && this.#size > 0) {
        const bytes = this.#chunks[this.#head]!;
        const offset = this.stream.pullFromBytes(bytes, this.#offset);
        this.#size -= offset - this.#offset;
        this.#offset = offset;
        if (offset === bytes.byteLength) {
          this.#chunks[this.#head++] = undefined;
          this.#offset = 0;
          if (this.#head === this.#chunks.length) {
            this.#chunks = [];
            this.#head = 0;
          } else if (this.#head >= 64 && this.#head * 2 >= this.#chunks.length) {
            this.#chunks = this.#chunks.slice(this.#head);
            this.#head = 0;
          }
        }
      }
      if (this.#ended && this.#size === 0) {
        this.stream.close();
        this.#complete();
      } else if (this.#paused && this.#size < lowerBufferLimit) {
        this.#paused = false;
        this.#control?.resume();
      }
    }
    pull?.resolve(undefined);
  }

  #complete(): void {
    this.#finished = true;
    this.#finish();
  }
}

// Fetch §4.7 permits implementation-chosen upper/lower network-buffer limits.
// A received transport chunk can overshoot the upper limit; paused delivery cannot accumulate tasks.
const upperBufferLimit = 64 * 1024;
const lowerBufferLimit = 32 * 1024;
