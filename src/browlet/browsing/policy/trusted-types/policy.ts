import { TypeError } from '../../../../infra/index';
import {
  arg, defineCallbackFunction, defineDictionary, defineInterface, dictMember, idlType,
  impl, nullable, onError, op, reference, roAttr,
} from '../../../../web-idl/core/index';

import { TrustedHTMLImpl, TrustedScriptImpl, TrustedScriptURLImpl, type TrustedTypeName } from './value';

/** A named collection of converted author callbacks that produce trusted values. */
// https://w3c.github.io/trusted-types/dist/spec/#trustedtypepolicy
export class TrustedTypePolicyImpl {
  /** Name selected when this policy was created. */
  readonly name: string;
  /** Snapshot supplied by dictionary conversion, not the author's options object. */
  #options: TrustedTypePolicyOptions;

  constructor(name: string, options: TrustedTypePolicyOptions) {
    this.name = name;
    this.#options = options;
  }

  /** Invoke the HTML policy callback and retain its converted result. */
  createHTML(input: string, ...argumentsList: unknown[]): TrustedHTMLImpl {
    return new TrustedHTMLImpl(this.getPolicyValue('TrustedHTML', input, argumentsList, true) ?? '');
  }

  /** Invoke the script policy callback without compiling its result. */
  createScript(input: string, ...argumentsList: unknown[]): TrustedScriptImpl {
    return new TrustedScriptImpl(this.getPolicyValue('TrustedScript', input, argumentsList, true) ?? '');
  }

  /** Invoke the script URL callback without parsing or fetching its result. */
  createScriptURL(input: string, ...argumentsList: unknown[]): TrustedScriptURLImpl {
    return new TrustedScriptURLImpl(this.getPolicyValue('TrustedScriptURL', input, argumentsList, true) ?? '');
  }

  /** Invoke a converted callback; keep null distinct for later default-policy processing. */
  // https://w3c.github.io/trusted-types/dist/spec/#get-trusted-type-policy-value-algorithm
  getPolicyValue(
    trustedTypeName: TrustedTypeName, input: string, argumentsList: unknown[], throwIfMissing: boolean,
  ): string | null {
    const callback = this.#options[policyCallbacks[trustedTypeName]];
    if (callback === undefined) {
      if (throwIfMissing) throw new TypeError(`Policy ${this.name} has no ${trustedTypeName} callback`);
      return null;
    }
    // Web IDL invokes in the callback's realm, converts the result, and rethrows author errors.
    return callback(input, ...argumentsList);
  }
}

/** Implementation-facing callback after Web IDL has converted its nullable string result. */
export type TrustedTypePolicyCallback = (this: void, input: string, ...argumentsList: unknown[]) => string | null;

/** Converted optional policy callbacks; missing members remain undefined. */
export type TrustedTypePolicyOptions = {
  createHTML?: TrustedTypePolicyCallback;
  createScript?: TrustedTypePolicyCallback;
  createScriptURL?: TrustedTypePolicyCallback;
};

const policyCallbacks = {
  TrustedHTML: 'createHTML',
  TrustedScript: 'createScript',
  TrustedScriptURL: 'createScriptURL',
} as const;

/*
 * [Exposed=(Window,Worker)] interface TrustedTypePolicy {
 *   readonly attribute DOMString name;
 *   TrustedHTML createHTML(DOMString input, any... arguments);
 *   TrustedScript createScript(DOMString input, any... arguments);
 *   TrustedScriptURL createScriptURL(DOMString input, any... arguments);
 * };
 * PROVISIONAL: createParserOptions and its callback await TT-C's Sanitizer dependencies.
 */
export const trustedTypePolicyIDL = defineInterface({
  name: 'TrustedTypePolicy',
  exposed: ['Window', 'Worker'],
  implementation: impl(TrustedTypePolicyImpl),
  members: [
    roAttr('name', idlType.DOMString),
    op('createHTML', reference(TrustedHTMLImpl), [
      arg('input', idlType.DOMString), arg('arguments', idlType.any, { variadic: true }),
    ]),
    op('createScript', reference(TrustedScriptImpl), [
      arg('input', idlType.DOMString), arg('arguments', idlType.any, { variadic: true }),
    ]),
    op('createScriptURL', reference(TrustedScriptURLImpl), [
      arg('input', idlType.DOMString), arg('arguments', idlType.any, { variadic: true }),
    ]),
  ],
});

/*
 * dictionary TrustedTypePolicyOptions {
 *   CreateHTMLCallback createHTML;
 *   CreateScriptCallback createScript;
 *   CreateScriptURLCallback createScriptURL;
 * };
 */
export const trustedTypePolicyOptionsIDL = defineDictionary({
  name: 'TrustedTypePolicyOptions',
  members: [
    dictMember('createHTML', reference('CreateHTMLCallback'), onError('rethrow')),
    dictMember('createScript', reference('CreateScriptCallback'), onError('rethrow')),
    dictMember('createScriptURL', reference('CreateScriptURLCallback'), onError('rethrow')),
  ],
});

// callback CreateHTMLCallback = DOMString? (DOMString input, any... arguments);
export const createHTMLCallbackIDL = defineCallbackFunction({
  name: 'CreateHTMLCallback',
  returns: nullable(idlType.DOMString),
  arguments: [arg('input', idlType.DOMString), arg('arguments', idlType.any, { variadic: true })],
});

// callback CreateScriptCallback = DOMString? (DOMString input, any... arguments);
export const createScriptCallbackIDL = defineCallbackFunction({
  name: 'CreateScriptCallback',
  returns: nullable(idlType.DOMString),
  arguments: [arg('input', idlType.DOMString), arg('arguments', idlType.any, { variadic: true })],
});

// callback CreateScriptURLCallback = USVString? (DOMString input, any... arguments);
export const createScriptURLCallbackIDL = defineCallbackFunction({
  name: 'CreateScriptURLCallback',
  returns: nullable(idlType.USVString),
  arguments: [arg('input', idlType.DOMString), arg('arguments', idlType.any, { variadic: true })],
});
