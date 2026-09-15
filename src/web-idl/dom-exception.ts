import { RangeError } from '../js-engine/exceptions';
import {
  DOMExceptionCodes, DOMExceptionNames,
} from './core/dom-exception';
import {
  arg, constant, ctor, defineDictionary, defineInterface,
  dictMember, emptyDictionary, idlType, impl, integer, nullable,
  roAttr, reference, xattr,
} from './core/index';
import type { BindingContext } from './binding-context';

/*
 * [Exposed=*,
 *  Serializable]
 * interface DOMException { // but see below note about JavaScript binding
 *   constructor(optional DOMString message = "", optional DOMString name = "Error");
 *   readonly attribute DOMString name;
 *   readonly attribute DOMString message;
 *   readonly attribute unsigned short code;
 *
 *   const unsigned short INDEX_SIZE_ERR = 1;
 *   const unsigned short DOMSTRING_SIZE_ERR = 2;
 *   const unsigned short HIERARCHY_REQUEST_ERR = 3;
 *   const unsigned short WRONG_DOCUMENT_ERR = 4;
 *   const unsigned short INVALID_CHARACTER_ERR = 5;
 *   const unsigned short NO_DATA_ALLOWED_ERR = 6;
 *   const unsigned short NO_MODIFICATION_ALLOWED_ERR = 7;
 *   const unsigned short NOT_FOUND_ERR = 8;
 *   const unsigned short NOT_SUPPORTED_ERR = 9;
 *   const unsigned short INUSE_ATTRIBUTE_ERR = 10;
 *   const unsigned short INVALID_STATE_ERR = 11;
 *   const unsigned short SYNTAX_ERR = 12;
 *   const unsigned short INVALID_MODIFICATION_ERR = 13;
 *   const unsigned short NAMESPACE_ERR = 14;
 *   const unsigned short INVALID_ACCESS_ERR = 15;
 *   const unsigned short VALIDATION_ERR = 16;
 *   const unsigned short TYPE_MISMATCH_ERR = 17;
 *   const unsigned short SECURITY_ERR = 18;
 *   const unsigned short NETWORK_ERR = 19;
 *   const unsigned short ABORT_ERR = 20;
 *   const unsigned short URL_MISMATCH_ERR = 21;
 *   const unsigned short QUOTA_EXCEEDED_ERR = 22;
 *   const unsigned short TIMEOUT_ERR = 23;
 *   const unsigned short INVALID_NODE_TYPE_ERR = 24;
 *   const unsigned short DATA_CLONE_ERR = 25;
 * };
 */

export class DOMExceptionImpl {
  #message: string;
  #name: string;

  // Web IDL §4.4 DOMException — constructor steps.
  constructor(message = '', name = 'Error') {
    this.#message = message;
    this.#name = name;
  }

  // Web IDL §4.4 DOMException — name getter steps.
  get name(): string {
    return this.#name;
  }

  // Web IDL §4.4 DOMException — message getter steps.
  get message(): string {
    return this.#message;
  }

