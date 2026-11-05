import { asciiLower, asciiWhitespaceRunPattern } from '../../../../infra/index';
import { areSameOrigin, areSameOriginDomain, obtainURLOrigin, parseURL, serializeOrigin, type Origin } from '../../../../url/index';
import type { StructuredDictionary } from '../../../../http/index';
import type { FetchResponse } from '../../../../fetch/index';

import { isSchemeOrHostSourceExpression, urlMatchesSourceExpression } from '../csp/index';
import type { ElementImpl } from '../../../dom/nodes/index';

/** Internal policy state, separate from the public PermissionsPolicy inspection interface. */
// https://w3c.github.io/webappsec-permissions-policy/#permissions-policy
export class PermissionsPolicy {
  /** Feature availability inherited when the document is created. */
  inheritedPolicy = new Map<PolicyControlledFeature, PolicyFeatureValue>();
  /** Declarations and reporting destinations supplied by this document's response. */
  declaredPolicy = new DeclaredPermissionsPolicy();

  /** Create an empty policy with an Enabled inherited entry for each supported feature. */
  // https://w3c.github.io/webappsec-permissions-policy/#empty-permissions-policy
  constructor() {
    for (const feature of supportedPolicyFeatures.values()) this.inheritedPolicy.set(feature, 'Enabled');
  }

  /** Look up a supported feature without exposing the mutable catalog. */
  static getSupportedFeature(name: string): PolicyControlledFeature | undefined {
    return supportedPolicyFeatures.get(name);
  }

  /** List supported feature names in catalog order, independently of a Document's restrictions. */
  static getSupportedFeatureNames(): string[] {
    return [...supportedPolicyFeatures.keys()];
  }

  /** List supported feature definitions in catalog order without exposing the mutable catalog. */
  static getSupportedFeatures(): PolicyControlledFeature[] {
    return [...supportedPolicyFeatures.values()];
  }

  /** Parse an allow attribute using its container origin and optional declared target origin. */
  // https://w3c.github.io/webappsec-permissions-policy/#algo-parse-policy-directive
  static parseDirective(
    value: string, containerOrigin: Origin, targetOrigin?: Origin,
  ): PermissionsPolicyDirective {
    const directive: PermissionsPolicyDirective = new Map();
    for (const declaration of value.split(';')) {
      const [featureName, ...targets] = declaration.split(asciiWhitespaceRunPattern).filter(Boolean);
      if (featureName === undefined) continue;
      const feature = supportedPolicyFeatures.get(featureName);
      if (feature === undefined || directive.has(feature)) continue;

      const allowlist = new PermissionsPolicyAllowlist();
      allowlist.matchesAllOrigins = targets.includes('*');
      if (!allowlist.matchesAllOrigins) {
        if (targets.length === 0 && targetOrigin !== undefined) allowlist.srcOrigin = targetOrigin;
        for (const target of targets) {
          const keyword = asciiLower(target);
          if (keyword === "'self'") {
            allowlist.selfOrigin = containerOrigin;
            continue;
          }
          if (keyword === "'src'" && targetOrigin !== undefined) {
            allowlist.srcOrigin = targetOrigin;
            continue;
          }
          // SPEC_CLASH(permissions-policy-attribute-ascii): Follow the draft's URL parser;
          // Chromium's allowlist parser rejects non-ASCII input before URL parsing.
          const { url } = parseURL(target);
          if (url === null || url.scheme === 'blob' || url.username !== '' || url.password !== '') continue;
          const origin = obtainURLOrigin(url);
          if (origin.kind !== 'opaque') allowlist.expressions.add(serializeOrigin(origin));
        }
      }
      directive.set(feature, allowlist);
    }
    return directive;
  }

  /** Capture inherited availability for a destination origin, with no response declarations yet. */
  // https://w3c.github.io/webappsec-permissions-policy/#create-for-navigable
  static create(container: ElementImpl | null, origin: Origin): PermissionsPolicy {
    const policy = new PermissionsPolicy();
    for (const feature of policy.inheritedPolicy.keys()) {
      policy.inheritedPolicy.set(feature, this.getInheritedValue(feature, container, origin));
    }
    return policy;
  }

