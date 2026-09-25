import { isHTTPToken } from '../../http/index';
import { getBufferSourceCopy, getBufferTypeName } from '../../js-engine/index';
import { TypeError } from '../../infra/exceptions';
import { InternalError } from '../../infra/internal-error';
import type { InternalPromise, InternalPromiseCapability } from '../../infra/promises';
import { ReadableStreamImpl, type ReadableStreamDefaultReaderImpl } from '../../streams/index';
import { isDOMException } from '../../web-idl/index';
import { coarsenTime } from '../../infra/time';
import { FetchBody } from '../body';
import { deserializeAbortReason } from '../controller';
import { isOffline } from '../environment';
import type { FetchParams } from '../params';
import { FetchResponse } from '../response';
import { queueFetchTask } from '../tasks';
import type { HTTPTransportControl, HTTPUploadSource } from './transport';
import type { HTTPContentDecoder } from './content-decoder';
import { isNullBodyStatus } from './statuses';
import type { HTTPCacheEntry, HTTPCachePartition } from './cache/store';

/** HTTP-network fetch's wire exchange and demand-driven response body (Fetch §4.7). */
// SPEC_MISMATCH: (fetchParams, includeCredentials, forceNewConnection) -> response
export function httpNetworkFetch(
  params: FetchParams, includeCredentials = false, forceNewConnection = false, cache?: HTTPCachePartition,
): InternalPromise<FetchResponse> {
  const { request, env, controller, timingInfo } = params;
  const generation = cache?.generation;
  const result = request.userAgent.hostPromises.withResolvers<FetchResponse>();
  if (params.canceled) {
    result.resolve(FetchResponse.appropriateNetworkError(params));
    return result.promise;
  }
  if (request.userAgent.assumeNoInternetConnectivity || (request.client !== null && isOffline(request.client))) {
    result.resolve(FetchResponse.networkError());
    return result.promise;
  }
  if (request.body !== null && !(request.body instanceof FetchBody)) {
    throw new InternalError('HTTP network fetch requires an extracted request body');
  }
  if (request.mode === 'websocket' || request.mode === 'webtransport') {
    throw new InternalError('WebSocket and WebTransport connection establishment is not implemented');
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
    let discarded = false;
    let decoder: HTTPContentDecoder | undefined;
    let control: HTTPTransportControl | undefined;
    let decoderBlocked = false;
    let outputPaused = false;
    let transmitted = 0;
    let uploadEnded = false;
    let cacheEntry: HTTPCacheEntry | undefined;
    const upload = request.body instanceof FetchBody ? new NetworkUpload(request.body, params) : null;
    const body = new NetworkBody(params, () => {
      removeCancellation();
      response.discardBody = null;
    });
    response.body = new FetchBody(body.stream, env);
    body.setControl({
      pause() { outputPaused = true; decoder?.pause(); control?.pause(); },
      resume() {
        outputPaused = false;
        decoder?.resume();
        if (!decoderBlocked) control?.resume();
      },
      abort() {
        if (cacheEntry) cache!.owner.remove(cacheEntry);
        decoder?.abort(); upload?.cancel(); control?.abort();
      },
    });
    response.discardBody = () => {
      discarded = true;
      body.fail(() => new TypeError('Unused HTTP response body was discarded'));
    };
    const cancel = () => {
      response.aborted = params.aborted;
      body.fail(() => params.aborted
        ? deserializeAbortReason(controller.serializedAbortReason, env)
        : new TypeError('Network request was terminated'));
      if (result.pending) result.resolve(FetchResponse.appropriateNetworkError(params));
    };
    removeCancellation = controller.addCancellationSteps(cancel);
    const requestTime = Date.now();
    try {
      control = request.userAgent.httpTransport.dispatch({
        url: request.currentURL,
        method: request.method,
        headers: request.headerList,
        body: upload,
        partitionKey: request.determineNetworkPartitionKey(),
        includeCredentials,
        forceNewConnection,
      }, {
        onConnection(connection) {
          timingInfo.finalConnectionTimingInfo = connection.timingInfo.clampAndCoarsen(
            timingInfo.postRedirectStartTime, params.crossOriginIsolatedCapability,
          );
          if (connection.protocol === 'http/1.1' && request.body instanceof FetchBody && request.body.source === null) {
            return false;
          }
          timingInfo.finalNetworkRequestStartTime = now();
          return !params.canceled;
        },
        onRequestBodyChunkLength(length) {
          transmitted += length;
          queueCallback(() => params.processRequestBodyChunkLength?.(length));
          // The peer can finish a known-length response before Undici observes upload EOF.
          if (request.body instanceof FetchBody && transmitted === request.body.length) endUpload();
        },
        onRequestEnd: endUpload,
        onResponseStarted() { timingInfo.finalNetworkResponseStartTime = now(); },
        onHeaders(status, statusMessage, headers, hasValidTLS) {
          if (params.canceled || discarded) return;
          if (status < 200) {
            if (timingInfo.firstInterimNetworkResponseStartTime === 0) {
              timingInfo.firstInterimNetworkResponseStartTime = timingInfo.finalNetworkResponseStartTime;
            }
            const interim = new FetchResponse();
            interim.status = status;
            interim.headerList = headers;
            request.userAgent.webDriverBiDiResponseStarted(request, interim);
            if (status === 103 && params.processEarlyHintsResponse !== null) {
              queueCallback(() => params.processEarlyHintsResponse?.(interim));
            }
            return;
          }
          response.status = status;
          response.statusMessage = statusMessage;
          response.headerList = headers;
          request.userAgent.webDriverBiDiResponseStarted(request, response);
          request.userAgent.hstsStore.processResponse(response, hasValidTLS);
          if (includeCredentials) response.parseAndStoreCookies(request);
          request.userAgent.webDriverBiDiCloneNetworkResponseBody(request, response);
          if (request.method !== 'HEAD' && !isNullBodyStatus(status)) {
            const codings = headers.getDecodeAndSplit('Content-Encoding')?.filter((coding) => coding !== '');
            if (codings?.length && codings.every(isHTTPToken)) {
              // RFC 9110 §8.4.1.3 treats x-gzip as gzip. Keep the received name
              // in response metadata and use the canonical name for decoding.
              const normalized = codings.map((coding) => {
                const name = coding.toLowerCase();
                return name === 'x-gzip' ? 'gzip' : name;
              });
              const supported = normalized.every((coding) => request.userAgent.supportedContentCodings.has(coding));
              response.bodyInfo.contentEncoding = normalized.length > 1 ? 'multiple' : supported ? codings[0]!.toLowerCase() : '@unknown';
              if (supported) {
                decoder = request.userAgent.createContentDecoder(normalized, {
                  onData: receiveDecoded,
                  onEnd: endResponse,
                  onError() { if (!discarded && !params.canceled) controller.terminate(); },
                  onDrain() {
                    decoderBlocked = false;
                    if (!outputPaused && !params.canceled && !discarded) control?.resume();
                  },
                });
              }
            }
          }
          if (cache && generation === cache.generation) cacheEntry = cache.begin(request, response, requestTime, Date.now());
          result.resolve(response);
        },
        onData(bytes) {
          if (params.canceled || discarded) return;
          response.bodyInfo.encodedSize += bytes.byteLength;
          if (decoder) {
            if (!decoder.write(bytes)) { decoderBlocked = true; control?.pause(); }
          } else {
            receiveDecoded(bytes);
          }
        },
        onEnd() { upload?.cancel(); if (decoder) decoder.end(); else endResponse(); },
        onError() {
          // Native transport errors do not become page-owned exception objects.
          if (!params.canceled && !discarded) controller.terminate();
        },
      });
      synchronizeControl();
    } catch (error) {
      removeCancellation();
      body.fail(() => new TypeError('Network request failed'));
      result.reject(error);
    }

    function receiveDecoded(bytes: Uint8Array): void {
      if (params.canceled || discarded) return;
      response.bodyInfo.decodedSize += bytes.byteLength;
      cacheEntry?.append(bytes);
      body.receive(bytes);
    }
    function endResponse(): void {
      if (params.canceled || discarded) return;
      cacheEntry?.finish(response.bodyInfo);
      cacheEntry = undefined;
      body.end();
    }
    // dispatch() may synchronously deliver callbacks before returning its control.
    function synchronizeControl(): void {
      if (params.canceled || discarded) control!.abort();
      else if (decoderBlocked || outputPaused) control!.pause();
    }
    function now(): number {
      return coarsenTime(request.userAgent.unsafeSharedCurrentTime(), params.crossOriginIsolatedCapability);
    }
    function queueCallback(steps: () => void): void {
      queueFetchTask(() => { if (!params.canceled && !discarded) steps(); }, params.taskDestination ?? env.exec.global, env);
    }
    function endUpload(): void {
      if (uploadEnded) return;
      uploadEnded = true;
      queueCallback(() => params.processRequestEndOfBody?.());
    }
  }, env.exec.global, env);
  return result.promise;
}

