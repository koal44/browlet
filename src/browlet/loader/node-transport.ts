import { TLSSocket, type ConnectionOptions } from 'node:tls';
import { Client, buildConnector, errors, type Dispatcher } from 'undici';
import {
  FetchHeaders, networkPartitionKeysEqual, type HTTPTransport, type HTTPTransportControl,
  type HTTPTransportListener, type HTTPTransportRequest, type NetworkPartitionKey,
} from '../../fetch/index';
import { obtainURLOrigin, serializeOrigin, serializeURLPath } from '../../url/index';
import { InternalError } from '../../infra/internal-error';

/** Node HTTP I/O owned by one UserAgent; Fetch keeps all browser processing. */
export class NodeHTTPTransport implements HTTPTransport {
  /** Value-equal network partitions own disjoint origin/credential connection sets. */
  #partitions: TransportPartition[] = [];
  /** Includes replaced clients until their outstanding exchanges finish. */
  #clients = new Set<Client>();
  /** Optional host trust roots; certificate and hostname verification always remain enabled. */
  #ca: ConnectionOptions['ca'];
  #closed = false;

  constructor(ca?: ConnectionOptions['ca']) {
    this.#ca = ca;
  }

  dispatch(request: HTTPTransportRequest, listener: HTTPTransportListener): HTTPTransportControl {
    if (this.#closed) throw new InternalError('HTTP transport is closed');
    if (request.url.scheme !== 'http' && request.url.scheme !== 'https') {
      throw new InternalError('HTTP transport requires an HTTP(S) URL');
    }
    const connection = this.#obtainClient(request);
    let controller: Dispatcher.DispatchController | undefined;
    let paused = false;
    let aborted = false;
    let finished = false;
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
        body: request.body,
        // Fetch chooses retry policy; this adapter performs one exchange.
        idempotent: false,
      }, {
        onRequestStart(value) {
          controller = value;
          if (aborted) value.abort(new errors.RequestAbortedError());
          else if (paused) value.pause();
        },
        onResponseStart(value, status, _headers, statusMessage) {
          if (finished) return;
          const raw = value.rawHeaders;
          // This first adapter uses HTTP/1.1, whose dispatcher supplies ordered pairs.
          // TODO(Fetch 9B): add HTTP/2 with per-stream cancellation and connection observations.
          if (!Array.isArray(raw)) throw new InternalError('HTTP/1.1 response has no raw header list');
          const headers = new FetchHeaders();
          for (let index = 0; index < raw.length; index += 2) {
            const name = raw[index]!;
            const fieldValue = raw[index + 1]!;
            headers.list.push([
              typeof name === 'string' ? name : name.toString('latin1'),
              typeof fieldValue === 'string' ? fieldValue : fieldValue.toString('latin1'),
            ]);
          }
          receiver?.onHeaders(status, statusMessage ?? '', headers, connection.hasValidTLS);
        },
        onResponseData(_controller, bytes) { receiver?.onData(bytes); },
        onResponseEnd() {
          if (finished) return;
          finished = true;
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
    const origin = serializeOrigin(obtainURLOrigin(request.url));
    const clientKey = `${origin}\0${request.includeCredentials}`;
    const previous = partition.clients.get(clientKey);
    if (previous && !request.forceNewConnection) return previous;

    const connect = buildConnector({ ca: this.#ca, rejectUnauthorized: true, allowH2: false });
    const entry: TransportClient = {
      hasValidTLS: false,
      client: new Client(origin, {
        allowH2: false,
        connect(options, callback) {
          entry.hasValidTLS = false;
          connect(options, (error, socket) => {
            if (error) { callback(error, null); return; }
            entry.hasValidTLS = socket instanceof TLSSocket && socket.authorized;
            callback(null, socket);
          });
        },
      }),
    };
    partition.clients.set(clientKey, entry);
    this.#clients.add(entry.client);
    if (previous) {
      // Existing exchanges finish on their connection; subsequent ones use the fresh client.
      void previous.client.close(() => { this.#clients.delete(previous.client); });
    }
    return entry;
  }
}

type TransportPartition = {
  key: NetworkPartitionKey | null;
  clients: Map<string, TransportClient>;
};

type TransportClient = {
  client: Client;
  hasValidTLS: boolean;
};
