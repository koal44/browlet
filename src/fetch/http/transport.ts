import type { URLRecord } from '../../url/index';
import type { FetchHeaders } from '../headers';
import type { NetworkPartitionKey } from './network-partition';
import type { Connection } from './connections';
import type { PromiseValue } from '../../infra/promises';

/** Host HTTP I/O. Fetch owns redirects, cookies, decoding, caching, and browser policy. */
export interface HTTPTransport {
  /** Start a request; callbacks may arrive before dispatch returns. */
  // HTTP/2 may replay buffered requests explicitly refused before processing.
  // Retrying status responses or consumed upload sources remains the caller's responsibility.
  dispatch(request: HTTPTransportRequest, listener: HTTPTransportListener): HTTPTransportControl;
  /** Shut down the owner, aborting outstanding exchanges and releasing its connections. */
  close(): Promise<void>;
}

/** Prepared wire inputs, with connection reuse restricted by Fetch's partition and credentials. */
export interface HTTPTransportRequest {
  /** Current HTTP(S) URL; fragments and URL credentials are not sent on the wire. */
  url: URLRecord;
  /** Already normalized HTTP method. */
  method: string;
  /** Ordered fields, including duplicates, prepared by HTTP-network-or-cache fetch. */
  headers: FetchHeaders;
  /** Bytes supplied directly by a host, or a demand-driven Fetch body. */
  body: Uint8Array | HTTPUploadSource | null;
  /** Network partition; null identifies browser requests without a client partition. */
  partitionKey: NetworkPartitionKey | null;
  /** Whether this exchange may use credential-bearing connections. */
  includeCredentials: boolean;
  /** Require a fresh connection instead of reusing an existing one. */
  forceNewConnection: boolean;
}

/** Native callbacks carry bytes and metadata; they must not enter a page's Streams directly. */
export interface HTTPTransportListener {
  /** Inspect the selected connection before sending anything; false refuses this exchange. */
  onConnection?(connection: HTTPConnection): boolean;
  /** Observe transmission of a body chunk. */
  onRequestBodyChunkLength?(length: number): void;
  /** Observe completion of the outgoing message. */
  onRequestEnd?(): void;
  /** Observe the HTTP parser's start of a response, before header completion. */
  onResponseStarted?(): void;
  /** Receive informational or final headers, preserving duplicate field values. */
  onHeaders(status: number, statusMessage: string, headers: FetchHeaders, hasValidTLS: boolean): void;
  /** Retainable bytes that the transport will not modify after delivery. */
  onData(bytes: Uint8Array): void;
  /** The message body ended successfully; buffered bytes still need to be consumed. */
  onEnd(): void;
  /** Connection, protocol, or cancellation failure; no more body bytes follow. */
  onError(error: unknown): void;
}

/** A Fetch-owned upload; each read is requested by the transport's write demand. */
export interface HTTPUploadSource {
  /** Obtain one byte chunk, or null at EOF, through the body's execution owner. */
  read(): PromiseValue<Uint8Array | null>;
  /** Stop reading when the exchange ends or is canceled. */
  cancel(): void;
}

/** Connection observations, without exposing native sockets or HTTP/2 sessions. */
export interface HTTPConnection extends Connection {
  /** Protocol actually negotiated for this connection. */
  protocol: 'http/1.1' | 'h2';
  /** Whether certificate and hostname verification succeeded. */
  hasValidTLS: boolean;
}

/** Function-based control, including cancellation before a socket has been assigned. */
export interface HTTPTransportControl {
  /** Stop body delivery until resumed; the current chunk can exceed the caller's buffer limit. */
  pause(): void;
  /** Permit body delivery again. */
  resume(): void;
  /** Stop this exchange without exposing the transport's native exception to page code. */
  abort(): void;
}
