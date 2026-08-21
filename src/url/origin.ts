import { serializeHost, type Domain, type Host } from './host';

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
  domain: Domain | null;
};

/*
 * New opaque origin.
 *
 * https://html.spec.whatwg.org/multipage/browsers.html#concept-origin-opaque
 */
export function createOpaqueOrigin(): OpaqueOrigin {
  return { kind: 'opaque', identity: Symbol('opaque origin') };
}

/*
 * Serialization of an origin.
 *
 * https://html.spec.whatwg.org/multipage/browsers.html#ascii-serialisation-of-an-origin
 */
export function serializeOrigin(origin: Origin): string {
  if (origin.kind === 'opaque') return 'null';

  let result = `${origin.scheme}://${serializeHost(origin.host)}`;
  if (origin.port !== null) result += `:${origin.port}`;
  return result;
}
