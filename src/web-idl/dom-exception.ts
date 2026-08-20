import {
  domExceptionCode, domExceptionName,
} from '../shared/dom-exception';
import {
  defineDictionary, defineInterface, emptyDictionary, idlType, integer,
  nullable, reference, type AttributeMember, type ConstructorMember,
  type InterfaceDefinition,
} from './definition';
import type { ImplementationRegistry } from './implementation';
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
  exposed: '*',
  extendedAttributes: [{ kind: 'no-arguments', name: 'Serializable' }],
  members: [
    {
      arguments: [
        {
          default: '', name: 'message', optional: true,
          type: idlType.DOMString,
        },
        {
          default: 'Error', name: 'name', optional: true,
          type: idlType.DOMString,
        },
      ],
      kind: 'constructor',
    },
    {
      kind: 'attribute', name: 'name', readonly: true,
      type: idlType.DOMString,
    },
    {
      kind: 'attribute', name: 'message', readonly: true,
      type: idlType.DOMString,
    },
    {
      kind: 'attribute', name: 'code', readonly: true,
      type: idlType.unsignedShort,
    },
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
    ] as const).map(([name, value]) => ({
      kind: 'constant' as const,
      name,
      type: idlType.unsignedShort,
      value: integer(value),
    })),
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

export const quotaExceededErrorOptionsIDL = defineDictionary({
  members: [
    { name: 'quota', type: idlType.double },
    { name: 'requested', type: idlType.double },
  ],
  name: 'QuotaExceededErrorOptions',
});

export const quotaExceededErrorIDL = defineInterface({
  exposed: '*',
  extendedAttributes: [{ kind: 'no-arguments', name: 'Serializable' }],
  inherits: 'DOMException',
  members: [
    {
      arguments: [
        {
          default: '', name: 'message', optional: true,
          type: idlType.DOMString,
        },
        {
          default: emptyDictionary, name: 'options', optional: true,
          type: reference('QuotaExceededErrorOptions'),
        },
      ],
      kind: 'constructor',
    },
    {
      kind: 'attribute', name: 'quota', readonly: true,
      type: nullable(idlType.double),
    },
    {
      kind: 'attribute', name: 'requested', readonly: true,
      type: nullable(idlType.double),
    },
  ],
  name: 'QuotaExceededError',
});

export function registerDOMExceptionImplementations(
  registry: ImplementationRegistry,
  realm: WebIDLRealmHost,
): void {
  registry.setObjectCreationSteps(
    domExceptionIDL,
    (newTarget) => createDOMExceptionObject(realm, newTarget, 'Error'),
  );
  registry.setConstructorSteps(
    getConstructor(domExceptionIDL),
    function(message, name) {
      const state = getDOMExceptionState(this);
      state.message = message as string;
      state.name = name as string;
    },
  );
  registry.setAttributeSteps(getAttribute(domExceptionIDL, 'name'), {
    get() { return getDOMExceptionState(this).name; },
  });
  registry.setAttributeSteps(getAttribute(domExceptionIDL, 'message'), {
    get() { return getDOMExceptionState(this).message; },
  });
  registry.setAttributeSteps(getAttribute(domExceptionIDL, 'code'), {
    get() {
      return legacyCodesByName.get(getDOMExceptionState(this).name) ?? 0;
    },
  });

  registry.setObjectCreationSteps(
    quotaExceededErrorIDL,
    (newTarget) => {
      const object = createDOMExceptionObject(
        realm,
        newTarget,
        'QuotaExceededError',
      );
      quotaExceededErrorStates.set(object, {
        quota: null,
        requested: null,
      });
      return object;
    },
  );
  registry.setConstructorSteps(
    getConstructor(quotaExceededErrorIDL),
    function(message, options) {
      const domExceptionState = getDOMExceptionState(this);
      const state = getQuotaExceededErrorState(this);
      const values = options as Map<string, unknown>;
      const quota = values.get('quota') as number | undefined;
      const requested = values.get('requested') as number | undefined;

      domExceptionState.name = 'QuotaExceededError';
      domExceptionState.message = message as string;
      if (quota !== undefined) {
        if (quota < 0) throw new realm.intrinsics.rangeError();
        state.quota = quota;
      }
      if (requested !== undefined) {
        if (requested < 0) throw new realm.intrinsics.rangeError();
        state.requested = requested;
      }
      if (
        state.quota !== null &&
        state.requested !== null &&
        state.requested < state.quota
      ) {
        throw new realm.intrinsics.rangeError();
      }
    },
  );
  registry.setAttributeSteps(getAttribute(quotaExceededErrorIDL, 'quota'), {
    get() { return getQuotaExceededErrorState(this).quota; },
  });
  registry.setAttributeSteps(
    getAttribute(quotaExceededErrorIDL, 'requested'),
    { get() { return getQuotaExceededErrorState(this).requested; } },
  );
}

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

function getConstructor(interface_: InterfaceDefinition): ConstructorMember {
  const constructor = interface_.members.find(
    (member) => member.kind === 'constructor',
  );
  if (!constructor) {
    throw new Error(`${interface_.name} constructor IDL is missing`);
  }
  return constructor;
}

function getAttribute(
  interface_: InterfaceDefinition,
  name: string,
): AttributeMember {
  const attribute = interface_.members.find(
    (member) => member.kind === 'attribute' && member.name === name,
  );
  if (!attribute || attribute.kind !== 'attribute') {
    throw new Error(`${interface_.name} ${name} attribute IDL is missing`);
  }
  return attribute;
}
