import { TypeError } from '../../../../infra/exceptions';
import { asciiLower } from '../../../../infra/ascii';
import { HTML_NAMESPACE } from '../../../../infra/namespaces';
import {
  arg, defineInterface, emptyDictionary, idlType, impl, nullable, op, reference, roAttr,
} from '../../../../web-idl/index';

import type { BrowletEnvironment } from '../../../environment';

import {
  TrustedHTMLImpl, TrustedScriptImpl, TrustedScriptURLImpl, type TrustedTypeName, type TrustedTypeValue,
} from './value';
import { TrustedTypePolicyImpl, type TrustedTypePolicyOptions } from './policy';
import { getTrustedTypeDataForAttribute } from './sinks';

/** One global's policy creation history, default policy, and empty trusted values. */
// https://w3c.github.io/trusted-types/dist/spec/#trustedtypepolicyfactory
export class TrustedTypePolicyFactoryImpl {
  /** The single policy named "default", or null before its creation. */
  defaultPolicy: TrustedTypePolicyImpl | null = null;
  /** Stable empty values owned by this factory. */
  readonly emptyHTML = new TrustedHTMLImpl('');
  readonly emptyScript = new TrustedScriptImpl('');
  /** Environment whose policies apply, including when methods are borrowed across realms. */
  #env: BrowletEnvironment;
  /** Successful policy names; rejected creation attempts do not reserve a name. */
  #createdPolicyNames = new Set<string>();

  constructor(env: BrowletEnvironment) {
    this.#env = env;
  }

  /** Check every CSP policy before installing the converted callback collection. */
  // https://w3c.github.io/trusted-types/dist/spec/#create-trusted-type-policy-algorithm
  createPolicy(name: string, options: TrustedTypePolicyOptions): TrustedTypePolicyImpl {
    if (this.#env.policyContainer.cspList?.isTrustedTypePolicyCreationBlocked(name, this.#createdPolicyNames, this.#env)) {
      throw new TypeError(`Content Security Policy blocks Trusted Types policy ${name}`);
    }
    if (name === 'default' && this.defaultPolicy !== null) {
      throw new TypeError('A default Trusted Types policy already exists');
    }
    const policy = new TrustedTypePolicyImpl(name, options);
    if (name === 'default') this.defaultPolicy = policy;
    this.#createdPolicyNames.add(name);
    return policy;
  }

  /** Classify an attribute name without requiring an implemented element constructor. */
  // https://w3c.github.io/trusted-types/dist/spec/#dom-trustedtypepolicyfactory-getattributetype
  getAttributeType(
    tagName: string, attribute: string, elementNs: string | null, attrNs: string | null,
  ): TrustedTypeName | null {
    return getTrustedTypeDataForAttribute(
      asciiLower(tagName), elementNs || HTML_NAMESPACE, asciiLower(attribute), attrNs || null,
    )?.type ?? null;
  }

  /** Classify a property; unlike tag names, property names are case-sensitive. */
  // https://w3c.github.io/trusted-types/dist/spec/#dom-trustedtypepolicyfactory-getpropertytype
  getPropertyType(tagName: string, property: string, elementNs: string | null): TrustedTypeName | null {
    const localName = asciiLower(tagName);
    const namespace = elementNs || HTML_NAMESPACE;
    if (namespace === HTML_NAMESPACE) {
      if (localName === 'iframe' && property === 'srcdoc') return 'TrustedHTML';
      if (localName === 'script') {
        if (property === 'innerText' || property === 'text' || property === 'textContent') return 'TrustedScript';
        if (property === 'src') return 'TrustedScriptURL';
      }
    }
    if (property === 'innerHTML' || property === 'outerHTML') return 'TrustedHTML';
    return null;
  }

