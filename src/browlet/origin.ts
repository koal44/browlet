import { type AssembledInterface } from '../web-idl/assembly';
import { type JavaScriptBinding } from '../web-idl/binding';
import {
  defineInterface, idlType, reference,
} from '../web-idl/definition';
import { registerInterfaceImplementation } from '../web-idl/implementation';
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
export const originIDL = defineInterface({
  exposed: '*',
  members: [
    { arguments: [], kind: 'constructor' },
    {
      arguments: [{ name: 'value', type: idlType.any }],
      kind: 'operation',
      name: 'from',
      returns: reference('Origin'),
      static: true,
    },
    {
      kind: 'attribute', name: 'opaque', readonly: true,
      type: idlType.boolean,
    },
    {
      arguments: [{ name: 'other', type: reference('Origin') }],
      kind: 'operation', name: 'isSameOrigin', returns: idlType.boolean,
    },
    {
      arguments: [{ name: 'other', type: reference('Origin') }],
      kind: 'operation', name: 'isSameSite', returns: idlType.boolean,
    },
  ],
  name: 'Origin',
});

// -----------------------------------------------------------------------------
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

  static extractOrigin(value: OriginImpl): Origin {
    return value.#origin;
  }

  static setOrigin(value: OriginImpl, origin: Origin): void {
    value.#origin = origin;
  }
}

export function registerOriginImplementation(
  binding: JavaScriptBinding,
): void {
  const interface_ = requireOriginInterface(binding);

  registerInterfaceImplementation(
    binding.implementations,
    interface_,
    OriginImpl,
    {
      construct() {},
      create: {},
      operations: {
        static: {
          from: (value) => createOriginFrom(value, binding, interface_),
        },
      },
    },
  );
}

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

function createOriginFrom(
  value: unknown,
  binding: JavaScriptBinding,
  interface_: AssembledInterface,
): OriginImpl {
  let origin = extractOrigin(value, binding);

  if (origin === null && typeof value === 'string') {
    const url = parseURL(value).url;
    if (url !== null) origin = obtainURLOrigin(url);
  }
  if (origin === null) throw new TypeError('Value has no origin');

  const object = binding.createPlatformObject(interface_);
  const implementation = binding.platformObjects.getImplementationObject(
    object,
  ) as OriginImpl | undefined;
  if (!implementation) throw new Error('Origin object has no implementation');
  OriginImpl.setOrigin(implementation, origin);
  return implementation;
}

function extractOrigin(
  value: unknown,
  binding: JavaScriptBinding,
): Origin | null {
  const record = binding.getPlatformObjectRecord(value);
  if (!record) return null;

  switch (record.primaryInterface.definition.name) {
    case 'Origin':
      return OriginImpl.extractOrigin(record.implementation as OriginImpl);
    case 'URL':
      return URLImpl.extractOrigin(record.implementation as URLImpl);
    default:
      return null;
  }
}

function requireOriginInterface(
  binding: JavaScriptBinding,
): AssembledInterface {
  const interface_ = binding.definitions.getInterface('Origin');
  if (!interface_) throw new Error('Missing Origin interface');
  return interface_;
}
