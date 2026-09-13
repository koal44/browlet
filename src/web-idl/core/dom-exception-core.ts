// Web IDL §2.8 Exceptions and §2.8.1 Base DOMException error names

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

/*
 * Keep specification-requested DOMExceptions distinguishable from arbitrary
 * exceptions thrown by implementation or author code. The binding uses this
 * native exception's name and message to create the realm-owned platform object.
 */
export class DOMException extends globalThis.DOMException {
  #brand: undefined;

  static is(value: unknown): value is DOMException {
    return typeof value === 'object' && value !== null && #brand in value;
  }
}

// Project adapter: throw an internal DOMException for later realm realization.
// Supports Web IDL §3.14.3 Creating and throwing exceptions.
export function throwDOMException(
  name: DOMExceptionName,
  message = '',
): never {
  throw createDOMException(name, message);
}

// Project adapter: create a distinguishable native DOMException subclass.
// Supports Web IDL §3.14.3 Creating and throwing exceptions; realm realization occurs at the binding boundary.
export function createDOMException(
  name: DOMExceptionName,
  message = '',
): DOMException {
  return new DOMException(message, name);
}
