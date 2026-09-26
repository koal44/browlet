import { TLSSocket, type ConnectionOptions } from 'node:tls';
import { isIP, type LookupFunction, type Socket } from 'node:net';
import dns from 'node:dns';
import { nextTick } from 'node:process';
import { Client, buildConnector, errors, type Dispatcher } from 'undici';
import {
  ConnectionTimingInfo, FetchHeaders, networkPartitionKeysEqual,
  type FetchUserAgent, type HTTPConnection, type HTTPTransport, type HTTPTransportControl,
  type HTTPTransportListener, type HTTPTransportRequest, type HTTPUploadSource, type NetworkPartitionKey,
} from '../../fetch/index';
import { obtainURLOrigin, serializeOrigin, serializeURLPath } from '../../url/index';
import { InternalError } from '../../infra/internal-error';
import { utf8Encode } from '../../encoding/index';
import { unsafeSharedCurrentTime } from '../performance/high-resolution-time';

/** Node HTTP I/O owned by one UserAgent; Fetch keeps all browser processing. */
export class NodeHTTPTransport implements HTTPTransport {
  /** Value-equal network partitions own disjoint origin/credential connection sets. */
  #partitions: TransportPartition[] = [];
  /** Includes replaced clients until their outstanding exchanges finish. */
  #clients = new Set<Client>();
  /** Optional host trust roots; certificate and hostname verification always remain enabled. */
  #ca: ConnectionOptions['ca'];
  #userAgent: FetchUserAgent;
  #closed = false;

  constructor(userAgent: FetchUserAgent, ca?: ConnectionOptions['ca']) {
    this.#ca = ca;
    this.#userAgent = userAgent;
  }

  dispatch(request: HTTPTransportRequest, listener: HTTPTransportListener): HTTPTransportControl {
    if (this.#closed) throw new InternalError('HTTP transport is closed');
    if (request.url.scheme !== 'http' && request.url.scheme !== 'https') {
      throw new InternalError('HTTP transport requires an HTTP(S) URL');
    }
    const connection = this.#obtainClient(request);
    connection.active++;
    let controller: Dispatcher.DispatchController | undefined;
    let paused = false;
    let aborted = false;
    let finished = false;
    let responseStarted = false;
    let receiver: HTTPTransportListener | undefined = listener;
    const control: HTTPTransportControl = {
      pause() { paused = true; controller?.pause(); },
      resume() { paused = false; if (!finished) controller?.resume(); },
      abort() {
        if (finished || aborted) return;
        aborted = true;
        const error = new errors.RequestAbortedError();
        controller?.abort(error);
        // Queued requests have no controller yet; release their callbacks now.
        fail(error);
      },
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      connection.active--;
      const target = receiver;
      receiver = undefined;
      target?.onError(error);
    };
    try {
      connection.client.dispatch({
        // HTTP-network-or-cache fetch supplies the exact outgoing fields.
        path: serializeURLPath(request.url) + (request.url.query === null ? '' : `?${request.url.query}`),
        method: request.method,
        headers: request.headers,
        body: request.body === null || request.body instanceof Uint8Array
          ? request.body : upload(request.body),
        // Disable HTTP/1 pipelined replay. HTTP/2 can still retry a replayable
        // request that the peer explicitly refused before processing (RFC 9113 §8.7).
        idempotent: false,
      }, {
        onRequestStart(value) {
          controller = value;
          if (aborted) {
            value.abort(new errors.RequestAbortedError());
          } else {
            const info = connection.connection;
            if (!info) {
              throw new InternalError('HTTP request started without an established connection');
            }
            if (receiver?.onConnection?.(info) === false) control.abort();
            else if (paused) value.pause();
          }
        },
        onBodySent(bytes) { receiver?.onRequestBodyChunkLength?.(bytes.byteLength); },
        onRequestSent() { receiver?.onRequestEnd?.(); },
        onResponseStarted() { responseStarted = true; receiver?.onResponseStarted?.(); },
        onResponseStart(value, status, _headers, statusMessage) {
          if (finished) return;
          // Undici omits the start callback for HTTP/2 informational responses.
          // Node delivers decoded headers here, so this approximates first-byte
          // timing; Undici's final HTTP/2 response uses the same observation point.
          if (!responseStarted) receiver?.onResponseStarted?.();
          responseStarted = false;
          const raw = value.rawHeaders;
          if (!Array.isArray(raw)) throw new InternalError('HTTP response has no uncombined raw header list');
          const headers = new FetchHeaders();
          for (let index = 0; index < raw.length; index += 2) {
            const name = raw[index]!;
            const fieldValue = raw[index + 1]!;
            headers.list.push([
              typeof name === 'string' ? name : name.toString('latin1'),
              typeof fieldValue === 'string' ? fieldValue : fieldValue.toString('latin1'),
            ]);
          }
          receiver?.onHeaders(status, statusMessage ?? '', headers, connection.connection!.hasValidTLS);
        },
        onResponseData(_controller, bytes) { receiver?.onData(bytes); },
        onResponseEnd() {
          if (finished) return;
          finished = true;
          connection.active--;
          const target = receiver;
          receiver = undefined;
          target?.onEnd();
        },
        onResponseError(_controller, error) { fail(error); },
      });
    } catch (error) {
      fail(error);
    }
    return control;
  }

  close(): Promise<void> {
    this.#closed = true;
    // eslint-disable-next-line no-restricted-globals -- Host transport shutdown waits for native I/O; no page state or realm Promise is involved.
    return Promise.all([...this.#clients].map((client) => client.destroy())).then(() => {
      this.#clients.clear();
      this.#partitions = [];
    });
  }

  #obtainClient(request: HTTPTransportRequest): TransportClient {
    const key = request.partitionKey;
    let partition = this.#partitions.find((entry) => key === null
      ? entry.key === null : entry.key !== null && networkPartitionKeysEqual(entry.key, key));
    if (!partition) {
      partition = { key, clients: new Map() };
      this.#partitions.push(partition);
    }
    const urlOrigin = obtainURLOrigin(request.url);
    if (urlOrigin.kind !== 'tuple') throw new InternalError('HTTP transport requires a tuple origin');
    const origin = serializeOrigin(urlOrigin);
    const clientKey = `${origin}\0${request.includeCredentials}`;
    const previous = partition.clients.get(clientKey) ?? [];
    if (!request.forceNewConnection) {
      // Undici multiplexes h2 and queues excess streams against the peer's limit.
      const available = previous.find((entry) => entry.connection?.protocol === 'h2' || entry.active === 0);
      if (available) return available;
      if (previous.length >= maxConnectionsPerOrigin) {
        return previous.reduce((selected, entry) => entry.active < selected.active ? entry : selected);
      }
    }

