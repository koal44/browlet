import { asciiLower, InternalError, internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../../infra/index';
import { ReadableStreamImpl } from '../../streams/index';
import { MultipartParser, type MultipartHeaders } from '../../mime/index';
import { FetchBody, FetchHeaders, isLocalURL, type FetchResponse } from '../../fetch/index';

import type { UserAgent } from '../user-agent';

import type { ResourceReader } from './resource-reader';

/** Split a fetched multipart resource into independently readable response bodies. */
// HTML §7.5.5 owns the response handoff; RFC 2046 owns the framing and part headers.
export class MultipartResourceReader {
  #resource: ResourceReader;
  #userAgent: UserAgent;
  #parser: MultipartParser;
  /** Outer and earlier-part policies remain restrictions on subsequent replacements. */
  #cspHeaders = new FetchHeaders();
  /** Parts discovered in one source chunk; further input waits for body demand. */
  #parts: FetchResponse[] = [];
  #next?: InternalPromiseWithResolvers<FetchResponse | null>;
  #reading?: InternalPromise<void>;
  #part: FetchResponse | null = null;
  #ended = false;
  #failure?: { reason: unknown; };

  constructor(resource: ResourceReader, userAgent: UserAgent) {
    const boundary = resource.mimeType.parameters.get('boundary');
    if (boundary === undefined) throw new InternalError('Multipart response has no boundary');
    this.#resource = resource;
    this.#userAgent = userAgent;
    for (const [name, value] of resource.response.headerList) {
      const lower = asciiLower(name);
      if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
        this.#cspHeaders.append(name, value);
      }
    }
    this.#parser = new MultipartParser(boundary, {
      onPartHeaders: (headers) => this.#startPart(headers),
      onPartData: (bytes) => {
        const part = this.#part!;
        part.bodyInfo.encodedSize += bytes.length;
        part.bodyInfo.decodedSize += bytes.length;
        part.body!.stream.enqueueChunk(bytes);
      },
      onPartEnd: () => {
        this.#part!.body!.stream.close();
        this.#part = null;
      },
    });
  }

  /** Return the next part at its headers. Consume its body before requesting further input. */
  readPart(): InternalPromise<FetchResponse | null> {
    const Promise = this.#userAgent.HostPromise;
    const type = internalType<FetchResponse | null>();
    if (this.#failure !== undefined) return Promise.reject(this.#failure.reason, type);
    if (this.#next !== undefined) throw new InternalError('Multipart part reads must be sequential');
    const part = this.#parts.shift();
    if (part !== undefined) return Promise.resolve(part, type);
    if (this.#ended) return Promise.resolve(null, type);
    const next = Promise.withResolvers(type);
    this.#next = next;
    this.#findNextPart();
    return next.promise;
  }

  /** Cancel every unfinished part and the outer source; cancellation is not a part boundary. */
  cancel(reason: unknown): InternalPromise<void> {
    const result = this.#userAgent.HostPromise.withResolvers(internalType<void>());
    this.#userAgent.sandbox.queueTask('network', () => {
      this.#fail(reason);
      // TODO(node-compat): Linked ResourceReader cancellation can miss the observer's
      // queue wake-up. Keep completion chained; the strict runtime regression remains enabled.
      this.#resource.cancel(reason).observe(result.resolve, result.reject);
    });
    return result.promise;
  }

  #findNextPart(): void {
    if (this.#next === undefined || this.#part !== null || this.#ended) return;
    // #read also wakes header discovery when a body pull encounters its boundary.
    this.#read().observe(() => {}, () => {});
  }

  /** Read at most one transport chunk; body pulls and header discovery share the same read. */
  #read(): InternalPromise<void> {
    if (this.#reading !== undefined) return this.#reading;
    const userAgent = this.#userAgent;
    const result = userAgent.HostPromise.withResolvers(internalType<void>());
    if (this.#failure !== undefined) return userAgent.HostPromise.reject(this.#failure.reason, internalType<void>());
    if (this.#ended) return userAgent.HostPromise.resolve(undefined, internalType<void>());
    this.#reading = result.promise;
    this.#resource.read().observe((bytes) => userAgent.sandbox.queueTask('network', () => {
      try {
        if (this.#failure !== undefined) throw this.#failure.reason;
        const valid = bytes === null ? this.#parser.finish() : this.#parser.appendData(bytes);
        // TODO(HTML §7.5.5): Audit recovery for malformed/truncated multipart Documents.
        if (!valid) throw new InternalError('Malformed multipart response');
        if (bytes === null) {
          this.#ended = true;
          this.#next?.resolve(null);
          this.#next = undefined;
        }
        this.#reading = undefined;
        result.resolve(undefined);
        this.#findNextPart();
      } catch (error) {
        this.#fail(error);
        this.#reading = undefined;
        result.reject(error);
        this.#resource.cancel(error).observe(() => {}, (cancelError) => {
          if (cancelError !== error) userAgent.runInParallel(() => { throw cancelError; });
        });
      }
    }), (error) => userAgent.sandbox.queueTask('network', () => {
      this.#fail(error);
      this.#reading = undefined;
      result.reject(error);
    }));
    return result.promise;
  }

  #startPart(headers: MultipartHeaders): void {
    const env = this.#userAgent.sandbox;
    const stream = ReadableStreamImpl.createDefault(() => this.#read(), (reason) => this.cancel(reason), 0, () => 1, env);
    const response = this.#resource.response.copy(new FetchBody(stream, env));
    // The transport has already decoded its body; each part has its own entity metadata.
    for (const name of ['Content-Type', 'Content-Length', 'Content-Encoding', 'Content-Range']) response.headerList.delete(name);
    response.bodyInfo.encodedSize = 0;
    response.bodyInfo.decodedSize = 0;
    const replaced = new Set<string>();
    const url = response.url;
    const local = url !== null && isLocalURL(url);
    for (const [name, value] of headers) {
      const lower = asciiLower(name);
      if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
        // TODO(HTML §7.5.5): Compose part headers with inherited local-URL policies,
        // preserving each policy's self origin and provenance across replacements.
        if (local) throw new InternalError('Local-URL multipart part CSP inheritance is not implemented');
        // SPEC_CLASH(multipart-csp-lifetime): Follow WebKit's cumulative independent policies;
        // Gecko combines the outer policy with only the current part, joining directive text.
        this.#cspHeaders.append(name, value);
        continue;
      }
      if (lower === 'content-transfer-encoding' && !['7bit', '8bit', 'binary'].includes(asciiLower(value))) {
        // TODO(RFC 2045 §6): Decode non-identity Content-Transfer-Encoding before dispatch.
        throw new InternalError('Multipart transfer decoding is not implemented');
      }
      if (lower !== 'content-type' && lower !== 'content-length' && lower !== 'content-disposition') continue;
      if (!replaced.has(lower)) { response.headerList.delete(lower); replaced.add(lower); }
      response.headerList.append(name, value);
    }
    response.headerList.delete('Content-Security-Policy');
    response.headerList.delete('Content-Security-Policy-Report-Only');
    for (const [name, value] of this.#cspHeaders) response.headerList.append(name, value);
    // SPEC_CLASH(multipart-default-content-type): RFC 2046 defaults to text/plain;
    // WebKit sniffs HTML-shaped untyped parts. Keep the RFC default.
    if (!response.headerList.has('Content-Type')) response.headerList.append('Content-Type', 'text/plain');
    this.#part = response;
    const next = this.#next;
    if (next === undefined) { this.#parts.push(response); }
    else { this.#next = undefined; next.resolve(response); }
  }

  #fail(reason: unknown): void {
    if (this.#failure !== undefined) return;
    this.#failure = { reason };
    this.#ended = true;
    this.#parser.cancel();
    const stream = this.#part?.body?.stream;
    if (stream?.state.state === 'readable') stream.error(reason);
    this.#part = null;
    this.#parts = [];
    this.#next?.reject(reason);
    this.#next = undefined;
  }
}
