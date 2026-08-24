import {
  domExceptionCode, domExceptionName,
} from '../shared/dom-exception';
import {
  arg, constant, ctor, defineDictionary, defineInterface, dictMember,
  emptyDictionary, idlType, integer, nullable, readonlyAttr, reference, xattr,
} from './declaration/index';
import { bind } from './projection';
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

export const domExceptionIDL = defineInterface({
  binding: bind({
    create(context, newTarget) {
      return createDOMExceptionObject(
        context.realm,
        newTarget,
        'Error',
      );
    },
  }),
  exposed: '*',
  ...xattr('Serializable'),
  members: [
    ctor([
      arg('message', idlType.DOMString, {
        default: '', optional: true,
      }),
      arg('name', idlType.DOMString, {
        default: 'Error', optional: true,
      }),
    ], bind({
      invoke(_context, message, name) {
        const state = getDOMExceptionState(this);
        state.message = message as string;
        state.name = name as string;
      },
    })),
    readonlyAttr('name', idlType.DOMString, bind({
      get() { return getDOMExceptionState(this).name; },
    })),
    readonlyAttr('message', idlType.DOMString, bind({
      get() { return getDOMExceptionState(this).message; },
    })),
    readonlyAttr('code', idlType.unsignedShort, bind({
      get() {
        return legacyCodesByName.get(getDOMExceptionState(this).name) ?? 0;
      },
    })),
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
  name: 'DOMException',
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

export const quotaExceededErrorIDL = defineInterface({
  binding: bind({
    create(context, newTarget) {
      const object = createDOMExceptionObject(
        context.realm,
        newTarget,
        'QuotaExceededError',
      );
      quotaExceededErrorStates.set(object, {
        quota: null,
        requested: null,
      });
      return object;
    },
  }),
  exposed: '*',
  ...xattr('Serializable'),
  inherits: 'DOMException',
  members: [
    ctor([
      arg('message', idlType.DOMString, {
        default: '', optional: true,
      }),
      arg('options', reference('QuotaExceededErrorOptions'), {
        default: emptyDictionary, optional: true,
      }),
    ], bind({
      invoke(context, message, options) {
        const domExceptionState = getDOMExceptionState(this);
        const state = getQuotaExceededErrorState(this);
        const values = options as Record<PropertyKey, unknown>;
        const quota = values.quota as number | undefined;
        const requested = values.requested as number | undefined;

        domExceptionState.name = 'QuotaExceededError';
        domExceptionState.message = message as string;
        if (quota !== undefined) {
          if (quota < 0) {
            throw new context.realm.intrinsics.rangeError();
          }
          state.quota = quota;
        }
        if (requested !== undefined) {
          if (requested < 0) {
            throw new context.realm.intrinsics.rangeError();
          }
          state.requested = requested;
        }
        if (
          state.quota !== null &&
          state.requested !== null &&
          state.requested < state.quota
        ) {
          throw new context.realm.intrinsics.rangeError();
        }
      },
    })),
    readonlyAttr('quota', nullable(idlType.double), bind({
      get() { return getQuotaExceededErrorState(this).quota; },
    })),
    readonlyAttr('requested', nullable(idlType.double), bind({
      get() { return getQuotaExceededErrorState(this).requested; },
    })),
  ],
  name: 'QuotaExceededError',
});

export const quotaExceededErrorOptionsIDL = defineDictionary({
  members: [
    dictMember('quota', idlType.double),
    dictMember('requested', idlType.double),
  ],
  name: 'QuotaExceededErrorOptions',
});

type DOMExceptionState = {
  message: string;
  name: string;
};

type QuotaExceededErrorState = {
  quota: number | null;
  requested: number | null;
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
  newTarget: object | undefined,
  name: string,
): object {
  const target = newTarget ?? realm.intrinsics.error;
  const object = Reflect.construct(
    realm.intrinsics.error,
    [],
    target as ErrorConstructor,
  );
  domExceptionStates.set(object, { message: '', name });
  return object;
}