  // Web IDL §4.4 DOMException — code getter steps.
  get code(): number {
    return legacyCodesByName.get(this.#name) ?? 0;
  }

  // -- Internal methods ------------------------------------------------

  // Project helper: restore the implementation's name and message.
  setExceptionState(message: string, name: string): void {
    this.#message = message;
    this.#name = name;
  }
}

// -- Web IDL ------------------------------------------------------------

export const domExceptionIDL = defineInterface({
  name: 'DOMException',
  exposed: '*',
  ...xattr('Serializable'),
  implementation: impl(DOMExceptionImpl, {
    allocatePlatformObject: allocateErrorPlatformObject,
  }),
  members: [
    ctor([
      arg('message', idlType.DOMString, {
        default: '', optional: true,
      }),
      arg('name', idlType.DOMString, {
        default: 'Error', optional: true,
      }),
    ]),
    roAttr('name', idlType.DOMString),
    roAttr('message', idlType.DOMString),
    roAttr('code', idlType.unsignedShort),
    ...([
      ['INDEX_SIZE_ERR', 1],
      ['DOMSTRING_SIZE_ERR', 2],
      ['HIERARCHY_REQUEST_ERR', 3],
      ['WRONG_DOCUMENT_ERR', 4],
      ['INVALID_CHARACTER_ERR', 5],
      ['NO_DATA_ALLOWED_ERR', 6],
      ['NO_MODIFICATION_ALLOWED_ERR', 7],
      ['NOT_FOUND_ERR', 8],
      ['NOT_SUPPORTED_ERR', 9],
      ['INUSE_ATTRIBUTE_ERR', 10],
      ['INVALID_STATE_ERR', 11],
      ['SYNTAX_ERR', 12],
      ['INVALID_MODIFICATION_ERR', 13],
      ['NAMESPACE_ERR', 14],
      ['INVALID_ACCESS_ERR', 15],
      ['VALIDATION_ERR', 16],
      ['TYPE_MISMATCH_ERR', 17],
      ['SECURITY_ERR', 18],
      ['NETWORK_ERR', 19],
      ['ABORT_ERR', 20],
      ['URL_MISMATCH_ERR', 21],
      ['QUOTA_EXCEEDED_ERR', 22],
      ['TIMEOUT_ERR', 23],
      ['INVALID_NODE_TYPE_ERR', 24],
      ['DATA_CLONE_ERR', 25],
    ] as const).map(([name, value]) =>
      constant(name, idlType.unsignedShort, integer(value))),
  ],
});

/*
 * [Exposed=*, Serializable]
 * interface QuotaExceededError : DOMException {
 *   constructor(optional DOMString message = "", optional QuotaExceededErrorOptions options = {});
 *
 *   readonly attribute double? quota;
 *   readonly attribute double? requested;
 * };
 *
 * dictionary QuotaExceededErrorOptions {
 *   double quota;
 *   double requested;
 * };
 */

export class QuotaExceededErrorImpl extends DOMExceptionImpl {
  #quota: number | null;
  #requested: number | null;

  // Web IDL §2.8.3 Predefined DOMException derived interfaces — QuotaExceededError constructor steps.
  constructor(
    message = '',
    options: QuotaExceededErrorOptions = {},
  ) {
    super(message, 'QuotaExceededError');

    const { quota, requested } = options;
    if (quota !== undefined && quota < 0) {
      throw new RangeError();
    }
    if (requested !== undefined && requested < 0) {
      throw new RangeError();
    }
    if (
      quota !== undefined &&
      requested !== undefined &&
      requested < quota
    ) {
      throw new RangeError();
    }

    this.#quota = quota ?? null;
    this.#requested = requested ?? null;
  }

  // Web IDL §2.8.3 Predefined DOMException derived interfaces — quota getter steps.
  get quota(): number | null {
    return this.#quota;
  }

  // Web IDL §2.8.3 Predefined DOMException derived interfaces — requested getter steps.
  get requested(): number | null {
    return this.#requested;
  }

  // -- Internal methods ------------------------------------------------

  // Project helper: restore the implementation's quota and requested values.
  setQuotaState(quota: number | null, requested: number | null): void {
    this.#quota = quota;
    this.#requested = requested;
  }
}

// -- Web IDL ------------------------------------------------------------

export const quotaExceededErrorIDL = defineInterface({
  name: 'QuotaExceededError',
  inherits: 'DOMException',
  exposed: '*',
  ...xattr('Serializable'),
  implementation: impl(QuotaExceededErrorImpl, {
    allocatePlatformObject: allocateErrorPlatformObject,
  }),
  members: [
    ctor([
      arg('message', idlType.DOMString, {
        default: '', optional: true,
      }),
      arg('options', reference('QuotaExceededErrorOptions'), {
        default: emptyDictionary, optional: true,
      }),
    ]),
    roAttr('quota', nullable(idlType.double)),
    roAttr('requested', nullable(idlType.double)),
  ],
});

export const quotaExceededErrorOptionsIDL = defineDictionary({
  name: 'QuotaExceededErrorOptions',
  members: [
    dictMember('quota', idlType.double),
    dictMember('requested', idlType.double),
  ],
});

type QuotaExceededErrorOptions = {
  quota?: number;
  requested?: number;
};

const legacyCodesByName = new Map<string, number>(
  Object.keys(DOMExceptionNames).map((key) => [
    DOMExceptionNames[key as keyof typeof DOMExceptionNames],
    DOMExceptionCodes[key as keyof typeof DOMExceptionCodes],
  ]),
);

// Project allocator for Web IDL §3.14.1 DOMException custom bindings — native Error backing for DOMException
// platform objects.
function allocateErrorPlatformObject(
  context: BindingContext,
  prototype: object,
): object {
  const object = Reflect.construct(context.realm.intrinsics.error, []);
  if (!Reflect.setPrototypeOf(object, prototype)) {
    throw new TypeError('Could not set DOMException platform-object prototype');
  }
  return object;
}
