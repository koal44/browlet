import { hasExtendedAttribute, type ExtendedAttribute, type Exposed } from '../core/index';

import type { WebIDLRealm } from '../environment';

// https://webidl.spec.whatwg.org/#dfn-exposed
// https://webidl.spec.whatwg.org/#dfn-conditionally-exposed
export function matchesExposure(construct: Exposable, realm: WebIDLRealm): boolean {
  const exposed = construct.exposed;
  if (
    exposed !== undefined && exposed !== '*' &&
    !(typeof exposed === 'string'
      ? realm.globalNames.has(exposed)
      : exposed.some((name) => realm.globalNames.has(name)))
  ) return false;
  if (hasExtendedAttribute(construct.extendedAttributes, 'CrossOriginIsolated') && !realm.crossOriginIsolated) return false;
  if (hasExtendedAttribute(construct.extendedAttributes, 'SecureContext') && !realm.secureContext) return false;
  return true;
}

type Exposable = {
  exposed?: Exposed;
  extendedAttributes?: ExtendedAttribute[];
};