  /** Combine enforced inheritance with the selected response declarations and reporting endpoints. */
  // https://w3c.github.io/webappsec-permissions-policy/#create-from-response
  static fromResponse(
    container: ElementImpl | null, origin: Origin, response: FetchResponse, reportOnly = false,
  ): PermissionsPolicy {
    const policy = this.create(container, origin);
    const declared = DeclaredPermissionsPolicy.fromResponse(response, origin, reportOnly);
    // SPEC_CLASH(permissions-policy-response-record): §9.6 tests boolean true and indexes
    // reporting configuration through a feature; use §4.2's Enabled value and record shape.
    for (const [feature, allowlist] of declared.declarations) {
      if (policy.inheritedPolicy.get(feature) === 'Enabled') {
        policy.declaredPolicy.declarations.set(feature, allowlist);
      }
    }
    policy.declaredPolicy.reportingConfiguration = declared.reportingConfiguration;
    return policy;
  }

  /** Derive one feature's inherited value from the embedding Document and current container attributes. */
  // https://w3c.github.io/webappsec-permissions-policy/#define-inherited-policy-in-container
  static getInheritedValue(
    feature: PolicyControlledFeature, container: ElementImpl | null, origin: Origin, reportOnly = false,
  ): PolicyFeatureValue {
    if (container === null) return 'Enabled';
    const document = container.nodeDocument;
    if (document.getPolicyFeatureValue(feature, document.origin, reportOnly) === 'Disabled' ||
      document.getPolicyFeatureValue(feature, origin, reportOnly) === 'Disabled') return 'Disabled';

    const allowlist = container.processPolicyAttributes().get(feature);
    if (allowlist !== undefined) return allowlist.matches(origin) ? 'Enabled' : 'Disabled';
    if (feature.defaultAllowlist === '*' || areSameOrigin(origin, document.origin)) return 'Enabled';
    return 'Disabled';
  }

  /** Check inherited restrictions, explicit declarations, then the feature's default allowlist. */
  // https://w3c.github.io/webappsec-permissions-policy/#check-permissions-policy
  check(feature: PolicyControlledFeature, origin: Origin, documentOrigin: Origin): PolicyFeatureValue {
    if (this.inheritedPolicy.get(feature) === 'Disabled') return 'Disabled';
    const allowlist = this.declaredPolicy.declarations.get(feature);
    if (allowlist !== undefined) return allowlist.matches(origin) ? 'Enabled' : 'Disabled';
    if (feature.defaultAllowlist === '*' || areSameOrigin(origin, documentOrigin)) return 'Enabled';
    return 'Disabled';
  }

  /** Return the declared endpoint name for a feature, or null for local-only reporting. */
  // https://w3c.github.io/webappsec-permissions-policy/#get-reporting-endpoint
  getReportingEndpoint(feature: PolicyControlledFeature): string | null {
    return this.declaredPolicy.reportingConfiguration.get(feature) ?? null;
  }
}

/** Whether a feature is enabled by an inherited policy or policy check. */
export type PolicyFeatureValue = 'Enabled' | 'Disabled';

/** One recognized feature and the default allowlist supplied by its defining specification. */
// https://w3c.github.io/webappsec-permissions-policy/#policy-controlled-feature
export type PolicyControlledFeature = {
  name: string;
  defaultAllowlist: '*' | 'self';
};

/** Ordered feature allowlists supplied by a policy directive. */
// https://w3c.github.io/webappsec-permissions-policy/#policy-directive
export type PermissionsPolicyDirective = Map<PolicyControlledFeature, PermissionsPolicyAllowlist>;

/** Response declarations and their optional reporting endpoint names. */
// https://w3c.github.io/webappsec-permissions-policy/#declared-policy
export class DeclaredPermissionsPolicy {
  /** Explicit response allowlists, keyed by supported feature definitions. */
  declarations: PermissionsPolicyDirective = new Map();
  /** Reporting endpoint names, resolved by Reporting when a violation occurs. */
  reportingConfiguration = new Map<PolicyControlledFeature, string>();