  /** Accept a matching trusted value, or apply this global's default policy and CSP requirements. */
  // https://w3c.github.io/trusted-types/dist/spec/#get-trusted-type-compliant-string-algorithm
  // This global's factory retains its environment; expectedType names select implementation brands.
  getCompliantString(expectedType: TrustedTypeName, input: TrustedTypeValue | string, sink: string, sinkGroup: string): string {
    if (input instanceof trustedTypeImplementations[expectedType]) return input.data;
    const value = typeof input === 'string' ? input : input.data;
    const env = this.#env;
    const initialPolicies = env.policyContainer.cspList;
    if (!initialPolicies?.doesSinkTypeRequireTrustedTypes(sinkGroup, true)) return value;

    // https://w3c.github.io/trusted-types/dist/spec/#process-value-with-a-default-policy-algorithm
    // Keep the callback's converted string directly: the specification's temporary trusted
    // value would immediately be unwrapped here and is never exposed to author code.
    const converted = this.defaultPolicy?.getPolicyValue(expectedType, value, [expectedType, sink], false) ?? null;
    if (converted !== null) return converted;

    // The callback can change policy state. Consult the selected global again after it returns.
    if (env.policyContainer.cspList?.isTrustedTypeSinkMismatchBlocked(sink, sinkGroup, value, env)) {
      throw new TypeError(`${sink} requires ${expectedType}`);
    }
    return value;
  }
}

const trustedTypeImplementations = {
  TrustedHTML: TrustedHTMLImpl, TrustedScript: TrustedScriptImpl, TrustedScriptURL: TrustedScriptURLImpl,
};

/*
 * [Exposed=(Window,Worker)] interface TrustedTypePolicyFactory {
 *   TrustedTypePolicy createPolicy(DOMString policyName, optional TrustedTypePolicyOptions policyOptions = {});
 *   boolean isHTML(any value);
 *   boolean isScript(any value);
 *   boolean isScriptURL(any value);
 *   readonly attribute TrustedHTML emptyHTML;
 *   readonly attribute TrustedScript emptyScript;
 *   DOMString? getAttributeType(DOMString tagName, DOMString attribute,
 *     optional DOMString? elementNs = "", optional DOMString? attrNs = "");
 *   DOMString? getPropertyType(DOMString tagName, DOMString property, optional DOMString? elementNs = "");
 *   readonly attribute TrustedTypePolicy? defaultPolicy;
 * };
 */
export const trustedTypePolicyFactoryIDL = defineInterface({
  name: 'TrustedTypePolicyFactory',
  exposed: ['Window', 'Worker'],
  implementation: impl(TrustedTypePolicyFactoryImpl),
  members: [
    op('createPolicy', reference(TrustedTypePolicyImpl), [
      arg('policyName', idlType.DOMString),
      arg('policyOptions', reference('TrustedTypePolicyOptions'), { optional: true, default: emptyDictionary }),
    ]),
    // These operations recognize author-side brands, so identity belongs at the binding boundary.
    op('isHTML', idlType.boolean,
      [arg('value', idlType.any)],
      { invoke: (context, value) => context.unwrap(value, TrustedHTMLImpl) !== undefined },
    ),
    op('isScript', idlType.boolean,
      [arg('value', idlType.any)],
      { invoke: (context, value) => context.unwrap(value, TrustedScriptImpl) !== undefined },
    ),
    op('isScriptURL', idlType.boolean,
      [arg('value', idlType.any)],
      { invoke: (context, value) => context.unwrap(value, TrustedScriptURLImpl) !== undefined },
    ),
    roAttr('emptyHTML', reference(TrustedHTMLImpl)),
    roAttr('emptyScript', reference(TrustedScriptImpl)),
    op('getAttributeType', nullable(idlType.DOMString), [
      arg('tagName', idlType.DOMString), arg('attribute', idlType.DOMString),
      arg('elementNs', nullable(idlType.DOMString), { optional: true, default: '' }),
      arg('attrNs', nullable(idlType.DOMString), { optional: true, default: '' }),
    ]),
    op('getPropertyType', nullable(idlType.DOMString), [
      arg('tagName', idlType.DOMString), arg('property', idlType.DOMString),
      arg('elementNs', nullable(idlType.DOMString), { optional: true, default: '' }),
    ]),
    roAttr('defaultPolicy', nullable(reference(TrustedTypePolicyImpl))),
  ],
});
