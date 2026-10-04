import { RangeError } from '../../infra/exceptions';
import { Stamper } from '../../infra/stamper';

import { emptyDictionary, idlType } from './types';
import type { SerialSteps } from './structured-data';
import { defineDictionary, defineInterface } from './declarations';
import {
  arg, constant, ctor, dictMember, impl, integer, nullable, roAttr, reference, xattr,
} from './helpers';

// https://webidl.spec.whatwg.org/#idl-exceptions

export const DOMExceptionNames = {
  indexSize: 'IndexSizeError',
  hierarchyRequest: 'HierarchyRequestError',
  wrongDocument: 'WrongDocumentError',
  invalidCharacter: 'InvalidCharacterError',
  noModificationAllowed: 'NoModificationAllowedError',
  notFound: 'NotFoundError',
  notSupported: 'NotSupportedError',
  inUseAttribute: 'InUseAttributeError',
  invalidState: 'InvalidStateError',
  syntax: 'SyntaxError',
  invalidModification: 'InvalidModificationError',
  namespace: 'NamespaceError',
  invalidAccess: 'InvalidAccessError',
  typeMismatch: 'TypeMismatchError',
  security: 'SecurityError',
  network: 'NetworkError',
  abort: 'AbortError',
  urlMismatch: 'URLMismatchError',
  quotaExceeded: 'QuotaExceededError',
  timeout: 'TimeoutError',
  invalidNodeType: 'InvalidNodeTypeError',
  dataClone: 'DataCloneError',
  encoding: 'EncodingError',
  notReadable: 'NotReadableError',
  unknown: 'UnknownError',
  constraint: 'ConstraintError',
  data: 'DataError',
  transactionInactive: 'TransactionInactiveError',
  readOnly: 'ReadOnlyError',
  version: 'VersionError',
  operation: 'OperationError',
  notAllowed: 'NotAllowedError',
  optOut: 'OptOutError',
} as const;

export const DOMExceptionCodes = {
  indexSize: 1,
  hierarchyRequest: 3,
  wrongDocument: 4,
  invalidCharacter: 5,
  noModificationAllowed: 7,
  notFound: 8,
  notSupported: 9,
  inUseAttribute: 10,
  invalidState: 11,
  syntax: 12,
  invalidModification: 13,
  namespace: 14,
  invalidAccess: 15,
  typeMismatch: 17,
  security: 18,
  network: 19,
  abort: 20,
  urlMismatch: 21,
  quotaExceeded: 22,
  timeout: 23,
  invalidNodeType: 24,
  dataClone: 25,
  encoding: 0,
  notReadable: 0,
  unknown: 0,
  constraint: 0,
  data: 0,
  transactionInactive: 0,
  readOnly: 0,
  version: 0,
  operation: 0,
  notAllowed: 0,
  optOut: 0,
} as const satisfies Record<keyof typeof DOMExceptionNames, number>;

export type DOMExceptionName = typeof DOMExceptionNames[
  keyof typeof DOMExceptionNames
];

/** Common exception attributes shared by implementations and host platform objects. */
export interface DOMException {
  name: string;
  message: string;
  code: number;
}

/** Constructor supplied by Binding or a standalone host for its platform exceptions. */
export interface DOMExceptionConstructor {
  new (message?: string, name?: string): DOMException;
}

/** Exception state projected into a realm-owned DOMException when exposed. */
// https://webidl.spec.whatwg.org/#idl-DOMException
export class DOMExceptionImpl implements DOMException {
  // Private state supports recognition without consulting author properties or prototypes.
  #message: string;
  #name: string;

  // Web IDL §4.4 DOMException — constructor steps.
  constructor(message = '', name = 'Error') {
    this.#message = message;
    this.#name = name;
  }

  /** Recognize exception implementations, optionally checking their stored name. */
  static is(value: unknown, name?: string): value is DOMExceptionImpl {
    return typeof value === 'object' && value !== null && #name in value &&
      (name === undefined || value.#name === name);
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

/** Privately identify projected DOMExceptions without consulting binding records. */
export class DOMExceptionStamper extends Stamper {
  /** Existing exception state, also updated when structured deserialization restores it. */
  #impl: DOMExceptionImpl;

  private constructor(platformObject: object, implInst: DOMExceptionImpl) {
    super(platformObject);
    this.#impl = implInst;
  }

  /** Retain the implementation on its newly projected exception for recognition in Core. */
  static stamp(platformObject: object, implInst: DOMExceptionImpl): void {
    new DOMExceptionStamper(platformObject, implInst);
  }

  /** Recognize a projected exception, optionally checking its original name. */
  static is(value: unknown, name?: string): value is DOMException {
    return typeof value === 'object' && value !== null && #impl in value &&
      (name === undefined || DOMExceptionImpl.is(value.#impl, name));
  }
}

/** Recognize implementations or projected exceptions without reading author-overridden properties. */
export function isDOMException(value: unknown, name: string): boolean {
  return DOMExceptionImpl.is(value, name) || DOMExceptionStamper.is(value, name);
}

// https://webidl.spec.whatwg.org/#idl-DOMException
const domExceptionSerialSteps = {
  serializationSteps(value, serialized) {
    serialized.set('Name', value.name);
    serialized.set('Message', value.message);
  },
  deserializationSteps(serialized, value) {
    value.setExceptionState(
      serialized.get('Message'),
      serialized.get('Name'),
    );
  },
} satisfies SerialSteps<DOMExceptionImpl, DOMExceptionSerializedFields>;

type DOMExceptionSerializedFields = {
  Name: string;
  Message: string;
};

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
export const domExceptionIDL = defineInterface({
  name: 'DOMException',
  exposed: '*',
  ...xattr('Serializable'),
  serialSteps: domExceptionSerialSteps,
  implementation: impl(DOMExceptionImpl),
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

// https://webidl.spec.whatwg.org/#idl-DOMException-derived-predefineds
const quotaExceededErrorSerialSteps = {
  serializationSteps(value, serialized) {
    domExceptionSerialSteps.serializationSteps(value, serialized);
    serialized.set('Quota', value.quota);
    serialized.set('Requested', value.requested);
  },
  deserializationSteps(serialized, value) {
    domExceptionSerialSteps.deserializationSteps(serialized, value);
    value.setQuotaState(
      serialized.get('Quota'),
      serialized.get('Requested'),
    );
  },
} satisfies SerialSteps<QuotaExceededErrorImpl, QuotaExceededErrorSerializedFields>;

type QuotaExceededErrorSerializedFields = DOMExceptionSerializedFields & {
  Quota: number | null;
  Requested: number | null;
};

export const quotaExceededErrorIDL = defineInterface({
  name: 'QuotaExceededError',
  inherits: 'DOMException',
  exposed: '*',
  ...xattr('Serializable'),
  serialSteps: quotaExceededErrorSerialSteps,
  implementation: impl(QuotaExceededErrorImpl),
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
