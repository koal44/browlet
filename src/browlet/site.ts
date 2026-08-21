import { obtainRegistrableDomain, type Host } from '../url/host';
import type { OpaqueOrigin, Origin } from '../url/origin';

export type Site = OpaqueOrigin | SchemeAndHost;

export type SchemeAndHost = {
  kind: 'scheme-and-host';
  scheme: string;
  host: Host;
};

export function obtainSite(origin: Origin): Site {
  if (origin.kind === 'opaque') {
    return origin;
  }

  return {
    kind: 'scheme-and-host',
    scheme: origin.scheme,
    host: obtainRegistrableDomain(origin.host) ?? origin.host,
  };
}

export function isOrigin(value: Origin | Site): value is Origin {
  return value.kind !== 'scheme-and-host';
}
