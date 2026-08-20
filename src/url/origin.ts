import type { Host } from './host';

/*
 * Origins are defined by HTML, while the URL Standard defines how a URL's
 * origin is obtained. The low-level representation lives with URL because its
 * tuple is composed of URL scheme, host, and port values and is shared by
 * higher-level hosts.
 */
export type Origin = OpaqueOrigin | TupleOrigin;

export type OpaqueOrigin = {
  kind: 'opaque';
  identity: symbol;
};

export type TupleOrigin = {
  kind: 'tuple';
  scheme: string;
  host: Host;
  port: number | null;
  domain: Host | null;
};
