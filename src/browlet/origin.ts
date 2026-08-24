import {
  arg, ctor, defineInterface, idlType, op, readonlyAttr, reference,
} from '../web-idl/declaration/index';
import { bind } from '../web-idl/index';
import {
  hostsEqual, obtainPublicSuffix, obtainRegistrableDomain, parseHost,
  serializeHost, type Host,
} from '../url/host';
import {
  createOpaqueOrigin, serializeOrigin, type OpaqueOrigin, type Origin,
} from '../url/origin';
import { URLImpl } from '../url/api';
import { obtainURLOrigin, parseURL } from '../url/url';

/*
 * [Exposed=*]
 * interface Origin {
 *   constructor();
 *
 *   static Origin from(any value);
 *
 *   readonly attribute boolean opaque;
 *
 *   boolean isSameOrigin(Origin other);
 *   boolean isSameSite(Origin other);
 * };
 */
export class OriginImpl {
  #origin: Origin = createOpaqueOrigin();

  get opaque(): boolean {
    return this.#origin.kind === 'opaque';
  }

  isSameOrigin(other: OriginImpl): boolean {
    return areSameOrigin(this.#origin, other.#origin);
  }

  isSameSite(other: OriginImpl): boolean {
    return areSameSite(this.#origin, other.#origin);
  }

  // -- Friends ----------------------------------------------------------

  static extractOrigin(value?: OriginImpl): Origin | undefined {
    return value && value.#origin;
  }

  static setOrigin(value: OriginImpl, origin: Origin): void {
    value.#origin = origin;
  }
}

// -- Web IDL ------------------------------------------------------------

export const originIDL = defineInterface({
  binding: bind(OriginImpl),
  exposed: '*',
  members: [
    ctor(bind({ invoke() {} })),
    op('from', reference('Origin'), [arg('value', idlType.any)], bind({
      invoke(context, value) {
        let origin = OriginImpl.extractOrigin(
          context.objects.getImplementation(value, OriginImpl),
        ) ?? URLImpl.extractOrigin(
          context.objects.getImplementation(value, URLImpl),
        );

        if (origin === undefined && typeof value === 'string') {
          const url = parseURL(value).url;
          if (url !== null) origin = obtainURLOrigin(url);
        }
        if (origin === undefined) throw new TypeError('Value has no origin');

        const implementation = context.objects.create(OriginImpl);
        OriginImpl.setOrigin(implementation, origin);
        return implementation;
      },
    }, {
      static: true,
    })),
    readonlyAttr('opaque', idlType.boolean),
    op('isSameOrigin', idlType.boolean, [
      arg('other', reference('Origin')),
    ]),
    op('isSameSite', idlType.boolean, [
      arg('other', reference('Origin')),
    ]),
  ],
  name: 'Origin',
});

export type SchemeAndHost = [scheme: string, host: Host];

export type Site = OpaqueOrigin | SchemeAndHost;

export function effectiveDomain(origin: Origin): Host | null {
  if (origin.kind === 'opaque') return null;
  return origin.domain ?? origin.host;
}

export { serializeOrigin };

export function areSameOrigin(a: Origin, b: Origin): boolean {
  if (a.kind === 'opaque' || b.kind === 'opaque') {
    return a.kind === 'opaque' && b.kind === 'opaque' &&
      a.identity === b.identity;
  }

  return a.scheme === b.scheme &&
    hostsEqual(a.host, b.host) &&
    a.port === b.port;
}

export function areSameOriginDomain(a: Origin, b: Origin): boolean {
  if (a.kind === 'opaque' || b.kind === 'opaque') {
    return a.kind === 'opaque' && b.kind === 'opaque' &&
      a.identity === b.identity;
  }

  if (
    a.scheme === b.scheme &&
    a.domain !== null &&
    b.domain !== null &&
    hostsEqual(a.domain, b.domain)
  ) {
    return true;
  }

  return a.domain === null && b.domain === null && areSameOrigin(a, b);
}

export function isRegistrableDomainSuffixOfOrEqualTo(
  hostSuffixString: string,
  originalHost: Host,
): boolean {
  if (hostSuffixString === '') return false;

  const hostSuffix = parseHost(hostSuffixString).host;
  if (hostSuffix === null) return false;
  if (hostsEqual(hostSuffix, originalHost)) return true;
  if (hostSuffix.kind !== 'domain' || originalHost.kind !== 'domain') {
    return false;
  }
  if (!originalHost.value.endsWith(`.${hostSuffix.value}`)) return false;

  const hostSuffixPublicSuffix = obtainPublicSuffix(hostSuffix);
  if (
    hostSuffixPublicSuffix !== null &&
    hostsEqual(hostSuffix, hostSuffixPublicSuffix)
  ) {
    return false;
  }

  const originalHostPublicSuffix = obtainPublicSuffix(originalHost);
  return originalHostPublicSuffix !== null &&
    hostSuffix.value.endsWith(`.${originalHostPublicSuffix.value}`);
}

export function obtainSite(origin: Origin): Site {
  if (origin.kind === 'opaque') return origin;
  return [
    origin.scheme,
    obtainRegistrableDomain(origin.host) ?? origin.host,
  ];
}

export function sitesAreSameSite(a: Site, b: Site): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return !Array.isArray(a) && !Array.isArray(b) &&
      a.identity === b.identity;
  }

  return a[0] === b[0] && hostsEqual(a[1], b[1]);
}

export function serializeSite(site: Site): string {
  if (!Array.isArray(site)) return 'null';
  return `${site[0]}://${serializeHost(site[1])}`;
}

export function areSchemelesslySameSite(a: Origin, b: Origin): boolean {
  if (a.kind === 'opaque' || b.kind === 'opaque') {
    return a.kind === 'opaque' && b.kind === 'opaque' &&
      a.identity === b.identity;
  }

  const hostA = a.host;
  const hostB = b.host;
  const registrableDomainA = obtainRegistrableDomain(hostA);
  const registrableDomainB = obtainRegistrableDomain(hostB);

  if (
    hostsEqual(hostA, hostB) &&
    registrableDomainA === null &&
    registrableDomainB === null
  ) {
    return true;
  }

  return registrableDomainA !== null &&
    registrableDomainB !== null &&
    hostsEqual(registrableDomainA, registrableDomainB);
}

export function areSameSite(a: Origin, b: Origin): boolean {
  return sitesAreSameSite(obtainSite(a), obtainSite(b));
}

export function isOrigin(value: Origin | Site): value is Origin {
  return !Array.isArray(value);
}
