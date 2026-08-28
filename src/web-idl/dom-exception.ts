import {
  domExceptionCode, domExceptionName,
} from '../shared/dom-exception';
import {
  arg, constant, contextValue, ctor, defineDictionary, defineInterface,
  dictMember, emptyDictionary, idlType, impl, integer, nullable,
  roAttr, reference, xattr,
} from './declaration/index';
import type { WebIDLRealmHost } from './javascript-realm';

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

class DOMExceptionImpl {
  constructor(
    realm: WebIDLRealmHost,
    message = '',
    name = 'Error',
  ) {
    return createDOMExceptionObject(
      realm,
      new.target,
      message,
      name,
    ) as DOMExceptionImpl;
  }

  get name(): string {
    return getDOMExceptionState(this).name;
  }

  get message(): string {
    return getDOMExceptionState(this).message;
  }

  get code(): number {
    return legacyCodesByName.get(getDOMExceptionState(this).name) ?? 0;
  }
}

const bindingRealm = contextValue(
  (context: { readonly realm: WebIDLRealmHost; }) => context.realm,
);

export const domExceptionIDL = defineInterface({
  name: 'DOMException',
  exposed: '*',
  ...xattr('Serializable'),
  implementation: impl(DOMExceptionImpl, {
    withArgs: [bindingRealm],
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

class QuotaExceededErrorImpl extends DOMExceptionImpl {
  constructor(
    realm: WebIDLRealmHost,
    message = '',
    options: QuotaExceededErrorOptions = {},
  ) {
    super(realm, message, 'QuotaExceededError');

    const { quota, requested } = options;
    if (quota !== undefined && quota < 0) {
      throw new realm.intrinsics.rangeError();
    }
    if (requested !== undefined && requested < 0) {
      throw new realm.intrinsics.rangeError();
    }
    if (
      quota !== undefined &&
      requested !== undefined &&
      requested < quota
    ) {
      throw new realm.intrinsics.rangeError();
    }

    quotaExceededErrorStates.set(this, {
      quota: quota ?? null,
      requested: requested ?? null,
    });
  }

  get quota(): number | null {
    return getQuotaExceededErrorState(this).quota;
  }

  get requested(): number | null {
    return getQuotaExceededErrorState(this).requested;
  }
}

export const quotaExceededErrorIDL = defineInterface({
  name: 'QuotaExceededError',
  inherits: 'DOMException',
  exposed: '*',
  ...xattr('Serializable'),
  implementation: impl(QuotaExceededErrorImpl, {
    withArgs: [bindingRealm],
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

/*
 * Web IDL defines DOMException's structured-data algorithms, while HTML owns
 * the records and graph which carry this state. These friends expose only the
 * semantic state needed by that integration boundary.
 */
export function getDOMExceptionSerializationState(
  value: object,
): DOMExceptionSerializationState {
  const state = getDOMExceptionState(value);
  return {
    message: state.message,
    name: state.name,
  };
}

export function setDOMExceptionSerializationState(
  value: object,
  state: DOMExceptionSerializationState,
): void {
  domExceptionStates.set(value, {
    message: state.message,
    name: state.name,
  });
}

export function getQuotaExceededErrorSerializationState(
  value: object,
): QuotaExceededErrorSerializationState {
  return { ...getQuotaExceededErrorState(value) };
}

export function setQuotaExceededErrorSerializationState(
  value: object,
  state: QuotaExceededErrorSerializationState,
): void {
  quotaExceededErrorStates.set(value, { ...state });
}

export type DOMExceptionSerializationState = {
  message: string;
  name: string;
};

export type QuotaExceededErrorSerializationState = {
  quota: number | null;
  requested: number | null;
};

type DOMExceptionState = {
  message: string;
  name: string;
};

type QuotaExceededErrorState = {
  quota: number | null;
  requested: number | null;
};

type QuotaExceededErrorOptions = {
  quota?: number;
  requested?: number;
};

const domExceptionStates = new WeakMap<object, DOMExceptionState>();
const quotaExceededErrorStates = new WeakMap<
  object,
  QuotaExceededErrorState
>();
const legacyCodesByName = new Map<string, number>(
  Object.keys(domExceptionName).map((key) => [
    domExceptionName[key as keyof typeof domExceptionName],
    domExceptionCode[key as keyof typeof domExceptionCode],
  ]),
);

function getDOMExceptionState(value: object | null): DOMExceptionState {
  const state = value && domExceptionStates.get(value);
  if (!state) throw new TypeError('DOMException implementation state is missing');
  return state;
}

function getQuotaExceededErrorState(
  value: object | null,
): QuotaExceededErrorState {
  const state = value && quotaExceededErrorStates.get(value);
  if (!state) {
    throw new TypeError('QuotaExceededError implementation state is missing');
  }
  return state;
}

function createDOMExceptionObject(
  realm: WebIDLRealmHost,
  newTarget: object,
  message: string,
  name: string,
): object {
  const object = Reflect.construct(
    realm.intrinsics.error,
    [],
    newTarget as ErrorConstructor,
  );
  domExceptionStates.set(object, { message, name });
  return object;
}