    const connect = buildConnector({
      ca: this.#ca, rejectUnauthorized: true, allowH2: true, preferH2: true,
      lookup: lookupHost,
    });
    const pool = this.#userAgent.connectionPool;
    const entry: TransportClient = {
      active: 0,
      connection: undefined,
      client: new Client(origin, {
        allowH2: true,
        connect(options, callback) {
          const timingInfo = new ConnectionTimingInfo();
          timingInfo.domainLookupStartTime = timingInfo.connectionStartTime = unsafeSharedCurrentTime().milliseconds;
          // Literal addresses resolve immediately; Node emits no lookup event for them.
          if (isIP(options.hostname) !== 0) timingInfo.domainLookupEndTime = timingInfo.connectionStartTime;
          // Undici's connector returns its Socket; its declaration incorrectly says void.
          const socket = connect(options, (error, socket) => {
            if (error) { callback(error, null); return; }
            timingInfo.connectionEndTime = unsafeSharedCurrentTime().milliseconds;
            const protocol = socket instanceof TLSSocket && socket.alpnProtocol === 'h2' ? 'h2' : 'http/1.1';
            const connection: HTTPConnection = {
              key, origin: urlOrigin, credentials: request.includeCredentials,
              timingInfo, supportsUnreliable: false, protocol,
              hasValidTLS: socket instanceof TLSSocket && socket.authorized,
            };
            timingInfo.alpnNegotiatedProtocol = utf8Encode(
              socket instanceof TLSSocket ? socket.alpnProtocol || 'http/1.1' : 'http/1.1',
            );
            entry.connection = connection;
            pool.connections.add(connection);
            socket.once('close', () => { pool.connections.delete(connection); });
            callback(null, socket);
          }) as unknown as Socket;
          socket.once('lookup', () => {
            timingInfo.domainLookupEndTime = timingInfo.connectionStartTime = unsafeSharedCurrentTime().milliseconds;
          });
          if (options.protocol === 'https:') {
            socket.once('connect', () => { timingInfo.secureConnectionStartTime = unsafeSharedCurrentTime().milliseconds; });
          }
        },
      }),
    };
    partition.clients.set(clientKey, request.forceNewConnection ? [entry] : [...previous, entry]);
    this.#clients.add(entry.client);
    if (request.forceNewConnection) {
      // Existing exchanges finish on their connection; subsequent ones use the fresh client.
      for (const old of previous) void old.client.close(() => { this.#clients.delete(old.client); });
    }
    return entry;
  }
}

type TransportPartition = {
  key: NetworkPartitionKey | null;
  clients: Map<string, TransportClient[]>;
};

type TransportClient = {
  client: Client;
  active: number;
  connection: HTTPConnection | undefined;
};

/** Supply socket addresses, confining localhost names to loopback without DNS. */
// https://fetch.spec.whatwg.org/#resolve-an-origin
// Node bypasses lookup for IP literals; other hostnames are already normalized by URL parsing.
const lookupHost: LookupFunction = (hostname, options, callback) => {
  if (hostname !== 'localhost' && hostname !== 'localhost.' &&
    !hostname.endsWith('.localhost') && !hostname.endsWith('.localhost.')) {
    dns.lookup(hostname, options, callback);
    return;
  }

  // Match native lookup's asynchronous completion so the socket can install its listeners.
  nextTick(() => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
    const addresses = [
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ].filter((address) => !family || address.family === family);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** Native I/O awaits a neutral chunk; the source queues each read on its own HTML owner. */
// eslint-disable-next-line no-restricted-syntax -- This adapter feeds a Node stream; each source read enters its HTML owner separately.
async function* upload(source: HTTPUploadSource): AsyncGenerator<Uint8Array> {
  try {
    while (true) {
      // eslint-disable-next-line no-restricted-globals, no-restricted-syntax -- Native transport boundary; no page Promise or Stream escapes.
      const bytes = await new Promise<Uint8Array | null>((resolve, reject) => source.read().observe(resolve, reject));
      if (bytes === null) return;
      yield bytes;
    }
  } finally {
    source.cancel();
  }
}

const maxConnectionsPerOrigin = 6;