  /** Parse one disposition's response header without applying it to a Document. */
  // https://w3c.github.io/webappsec-permissions-policy/#process-response-policy
  static fromResponse(response: FetchResponse, origin: Origin, reportOnly: boolean): DeclaredPermissionsPolicy {
    const name = reportOnly ? 'Permissions-Policy-Report-Only' : 'Permissions-Policy';
    const dictionary = response.headerList.getStructuredFieldValue(name, 'dictionary');
    // SPEC_CLASH(permissions-policy-empty-response): §9.1 returns a map for absent/invalid
    // headers, but its declared-policy result requires both maps; return an empty record.
    return dictionary === null ? new DeclaredPermissionsPolicy() : this.fromDictionary(dictionary.members, origin);
  }

  /** Interpret supported directives and their reporting parameters from a parsed dictionary. */
  // https://w3c.github.io/webappsec-permissions-policy/#construct-policy
  static fromDictionary(dictionary: StructuredDictionary['members'], origin: Origin): DeclaredPermissionsPolicy {
    const policy = new DeclaredPermissionsPolicy();
    for (const [name, member] of dictionary) {
      const feature = supportedPolicyFeatures.get(name);
      if (feature === undefined) continue;

      const isList = member.type === 'inner-list';
      const items = isList ? member.items : [member];
      const allowlist = new PermissionsPolicyAllowlist();
      allowlist.matchesAllOrigins = items.some(({ bareItem }) => bareItem.type === 'token' && bareItem.value === '*');
      if (!allowlist.matchesAllOrigins) {
        let valid = isList;
        for (const { bareItem } of items) {
          if (bareItem.type === 'token' && bareItem.value === 'self') {
            allowlist.selfOrigin = origin;
            valid = true;
          } else if (bareItem.type === 'string' && isSchemeOrHostSourceExpression(bareItem.value)) {
            allowlist.expressions.add(bareItem.value);
            valid = true;
          }
        }
        // SPEC_CLASH(permissions-policy-header-values): §5.2 accepts single source strings
        // and discards invalid members; §9.2 omits those rules. Follow §5.2 here.
        if (!valid) continue;
      }
      policy.declarations.set(feature, allowlist);
      const endpoint = member.parameters.get('report-to');
      if (endpoint?.type === 'token') policy.reportingConfiguration.set(feature, endpoint.value);
    }
    return policy;
  }
}

/** A parsed origin allowlist, including the policy wildcard. */
// https://w3c.github.io/webappsec-permissions-policy/#allowlist
export class PermissionsPolicyAllowlist {
  /** Represents the special * value, which also permits opaque origins. */
  matchesAllOrigins = false;
  /** Parsed scheme/host expressions; self/src keywords are stored as origins below. */
  expressions = new Set<string>();
  /** Origin captured when parsing the self keyword. */
  selfOrigin: Origin | null = null;
  /** Origin captured when parsing the src keyword. */
  srcOrigin: Origin | null = null;

  /** Whether this allowlist permits an origin, including captured opaque origins. */
  // https://w3c.github.io/webappsec-permissions-policy/#matches
  matches(origin: Origin): boolean {
    if (this.matchesAllOrigins) return true;
    if (this.selfOrigin !== null && areSameOriginDomain(this.selfOrigin, origin)) return true;
    if (this.srcOrigin !== null && areSameOriginDomain(this.srcOrigin, origin)) return true;
    if (origin.kind === 'opaque') return false;

    const url = parseURL(serializeOrigin(origin)).url!;
    for (const expression of this.expressions) {
      if (urlMatchesSourceExpression(url, expression, origin, 0)) return true;
    }
    return false;
  }
}

/** Browlet's supported feature definitions, shared across browser instances. */
// https://w3c.github.io/webappsec-permissions-policy/#supported-features
// https://html.spec.whatwg.org/multipage/infrastructure.html#cross-origin-isolated-feature
const supportedPolicyFeatures = new Map<string, PolicyControlledFeature>([
  ['cross-origin-isolated', { name: 'cross-origin-isolated', defaultAllowlist: 'self' }],
  // https://fetch.spec.whatwg.org/#deferred-fetch-quota
  ['deferred-fetch', { name: 'deferred-fetch', defaultAllowlist: 'self' }],
  ['deferred-fetch-minimal', { name: 'deferred-fetch-minimal', defaultAllowlist: '*' }],
]);
