import type { InternalPromise } from '../infra/promises';
import { sitesAreSameSite, type Origin, type Site, type URLRecord } from '../url/index';
import type { FetchHeaders } from './headers';
import type { ConnectionTimingInfo } from './timing';

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------

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
  read(): InternalPromise<Uint8Array | null>;
  /** Stop reading when the exchange ends or is canceled. */
  cancel(): void;
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

// -----------------------------------------------------------------------------
// Connections and partitioning
// -----------------------------------------------------------------------------

/** Live connection records retained by one user agent. */
// https://fetch.spec.whatwg.org/#concept-connection-pool
export class ConnectionPool {
  /** Connections retained for reuse within this user agent, separated by partition and origin. */
  connections = new Set<Connection>();

  // UNUSED: retained for reference; NodeHTTPTransport now owns connection acquisition.
  // https://fetch.spec.whatwg.org/#concept-connection-obtain
  // obtain(
  //   key: NetworkPartitionKey, url: URLRecord, credentials: boolean,
  //   // https://fetch.spec.whatwg.org/#new-connection-setting
  //   newConnection: 'no' | 'yes' | 'yes-and-dedicated' = 'no',
  //   requireUnreliable = false,
  //   webTransportHashes: WebTransportHash[] = [],
  // ): Connection | null {
  //   if (newConnection === 'no') {
  //     if (webTransportHashes.length !== 0) throw new InternalError('Certificate hashes require a new connection');
  //     const origin = obtainURLOrigin(url);
  //     for (const connection of this.connections) {
  //       if (connection.key !== null && networkPartitionKeysEqual(connection.key, key) && areSameOrigin(connection.origin, origin) &&
  //         connection.credentials === credentials && (!requireUnreliable || connection.supportsUnreliable)) {
  //         return connection;
  //       }
  //     }
  //   }

  //   // Proxy selection, establishment, and timing observations belong to the transport.
  //   throw new InternalError('New connection establishment is not implemented');
  // }
}

/** A connection's partition, origin, credentials, and timing observations. */
// https://fetch.spec.whatwg.org/#concept-connection
export type Connection = {
  /** Network partition permitted to reuse this connection; null for browser work without a client partition. */
  key: NetworkPartitionKey | null;
  /** Origin served by this connection. */
  origin: Origin;
  /** Whether the connection permits credentials, including TLS client certificates. */
  credentials: boolean;
  /** DNS, connection, and TLS timing observations. */
  timingInfo: ConnectionTimingInfo;
  /** Whether the connection supports unreliable data transfer required by some transports. */
  supportsUnreliable: boolean;
};

/** Connection observations, without exposing native sockets or HTTP/2 sessions. */
export interface HTTPConnection extends Connection {
  /** Protocol actually negotiated for this connection. */
  protocol: 'http/1.1' | 'h2';
  /** Whether certificate and hostname verification succeeded. */
  hasValidTLS: boolean;
}

/** The top-level site and an unused second key; only the site affects equality. */
// https://fetch.spec.whatwg.org/#network-partition-key
export type NetworkPartitionKey = [topLevelSite: Site, secondKey: null];

/** Compare tuple values, preserving opaque-site identity. */
export function networkPartitionKeysEqual(a: NetworkPartitionKey, b: NetworkPartitionKey): boolean {
  return sitesAreSameSite(a[0], b[0]);
}

// -----------------------------------------------------------------------------
// Content decoding
// -----------------------------------------------------------------------------

/** A single response's native decoder chain. Fetch owns coding selection and byte accounting. */
export interface HTTPContentDecoder {
  /** Supply encoded bytes; false suspends input until the drain notification. */
  write(bytes: Uint8Array): boolean;
  /** Finish input and validate the decoder's final state. */
  end(): void;
  /** Suspend decoded output while Fetch's byte buffer is full. */
  pause(): void;
  /** Resume decoded output when the consumer creates room. */
  resume(): void;
  /** Release decoder state without reporting another failure. */
  abort(): void;
}

/** Decoder notifications carry neutral bytes; page Stream mutations stay in Fetch tasks. */
export interface HTTPContentDecoderListener {
  onData(bytes: Uint8Array): void;
  onEnd(): void;
  onError(): void;
  onDrain(): void;
}
