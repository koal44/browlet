import { obtainPublicSuffix, type IPAddress } from '../../url/host';
import { areSameOrigin, type Origin, type TupleOrigin } from '../../url/origin';
import { obtainURLOrigin, type URLRecord } from '../../url/url';
import type { WebTransportHash } from '../request';
import type { ConnectionTimingInfo } from '../timing';
import { networkPartitionKeysEqual, type NetworkPartitionKey } from './network-partition';
import { InternalError } from '../../infra/internal-error';

/** https://fetch.spec.whatwg.org/#concept-connection-pool */
export class ConnectionPool {
  /** Connections retained for reuse within this user agent, separated by partition and origin. */
  connections = new Set<Connection>();

  /** https://fetch.spec.whatwg.org/#concept-connection-obtain */
  obtain(
    key: NetworkPartitionKey, url: URLRecord, credentials: boolean,
    newConnection: NewConnectionSetting = 'no', requireUnreliable = false,
    webTransportHashes: WebTransportHash[] = [],
  ): Connection | null {
    if (newConnection === 'no') {
      if (webTransportHashes.length !== 0) throw new InternalError('Certificate hashes require a new connection');
      const origin = obtainURLOrigin(url);
      for (const connection of this.connections) {
        if (networkPartitionKeysEqual(connection.key, key) && areSameOrigin(connection.origin, origin) &&
          connection.credentials === credentials && (!requireUnreliable || connection.supportsUnreliable)) {
          return connection;
        }
      }
    }

    // Proxy selection, establishment, and timing observations belong to the transport.
    throw new InternalError('New connection establishment is not implemented');
  }
}

/** https://fetch.spec.whatwg.org/#concept-connection */
export type Connection = {
  /** Network partition permitted to reuse this connection. */
  key: NetworkPartitionKey;
  /** Origin served by this connection. */
  origin: Origin;
  /** Whether the connection permits credentials, including TLS client certificates. */
  credentials: boolean;
  /** DNS, connection, and TLS timing observations. */
  timingInfo: ConnectionTimingInfo;
  /** Whether the connection supports unreliable data transfer required by some transports. */
  supportsUnreliable: boolean;
};

/** https://fetch.spec.whatwg.org/#new-connection-setting */
export type NewConnectionSetting = 'no' | 'yes' | 'yes-and-dedicated';

/** https://fetch.spec.whatwg.org/#resolve-an-origin */
// SPEC_MISMATCH: (network partition key, origin) -> IP address set or failure
export function resolveOrigin(_key: NetworkPartitionKey, origin: TupleOrigin): IPAddress[] | null {
  const host = origin.host;
  if (host.kind === 'ipv4' || host.kind === 'ipv6') return [host];

  const publicSuffix = obtainPublicSuffix(host)?.value;
  if (publicSuffix === 'localhost' || publicSuffix === 'localhost.') {
    return [
      { kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] },
      { kind: 'ipv4', value: 0x7f000001 },
    ];
  }

  // The transport supplies external resolution and any partitioned DNS cache.
  throw new InternalError('External origin resolution is not implemented');
}
