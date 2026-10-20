import { isObject } from '../../../../js-engine/index';
import {
  defineInterface, defineTypedef, idlType, impl, op, reference, stringifier, union,
} from '../../../../web-idl/core/index';

/** HTML text produced by a Trusted Types policy, without parsing or sanitization. */
// https://w3c.github.io/trusted-types/dist/spec/#trustedhtml
export class TrustedHTMLImpl {
  /** Immutable policy result; author properties cannot replace this data. */
  readonly data: string;
  #brand = undefined;

  constructor(data: string) {
    this.data = data;
  }

  /** Recognize implementation identity without inspecting author properties or prototypes. */
  static is(value: unknown): value is TrustedHTMLImpl {
    return isObject(value) && #brand in value;
  }

  /** Return the retained HTML text. */
  toString(): string { return this.data; }
  /** Serialize the retained text without consulting an author-overridden stringifier. */
  toJSON(): string { return this.data; }
}

/** Script text produced by a Trusted Types policy, without compiling it. */
// https://w3c.github.io/trusted-types/dist/spec/#trustedscript
export class TrustedScriptImpl {
  /** Immutable policy result. */
  readonly data: string;
  #brand = undefined;

  constructor(data: string) {
    this.data = data;
  }

  /** Recognize implementation identity without inspecting author properties or prototypes. */
  static is(value: unknown): value is TrustedScriptImpl {
    return isObject(value) && #brand in value;
  }

  /** Return the retained script text. */
  toString(): string { return this.data; }
  /** Serialize the retained text without consulting an author-overridden stringifier. */
  toJSON(): string { return this.data; }
}

/** Scalar-value URL string produced by a policy, without URL parsing or loading. */
// https://w3c.github.io/trusted-types/dist/spec/#trustedscripturl
export class TrustedScriptURLImpl {
  /** Immutable policy result after the callback's USVString conversion. */
  readonly data: string;
  #brand = undefined;

  constructor(data: string) {
    this.data = data;
  }

  /** Recognize implementation identity without inspecting author properties or prototypes. */
  static is(value: unknown): value is TrustedScriptURLImpl {
    return isObject(value) && #brand in value;
  }

  /** Return the retained URL string. */
  toString(): string { return this.data; }
  /** Serialize the retained string without consulting an author-overridden stringifier. */
  toJSON(): string { return this.data; }
}

/** String-bearing Trusted Types supported before the parser-options integration. */
export type TrustedTypeName = 'TrustedHTML' | 'TrustedScript' | 'TrustedScriptURL';

/** Concrete values supplied by the TrustedType union's Web IDL conversion. */
export type TrustedTypeValue = TrustedHTMLImpl | TrustedScriptImpl | TrustedScriptURLImpl;

/*
 * [Exposed=(Window,Worker)] interface TrustedHTML {
 *   stringifier;
 *   DOMString toJSON();
 * };
 */
export const trustedHTMLIDL = defineInterface({
  name: 'TrustedHTML',
  exposed: ['Window', 'Worker'],
  implementation: impl(TrustedHTMLImpl),
  members: [stringifier(), op('toJSON', idlType.DOMString)],
});

/*
 * [Exposed=(Window,Worker)] interface TrustedScript {
 *   stringifier;
 *   DOMString toJSON();
 * };
 */
export const trustedScriptIDL = defineInterface({
  name: 'TrustedScript',
  exposed: ['Window', 'Worker'],
  implementation: impl(TrustedScriptImpl),
  members: [stringifier(), op('toJSON', idlType.DOMString)],
});

/*
 * [Exposed=(Window,Worker)] interface TrustedScriptURL {
 *   stringifier;
 *   USVString toJSON();
 * };
 */
export const trustedScriptURLIDL = defineInterface({
  name: 'TrustedScriptURL',
  exposed: ['Window', 'Worker'],
  implementation: impl(TrustedScriptURLImpl),
  members: [stringifier(), op('toJSON', idlType.USVString)],
});

// typedef (TrustedHTML or TrustedScript or TrustedScriptURL) TrustedType;
export const trustedTypeIDL = defineTypedef({
  name: 'TrustedType',
  type: union(reference(TrustedHTMLImpl), reference(TrustedScriptImpl), reference(TrustedScriptURLImpl)),
});
