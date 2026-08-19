import { describe, expect, it } from 'vitest';

import {
  isValidAttributeLocalName, isValidDoctypeName, isValidElementLocalName,
  isValidNamespacePrefix, validateAndExtract,
  XML_NAMESPACE, XMLNS_NAMESPACE,
} from '../../../../src/domlet/algorithms/name-validation';

describe('DOM name validation', () => {
  it('validates namespace prefixes', () => {
    expect(isValidNamespacePrefix('prefix')).toBe(true);
    expect(isValidNamespacePrefix('prefix:name=value')).toBe(true);

    for (const value of ['', 'prefix name', 'prefix/name', 'prefix>name', 'prefix\0name']) {
      expect(isValidNamespacePrefix(value)).toBe(false);
    }
  });

  it('validates attribute local names', () => {
    expect(isValidAttributeLocalName('name')).toBe(true);
    expect(isValidAttributeLocalName('prefix:name')).toBe(true);
    expect(isValidAttributeLocalName('name<value')).toBe(true);

    for (const value of ['', 'name value', 'name/value', 'name=value', 'name>value', 'name\0value']) {
      expect(isValidAttributeLocalName(value)).toBe(false);
    }
  });

  it('validates element local names', () => {
    for (const value of ['div', 'a=b?', '_name', ':name', '\u0080name', '\ud800']) {
      expect(isValidElementLocalName(value)).toBe(true);
    }

    for (const value of ['', '1name', '-name', '.name', '_name?', 'a name', 'a/name', 'a>name', 'a\0name']) {
      expect(isValidElementLocalName(value)).toBe(false);
    }
  });

  it('validates doctype names', () => {
    for (const value of ['', 'html', 'html/name=value']) {
      expect(isValidDoctypeName(value)).toBe(true);
    }

    for (const value of ['html name', 'html>name', 'html\0name']) {
      expect(isValidDoctypeName(value)).toBe(false);
    }
  });

  it('extracts namespaces, prefixes, and local names', () => {
    expect(validateAndExtract('', 'name', 'element'))
      .toEqual([null, null, 'name']);
    expect(validateAndExtract('urn:test', 'prefix:name:tail', 'element'))
      .toEqual(['urn:test', 'prefix', 'name:tail']);
    expect(validateAndExtract(XML_NAMESPACE, 'xml:lang', 'attribute'))
      .toEqual([XML_NAMESPACE, 'xml', 'lang']);
    expect(validateAndExtract(XMLNS_NAMESPACE, 'xmlns', 'attribute'))
      .toEqual([XMLNS_NAMESPACE, null, 'xmlns']);
    expect(validateAndExtract(XMLNS_NAMESPACE, 'xmlns:name', 'attribute'))
      .toEqual([XMLNS_NAMESPACE, 'xmlns', 'name']);
  });

  it('rejects invalid extracted names', () => {
    expectError(() => validateAndExtract('urn:test', ':name', 'element'), 'InvalidCharacterError');
    expectError(() => validateAndExtract('urn:test', 'prefix:', 'element'), 'InvalidCharacterError');
    expectError(() => validateAndExtract('urn:test', 'prefix:name=value', 'attribute'), 'InvalidCharacterError');
  });

  it('enforces namespace constraints', () => {
    expectError(() => validateAndExtract(null, 'prefix:name', 'element'), 'NamespaceError');
    expectError(() => validateAndExtract('urn:test', 'xml:lang', 'attribute'), 'NamespaceError');
    expectError(() => validateAndExtract('urn:test', 'xmlns', 'attribute'), 'NamespaceError');
    expectError(() => validateAndExtract('urn:test', 'xmlns:name', 'attribute'), 'NamespaceError');
    expectError(() => validateAndExtract(XMLNS_NAMESPACE, 'name', 'attribute'), 'NamespaceError');
  });
});

function expectError(callback: () => unknown, name: string): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe(name);
    return;
  }

  throw new Error(`Expected ${name}`);
}