/** Reads exactly one body chunk for each transport demand, always on the owning HTML loop. */
class NetworkUpload implements HTTPUploadSource {
  #body: FetchBody;
  #params: FetchParams;
  #reader: ReadableStreamDefaultReaderImpl | undefined;
  #finished = false;
  #pending: InternalPromiseCapability<Uint8Array | null> | undefined;

  constructor(body: FetchBody, params: FetchParams) {
    this.#body = body;
    this.#params = params;
  }

  read(): InternalPromise<Uint8Array | null> {
    if (this.#pending) throw new InternalError('HTTP transport requested concurrent upload reads');
    const { env, request } = this.#params;
    const result = request.userAgent.hostPromises.withResolvers<Uint8Array | null>();
    this.#pending = result;
    queueFetchTask(() => {
      if (this.#finished || this.#params.canceled) { this.#settle(null); return; }
      try {
        if (!this.#reader) {
          this.#reader = this.#body.stream.getDefaultReader();
          this.#reader.closed.observe(() => {}, () => {});
        }
        this.#reader.readChunk({
          chunkSteps: (chunk) => {
            try {
              if (typeof chunk !== 'object' || chunk === null || getBufferTypeName(chunk) !== 'Uint8Array') {
                throw new TypeError('Request body stream produced a non-Uint8Array chunk');
              }
              this.#settle(getBufferSourceCopy(chunk));
            } catch (error) { this.#fail(error); }
          },
          closeSteps: () => {
            this.#finished = true;
            this.#reader!.release();
            this.#settle(null);
          },
          errorSteps: (error) => this.#fail(error),
        });
      } catch (error) { this.#fail(error); }
    }, env.exec.global, env);
    return result.promise;
  }

  cancel(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#settle(null);
    const { env } = this.#params;
    queueFetchTask(() => {
      const pending = this.#reader ? this.#reader.cancel() : this.#body.stream.cancelInternal(undefined);
      pending.observe(() => {}, () => {});
      this.#reader?.release();
    }, env.exec.global, env);
  }

  #settle(bytes: Uint8Array | null): void {
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.resolve(bytes);
  }

  #fail(error: unknown): void {
    const { controller, env } = this.#params;
    if (!this.#params.canceled) {
      if (isDOMException(error, 'AbortError')) controller.abort(env);
      else controller.terminate();
    }
    this.cancel();
  }
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
  #pull: InternalPromiseCapability<void> | undefined;
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
