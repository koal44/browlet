import {
  XML_NAMESPACE, XMLNS_NAMESPACE,
} from '../../../infra/index';
import { DOMExceptionNames, DOMExceptionImpl } from '../../../web-idl/core/index';

const INVALID_NAMESPACE_PREFIX_RE = /[\t\n\f\r \0/>]/;
const INVALID_ATTRIBUTE_LOCAL_NAME_RE = /[\t\n\f\r \0/=>]/;
const VALID_ELEMENT_LOCAL_NAME_RE = /^(?:[A-Za-z][^\0\t\n\f\r\u0020/>]*|[:_\u0080-\u{10FFFF}][A-Za-z0-9-.:_\u0080-\u{10FFFF}]*)$/u;
const INVALID_DOCTYPE_NAME_RE = /[\t\n\f\r \0>]/;
// XML 1.0 (Fifth Edition), NameStartChar and NameChar. Unlike DOM local names,
// these productions stop at U+EFFFF and exclude surrogate code points.
const XML_NAME_START = ':A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D' +
  '\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF' +
  '\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const XML_NAME_RE = new RegExp(
  // eslint-disable-next-line no-misleading-character-class -- XML NameChar deliberately includes combining characters.
  `^[${XML_NAME_START}][${XML_NAME_START}.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040-]*$`, 'u',
);

/** Check the XML Name production used by processing-instruction targets and pseudo-attributes. */
// https://www.w3.org/TR/xml/#NT-Name
export function isXMLName(value: string): boolean {
  return XML_NAME_RE.test(value);
}

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
