import {
  arg, defineInterface, definePartialInterface, idlType, impl, op, reference, roAttr, sequence, xattr,
} from '../../../web-idl/core/index';
import { obtainURLOrigin, parseURL, serializeOrigin, type Origin } from '../../../url/index';

import type { DocumentImpl } from '../../dom/nodes/index';
import type { HTMLIFrameElementImpl } from '../../dom/nodes/html/embedded/index';
import type { BrowletEnvironment } from '../../environment';

import { PermissionsPolicy } from './permissions';

/** Script-visible inspection object associated with one Document or iframe. */
// https://w3c.github.io/webappsec-permissions-policy/#the-policy-object
export class PermissionsPolicyImpl {
  /** Node whose current origin and policy are inspected, including after iframe adoption. */
  associatedNode: DocumentImpl | HTMLIFrameElementImpl;
  /** Original owning environment for the inspection object's platform identity. */
  env: BrowletEnvironment;

  constructor(associatedNode: DocumentImpl | HTMLIFrameElementImpl, env: BrowletEnvironment) {
    this.associatedNode = associatedNode;
    this.env = env;
  }

  /** Current Document origin or iframe declared origin; never the loaded child's private state. */
  // https://w3c.github.io/webappsec-permissions-policy/#default-origin
  get defaultOrigin(): Origin {
    const node = this.associatedNode;
    return node.isDocument() ? node.origin : node.declaredOrigin;
  }

  /** Current Document policy or a fresh iframe policy derived solely from its embedding state. */
  // https://w3c.github.io/webappsec-permissions-policy/#observable-policy
  get observablePolicy(): PermissionsPolicy {
    const node = this.associatedNode;
    if (node.isDocument()) return node.permissionsPolicyState;
    return PermissionsPolicy.create(node, node.declaredOrigin);
  }

  /** Whether the observable policy permits a supported feature at the supplied or default origin. */
  // https://w3c.github.io/webappsec-permissions-policy/#dom-permissionspolicy-allowsfeature
  allowsFeature(name: string, origin?: string): boolean {
    const feature = PermissionsPolicy.getSupportedFeature(name);
    if (feature === undefined) return false;
    let targetOrigin: Origin | undefined;
    if (origin !== undefined) {
      // SPEC_GAP(permissions-policy-origin-argument): §7.2 omits string-to-origin conversion.
      // Follow Chromium: parse an absolute URL and reject invalid or opaque origins.
      const { url } = parseURL(origin);
      if (url === null) return false;
      targetOrigin = obtainURLOrigin(url);
      if (targetOrigin.kind === 'opaque') return false;
    }
    const defaultOrigin = this.defaultOrigin;
    return this.observablePolicy.check(feature, targetOrigin ?? defaultOrigin, defaultOrigin) === 'Enabled';
  }

  /** List supported features, including those a particular policy might disallow. */
  // https://w3c.github.io/webappsec-permissions-policy/#dom-permissionspolicy-features
  features(): string[] {
    return PermissionsPolicy.getSupportedFeatureNames();
  }

  /** List supported features permitted at the associated node's current default origin. */
  // https://w3c.github.io/webappsec-permissions-policy/#dom-permissionspolicy-allowedfeatures
  allowedFeatures(): string[] {
    const origin = this.defaultOrigin;
    const policy = this.observablePolicy;
    return PermissionsPolicy.getSupportedFeatureNames().filter((name) =>
      policy.check(PermissionsPolicy.getSupportedFeature(name)!, origin, origin) === 'Enabled',
    );
  }

  /** Inspect the observable allowlist for a feature permitted at the current default origin. */
  // https://w3c.github.io/webappsec-permissions-policy/#dom-permissionspolicy-getallowlistforfeature
  getAllowlistForFeature(name: string): string[] {
    const feature = PermissionsPolicy.getSupportedFeature(name);
    if (feature === undefined) return [];
    const origin = this.defaultOrigin;
    const policy = this.observablePolicy;
    // SPEC_CLASH(permissions-policy-allowlist-denied-origin): Keep §7.2's default-origin gate;
    // Chromium exposes declarations permitting only other origins despite this denial.
    if (policy.check(feature, origin, origin) === 'Disabled') return [];
    const allowlist = policy.declaredPolicy.declarations.get(feature);
    if (allowlist === undefined) {
      // SPEC_GAP(permissions-policy-allowlist-default): §7.2 assumes an explicit declaration.
      // Follow Chromium and Gecko's default-allowlist fallback when none exists.
      // SPEC_CLASH(permissions-policy-iframe-allowlist): Keep the draft's empty iframe
      // declarations and feature defaults, not Gecko's container allowlist.
      // SPEC_CLASH(permissions-policy-allowlist-opaque): Serialize opaque self as "null";
      // Chromium instead omits it, while Gecko exposes an internal principal string.
      return feature.defaultAllowlist === '*' ? ['*'] : [serializeOrigin(origin)];
    }
    if (allowlist.matchesAllOrigins) return ['*'];
    const result: string[] = [];
    if (allowlist.selfOrigin !== null) result.push(serializeOrigin(allowlist.selfOrigin));
    if (allowlist.srcOrigin !== null) result.push(serializeOrigin(allowlist.srcOrigin));
    else result.push(...allowlist.expressions);
    return result;
  }
}

/*
 * [Exposed=Window]
 * interface PermissionsPolicy {
 *   boolean allowsFeature(DOMString feature, optional DOMString origin);
 *   sequence<DOMString> features();
 *   sequence<DOMString> allowedFeatures();
 *   sequence<DOMString> getAllowlistForFeature(DOMString feature);
 * };
 */
export const permissionsPolicyIDL = defineInterface({
  name: 'PermissionsPolicy',
  exposed: 'Window',
  implementation: impl(PermissionsPolicyImpl),
  members: [
    op('allowsFeature', idlType.boolean, [arg('feature', idlType.DOMString), arg('origin', idlType.DOMString, { optional: true })]),
    op('features', sequence(idlType.DOMString)),
    op('allowedFeatures', sequence(idlType.DOMString)),
    op('getAllowlistForFeature', sequence(idlType.DOMString), [arg('feature', idlType.DOMString)]),
  ],
});

/*
 * partial interface Document {
 *   [SameObject] readonly attribute PermissionsPolicy permissionsPolicy;
 * };
 */
export const documentPermissionsPolicyIDL = definePartialInterface({
  name: 'Document',
  members: [
    roAttr('permissionsPolicy', reference('PermissionsPolicy'), xattr('SameObject')),
  ],
});

/*
 * partial interface HTMLIFrameElement {
 *   [SameObject] readonly attribute PermissionsPolicy permissionsPolicy;
 * };
 */
export const iframePermissionsPolicyIDL = definePartialInterface({
  name: 'HTMLIFrameElement',
  members: [
    roAttr('permissionsPolicy', reference('PermissionsPolicy'), xattr('SameObject')),
  ],
});
