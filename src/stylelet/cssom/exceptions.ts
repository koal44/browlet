export const domExceptionName = {
  indexSize: 'IndexSizeError',
  domStringSize: 'DOMStringSizeError',
  hierarchyRequest: 'HierarchyRequestError',
  wrongDocument: 'WrongDocumentError',
  notAllowed: 'NotAllowedError',
  invalidCharacter: 'InvalidCharacterError',
  noDataAllowed: 'NoDataAllowedError',
  noModificationAllowed: 'NoModificationAllowedError',
  notFound: 'NotFoundError',
  notSupported: 'NotSupportedError',
  inUseAttribute: 'InUseAttributeError',
  invalidState: 'InvalidStateError',
  syntax: 'SyntaxError',
  invalidModification: 'InvalidModificationError',
  namespace: 'NamespaceError',
  invalidAccess: 'InvalidAccessError',
  validation: 'ValidationError',
  typeMismatch: 'TypeMismatchError',
  security: 'SecurityError',
  network: 'NetworkError',
  abort: 'AbortError',
  urlMismatch: 'URLMismatchError',
  quotaExceeded: 'QuotaExceededError',
  timeout: 'TimeoutError',
  invalidNodeType: 'InvalidNodeTypeError',
  dataClone: 'DataCloneError',
} as const;

export function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented`);
}
