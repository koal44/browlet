import {
  XML_NAMESPACE, XMLNS_NAMESPACE,
} from '../../../infra/index';
import { DOMExceptionNames, DOMExceptionImpl } from '../../../web-idl/core/index';

const INVALID_NAMESPACE_PREFIX_RE = /[\t\n\f\r \0/>]/;
const INVALID_ATTRIBUTE_LOCAL_NAME_RE = /[\t\n\f\r \0/=>]/;
const VALID_ELEMENT_LOCAL_NAME_RE = /^(?:[A-Za-z][^\0\t\n\f\r\u0020/>]*|[:_\u0080-\u{10FFFF}][A-Za-z0-9-.:_\u0080-\u{10FFFF}]*)$/u;
const INVALID_DOCTYPE_NAME_RE = /[\t\n\f\r \0>]/;

/** Check the DOM syntax for a nonempty namespace prefix. */
// https://dom.spec.whatwg.org/#valid-namespace-prefix
export function isValidNamespacePrefix(value: string): boolean {
  return value.length > 0 && !INVALID_NAMESPACE_PREFIX_RE.test(value);
}

/** Check the DOM syntax for a nonempty attribute local name. */
// https://dom.spec.whatwg.org/#valid-attribute-local-name
export function isValidAttributeLocalName(value: string): boolean {
  return value.length > 0 && !INVALID_ATTRIBUTE_LOCAL_NAME_RE.test(value);
}

/** Check the DOM element-name grammar, including its first-character restrictions. */
// https://dom.spec.whatwg.org/#valid-element-local-name
export function isValidElementLocalName(value: string): boolean {
  return VALID_ELEMENT_LOCAL_NAME_RE.test(value);
}

/** Check that a doctype name contains no forbidden delimiters. */
// https://dom.spec.whatwg.org/#valid-doctype-name
export function isValidDoctypeName(value: string): boolean {
  return !INVALID_DOCTYPE_NAME_RE.test(value);
}

/** Validate a qualified name and return its namespace, prefix, and local name. */
// https://dom.spec.whatwg.org/#validate-and-extract
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
      throw new DOMExceptionImpl(
        `Invalid namespace prefix ${JSON.stringify(prefix)}`,
        DOMExceptionNames.invalidCharacter,
      );
    }
  }

  const validLocalName = context === 'attribute'
    ? isValidAttributeLocalName(localName)
    : isValidElementLocalName(localName);

  if (!validLocalName) {
    throw new DOMExceptionImpl(
      `Invalid ${context} local name ${JSON.stringify(localName)}`,
      DOMExceptionNames.invalidCharacter,
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

function throwNamespaceError(
  qualifiedName: string,
  namespace: string | null,
): never {
  throw new DOMExceptionImpl(
    `Qualified name ${JSON.stringify(qualifiedName)} is not valid for namespace ${JSON.stringify(namespace)}`,
    DOMExceptionNames.namespace,
  );
}
