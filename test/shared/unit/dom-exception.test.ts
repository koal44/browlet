import { describe, expect, it } from 'vitest';

import {
  domExceptionCode, domExceptionName,
} from '../../../src/shared/dom-exception';

describe('DOMException names', () => {
  it('follows the Web IDL names table and legacy code order', () => {
    expect(Object.entries(domExceptionName)).toEqual([
      ['indexSize', 'IndexSizeError'],
      ['hierarchyRequest', 'HierarchyRequestError'],
      ['wrongDocument', 'WrongDocumentError'],
      ['invalidCharacter', 'InvalidCharacterError'],
      ['noModificationAllowed', 'NoModificationAllowedError'],
      ['notFound', 'NotFoundError'],
      ['notSupported', 'NotSupportedError'],
      ['inUseAttribute', 'InUseAttributeError'],
      ['invalidState', 'InvalidStateError'],
      ['syntax', 'SyntaxError'],
      ['invalidModification', 'InvalidModificationError'],
      ['namespace', 'NamespaceError'],
      ['invalidAccess', 'InvalidAccessError'],
      ['typeMismatch', 'TypeMismatchError'],
      ['security', 'SecurityError'],
      ['network', 'NetworkError'],
      ['abort', 'AbortError'],
      ['urlMismatch', 'URLMismatchError'],
      ['quotaExceeded', 'QuotaExceededError'],
      ['timeout', 'TimeoutError'],
      ['invalidNodeType', 'InvalidNodeTypeError'],
      ['dataClone', 'DataCloneError'],
      ['encoding', 'EncodingError'],
      ['notReadable', 'NotReadableError'],
      ['unknown', 'UnknownError'],
      ['constraint', 'ConstraintError'],
      ['data', 'DataError'],
      ['transactionInactive', 'TransactionInactiveError'],
      ['readOnly', 'ReadOnlyError'],
      ['version', 'VersionError'],
      ['operation', 'OperationError'],
      ['notAllowed', 'NotAllowedError'],
      ['optOut', 'OptOutError'],
    ]);

    expect(Object.values(domExceptionCode)).toEqual([
      1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21,
      22, 23, 24, 25,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});
