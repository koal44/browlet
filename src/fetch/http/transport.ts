import type { URLRecord } from '../../url/index';
import type { FetchHeaders } from '../headers';
import type { NetworkPartitionKey } from './network-partition';

/** Host HTTP I/O. Fetch owns redirects, cookies, decoding, caching, and browser policy. */
export interface HTTPTransport {
  /** Start one exchange; callbacks may arrive before dispatch returns. */
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
  /** Available upload bytes; streaming upload sources are added in Fetch 9B. */
  body: Uint8Array | null;
  /** Network partition; null identifies browser requests without a client partition. */
  partitionKey: NetworkPartitionKey | null;
  /** Whether this exchange may use credential-bearing connections. */
  includeCredentials: boolean;
  /** Require a fresh connection instead of reusing an existing one. */
  forceNewConnection: boolean;
}

/** Native callbacks carry bytes and metadata; they must not enter a page's Streams directly. */
export interface HTTPTransportListener {
  /** Receive informational or final headers, preserving duplicate field values. */
  onHeaders(status: number, statusMessage: string, headers: FetchHeaders, hasValidTLS: boolean): void;
  /** Retainable bytes that the transport will not modify after delivery. */
  onData(bytes: Uint8Array): void;
  /** The message body ended successfully; buffered bytes still need to be consumed. */
  onEnd(): void;
  /** Connection, protocol, or cancellation failure; no more body bytes follow. */
  onError(error: unknown): void;
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
