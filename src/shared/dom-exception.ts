// Web IDL §2.8.1 Base DOMException error names

export const domExceptionName = {
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

export const domExceptionCode = {
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
} as const satisfies Record<keyof typeof domExceptionName, number>;

export type DOMExceptionName = typeof domExceptionName[
  keyof typeof domExceptionName
];

type DOMExceptionRequest = {
  message: string;
  name: DOMExceptionName;
};

/*
 * Keep one request table across specification implementations and every realm
 * binding in this runtime. A per-realm table would break borrowed cross-realm
 * calls; moving ownership to a host would require injecting that same table
 * into every implementation package that can request a DOMException.
 */
const domExceptionRequests = new WeakMap<object, DOMExceptionRequest>();

/*
 * Keep specification-requested DOMExceptions distinguishable from arbitrary
 * exceptions thrown by implementation or author code. An unbound caller still
 * receives a native DOMException; a Web IDL binding can use the invisible
 * request record to recreate it in the function's current realm.
 */
export function throwDOMException(
  name: DOMExceptionName,
  message = '',
): never {
  throw createDOMException(name, message);
}

export function createDOMException(
  name: DOMExceptionName,
  message = '',
): DOMException {
  const exception = new DOMException(message, name);
  domExceptionRequests.set(exception, { message, name });
  return exception;
}

export function getDOMExceptionRequest(
  value: unknown,
): DOMExceptionRequest | undefined {
  return typeof value === 'object' && value !== null
    ? domExceptionRequests.get(value)
    : undefined;
}
