import type { TaskHandle } from '../../infra/execution';
import { InternalError } from '../../infra/internal-error';
import { internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../../infra/promises';
import type { ReadableStreamDefaultReaderImpl } from '../../streams/index';
import {
  detectSuppliedMIMEType, maximumResourceHeaderLength, preservedMIMEType, sniffMIMEType, type MIMEType,
} from '../../mime/index';
import { isFilteredResponse, type FetchResponse } from '../../fetch/index';

import type { UserAgent } from '../user-agent';

/** Reads a fetched resource, preserving its sniffing prefix for subsequent consumption. */
// Browlet's input owner, not a specification-defined class. Named MIME
// algorithms are referenced on the operations that invoke them below.
export class ResourceReader {
  /** Internal response, including the bytes and headers hidden by response filtering. */
  response: FetchResponse;
  #userAgent: UserAgent;
  /** Exclusive reader held while consuming the response body. */
  #streamReader?: ReadableStreamDefaultReaderImpl;
  /** Retain a Fetch read until sniffing or body consumption takes its result, even past the deadline. */
  #sourceRead?: InternalPromiseWithResolvers<Uint8Array | null>;
  /** Terminal input state; failures may carry any value, including undefined. */
  #end?: 'eof' | { error: unknown; };
  /** Determined type; body consumption is forbidden until this value exists. */
  #mimeType?: MIMEType;
  /** Guard against overlapping MIME determinations; the operation's promise stays local. */
  #sniffing = false;
  /** Complete copied chunks, including any bytes beyond the sniffing prefix. */
  #buffered: Uint8Array[] = [];
  #replayIndex = 0;
  #reading = false;
  #cancellation?: InternalPromise<void>;

  constructor(response: FetchResponse, userAgent: UserAgent) {
    // Fetch requires algorithms using responses to inspect the internal response.
    // https://fetch.spec.whatwg.org/#concept-filtered-response
    this.response = isFilteredResponse(response) ? response.internalResponse : response;
    this.#userAgent = userAgent;
  }

  /** Determine the computed MIME type before consuming the body. Overlapping calls throw. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#content-type-sniffing
  // https://mimesniff.spec.whatwg.org/#mime-type-sniffing-algorithm
  determineMIMEType(): InternalPromise<MIMEType> {
    const userAgent = this.#userAgent;
    if (this.#mimeType !== undefined) return userAgent.HostPromise.resolve(this.#mimeType, internalType<MIMEType>());
    if (this.#sniffing) throw new InternalError('MIME type determination is already in progress');
    if (this.#end !== undefined && this.#end !== 'eof') {
      return userAgent.HostPromise.reject(this.#end.error, internalType<MIMEType>());
    }
    const { headerList, url } = this.response;
    const http = url?.scheme === 'http' || url?.scheme === 'https';
    // https://mimesniff.spec.whatwg.org/#supplied-mime-type-detection-algorithm
    const detection = detectSuppliedMIMEType(http
      ? { kind: 'http', contentType: headerList.list.findLast(([name]) => name.toLowerCase() === 'content-type')?.[1] }
      : { kind: 'mime-type', mimeType: headerList.extractMIMEType() ?? undefined });
    this.#mimeType = preservedMIMEType(detection.suppliedMIMEType);
    if (this.#mimeType !== undefined) return userAgent.HostPromise.resolve(this.#mimeType, internalType<MIMEType>());
    // https://fetch.spec.whatwg.org/#determine-nosniff
    const noSniff = headerList.determineNosniff();
    const result = userAgent.HostPromise.withResolvers(internalType<MIMEType>());
    this.#sniffing = true;
    // Collect the resource header here; MIME interprets its bytes once collection ends.
    // https://mimesniff.spec.whatwg.org/#read-the-resource-header
    const header = new Uint8Array(maximumResourceHeaderLength);
    let length = 0;
    const deadline = userAgent.unsafeSharedCurrentTime() + resourceHeaderTimeout;
    let timer: TaskHandle | undefined;
    const fail = (error: unknown): void => {
      if (result.isResolved) return;
      timer?.remove();
      this.#sniffing = false;
      this.#buffered = [];
      result.reject(error);
    };
    const collect = (chunk?: Uint8Array | null): void => {
      if (result.isResolved) return;
      if (this.#end !== undefined && this.#end !== 'eof') { fail(this.#end.error); return; }
      const expired = userAgent.unsafeSharedCurrentTime() >= deadline;
      if (chunk !== undefined) this.#sourceRead = undefined;
      if (chunk?.length) {
        this.#buffered.push(chunk);
        // A delayed timer must not admit late bytes to the sniffing prefix.
        if (!expired) {
          const prefix = chunk.subarray(0, header.length - length);
          header.set(prefix, length);
          length += prefix.length;
        }
      }
      if (chunk !== null && !expired && length < header.length) {
        this.#readSource().observe(collect, fail);
      } else {
        this.#mimeType = sniffMIMEType(detection, header.subarray(0, length), noSniff, (type) => userAgent.supportsMIMEType(type));
        this.#sniffing = false;
        timer?.remove();
        result.resolve(this.#mimeType);
      }
    };
    collect();
    if (!result.isResolved) {
      const expire = (): void => {
        if (result.isResolved) return;
        const remaining = deadline - userAgent.unsafeSharedCurrentTime();
        // Timer hosts may wake early; only elapsed time ends inspection.
        if (remaining > 0) timer = userAgent.timerHost.scheduleTimeout(remaining, expire);
        else collect();
      };
      timer = userAgent.timerHost.scheduleTimeout(resourceHeaderTimeout, expire);
    }
    return result.promise;
  }

  /** Read a complete chunk or null at EOF, after MIME determination. Call sequentially; buffered bytes come first. */
  read(): InternalPromise<Uint8Array | null> {
    if (this.#mimeType === undefined) throw new InternalError('Determine the MIME type before consuming the resource body');
    if (this.#reading) throw new InternalError('Resource reads must be sequential');
    if (this.#replayIndex < this.#buffered.length) {
      const chunk = this.#buffered[this.#replayIndex++]!;
      if (this.#replayIndex === this.#buffered.length) {
        this.#buffered = [];
        this.#replayIndex = 0;
      }
      return this.#userAgent.HostPromise.resolve(chunk, internalType<Uint8Array | null>());
    }
    this.#reading = true;
    return this.#readSource().then((chunk) => {
      this.#reading = false;
      // Cancellation can occur after Fetch resolves its read but before this continuation.
      if (this.#end !== undefined && this.#end !== 'eof') throw this.#end.error;
      this.#sourceRead = undefined;
      return chunk?.length === 0 ? this.read() : chunk;
    }, (error) => { this.#reading = false; throw error; });
  }

  /** Reject pending input, discard retained bytes, and cancel the source in its owning environment. */
  // The retained-prefix cleanup is Browlet machinery; source cancellation uses
  // Streams' cancellation algorithm even while the stream is locked to us.
  // https://streams.spec.whatwg.org/#readable-stream-cancel
  cancel(reason?: unknown): InternalPromise<void> {
    if (this.#cancellation !== undefined) return this.#cancellation;
    const complete = this.#userAgent.HostPromise.withResolvers(internalType<void>());
    this.#cancellation = complete.promise;
    this.#end = { error: reason };
    this.#buffered = [];
    this.#replayIndex = 0;
    this.#sourceRead?.reject(reason);
    this.#sourceRead = undefined;
    const body = this.response.body;
    if (body === null) {
      complete.resolve(undefined);
    } else {
      body.stream.env.exec.queueTask('network', () => {
        try {
          body.stream.cancelInternal(reason).observe(complete.resolve, complete.reject);
          this.#releaseStreamReader();
        } catch (error) { complete.reject(error); }
      });
    }
    return complete.promise;
  }

  /** Read raw Fetch bytes for sniffing or body delivery, reusing any result left at the deadline. */
  #readSource(): InternalPromise<Uint8Array | null> {
    if (this.#sourceRead !== undefined) return this.#sourceRead.promise;
    if (this.#end !== undefined) {
      return this.#end === 'eof'
        ? this.#userAgent.HostPromise.resolve(null, internalType<Uint8Array | null>())
        : this.#userAgent.HostPromise.reject(this.#end.error, internalType<Uint8Array | null>());
    }
    const result = this.#userAgent.HostPromise.withResolvers(internalType<Uint8Array | null>());
    this.#sourceRead = result;
    const body = this.response.body;
    if (body === null) {
      this.#endSource('eof');
      return result.promise;
    }
    const env = body.stream.env;
    env.exec.queueTask('network', () => {
      if (this.#end !== undefined) return;
      try {
        this.#streamReader ??= body.stream.getDefaultReader();
        body.readChunk(this.#streamReader, env.exec.global,
          (chunk) => {
            // Fetch may have queued this delivery before cancellation began.
            if (this.#end !== undefined) return;
            result.resolve(chunk);
          },
          () => this.#endSource('eof'),
          (error) => this.#endSource({ error }),
        );
      } catch (error) { this.#endSource({ error }); }
    });
    return result.promise;
  }

  /** Retain terminal input state and release its lock in the source environment. */
  #endSource(end: 'eof' | { error: unknown; }): void {
    if (this.#end !== undefined) return;
    this.#end = end;
    const result = this.#sourceRead;
    this.#sourceRead = undefined;
    this.#releaseStreamReader();
    if (end === 'eof') result?.resolve(null);
    else result?.reject(end.error);
  }

  /** Release the source lock after EOF, failure, or cancellation. */
  // https://streams.spec.whatwg.org/#readable-stream-default-reader-release
  #releaseStreamReader(): void {
    const streamReader = this.#streamReader;
    this.#streamReader = undefined;
    streamReader?.release(this.response.body!.stream.env);
  }
}

// MIME Sniffing leaves this deadline to the UA. Bound initial type detection
// to half a second; reaching 1445 bytes or EOF ends it sooner.
const resourceHeaderTimeout = 500;
