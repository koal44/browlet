// DOM §1.4 Name validation

import { domExceptionName } from '../shared/dom-exception';

const INVALID_NAMESPACE_PREFIX_RE = /[\t\n\f\r \0/>]/;
const INVALID_ATTRIBUTE_LOCAL_NAME_RE = /[\t\n\f\r \0/=>]/;
const VALID_ELEMENT_LOCAL_NAME_RE = /^(?:[A-Za-z][^\0\t\n\f\r\u0020/>]*|[:_\u0080-\u{10FFFF}][A-Za-z0-9-.:_\u0080-\u{10FFFF}]*)$/u;
const INVALID_DOCTYPE_NAME_RE = /[\t\n\f\r \0>]/;

export function isValidNamespacePrefix(value: string): boolean {
  return value.length > 0 && !INVALID_NAMESPACE_PREFIX_RE.test(value);
}

export function isValidAttributeLocalName(value: string): boolean {
  return value.length > 0 && !INVALID_ATTRIBUTE_LOCAL_NAME_RE.test(value);
}

export function isValidElementLocalName(value: string): boolean {
  return VALID_ELEMENT_LOCAL_NAME_RE.test(value);
}

export function isValidDoctypeName(value: string): boolean {
  return !INVALID_DOCTYPE_NAME_RE.test(value);
}

export function validateAndExtract(
  namespace: string | null,
  qualifiedName: string,
  context: 'attribute' | 'element',
): [namespace: string | null, prefix: string | null, localName: string] {
  if (namespace === '') namespace = null;

  let prefix: string | null = null;
  let localName = qualifiedName;
  const colon = qualifiedName.indexOf(':');

  if (colon >= 0) {
    prefix = qualifiedName.slice(0, colon);
    localName = qualifiedName.slice(colon + 1);

    if (!isValidNamespacePrefix(prefix)) {
      throw new DOMException(
        `Invalid namespace prefix ${JSON.stringify(prefix)}`,
        domExceptionName.invalidCharacter,
      );
    }
  }

  const validLocalName = context === 'attribute'
    ? isValidAttributeLocalName(localName)
    : isValidElementLocalName(localName);

  if (!validLocalName) {
    throw new DOMException(
      `Invalid ${context} local name ${JSON.stringify(localName)}`,
      domExceptionName.invalidCharacter,
    );
  }

  if (prefix !== null && namespace === null) {
    throwNamespaceError(qualifiedName, namespace);
  }

  if (prefix === 'xml' && namespace !== XML_NAMESPACE) {
    throwNamespaceError(qualifiedName, namespace);
  }

  if (
    (qualifiedName === 'xmlns' || prefix === 'xmlns') &&
    namespace !== XMLNS_NAMESPACE
  ) {
    throwNamespaceError(qualifiedName, namespace);
  }

  if (
    namespace === XMLNS_NAMESPACE &&
    qualifiedName !== 'xmlns' &&
    prefix !== 'xmlns'
  ) {
    throwNamespaceError(qualifiedName, namespace);
  }

  return [namespace, prefix, localName];
}

export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

function throwNamespaceError(
  qualifiedName: string,
  namespace: string | null,
): never {
  throw new DOMException(
    `Qualified name ${JSON.stringify(qualifiedName)} is not valid for namespace ${JSON.stringify(namespace)}`,
    domExceptionName.namespace,
  );
}
