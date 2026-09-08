import { utf8Encode } from '../../encoding/utf-8';
import { forgivingBase64Encode } from '../../infra/base64';

import type {
  StructuredBareItem, StructuredField, StructuredInnerList, StructuredItem,
  StructuredParameters,
} from './values';

/*
 * RFC 9651 §4.1, Serializing Structured Fields.
 *
 * undefined means omit the empty List/Dictionary field; null means failure.
 * The input records are not mutated.
 * https://www.rfc-editor.org/rfc/rfc9651.html#section-4.1
 */
// SPEC_MISMATCH: (structure) -> ASCII bytes
export function serializeStructuredField(
  field: StructuredField,
): string | null | undefined {
  switch (field.type) {
    case 'list': {
      if (field.members.length === 0) return undefined;
      const output: string[] = [];
      for (const member of field.members) {
        const value = serializeMember(member);
        if (value === null) return null;
        output.push(value);
      }
      return output.join(', ');
    }
    case 'dictionary': {
      if (field.members.size === 0) return undefined;
      const output: string[] = [];
      for (const [key, member] of field.members) {
        if (!isKey(key)) return null;
        if (
          member.type === 'item' &&
          member.value.type === 'boolean' && member.value.value
        ) {
          const parameters = serializeParameters(member.parameters);
          if (parameters === null) return null;
          output.push(key + parameters);
        } else {
          const value = serializeMember(member);
          if (value === null) return null;
          output.push(`${key}=${value}`);
        }
      }
      return output.join(', ');
    }
    case 'item':
      return serializeMember(field);
  }
}

/** RFC 9651 §4.1.1.1 and §4.1.3, Inner Lists and Items. */
// SPEC_MISMATCH: (inner_list, list_parameters) / (bare_item, item_parameters) -> ASCII string
function serializeMember(member: StructuredItem | StructuredInnerList): string | null {
  let value: string | null;
  if (member.type === 'inner-list') {
    const items: string[] = [];
    for (const item of member.items) {
      const serialized = serializeMember(item);
      if (serialized === null) return null;
      items.push(serialized);
    }
    value = `(${items.join(' ')})`;
  } else {
    value = serializeBareItem(member.value);
    if (value === null) return null;
  }

  const parameters = serializeParameters(member.parameters);
  return parameters === null ? null : value + parameters;
}

/** RFC 9651 §4.1.1.2, Parameters. */
function serializeParameters(parameters: StructuredParameters): string | null {
  let output = '';
  for (const [key, value] of parameters) {
    if (!isKey(key)) return null;
    output += `;${key}`;
    if (value.type === 'boolean' && value.value) continue;
    const serialized = serializeBareItem(value);
    if (serialized === null) return null;
    output += `=${serialized}`;
  }
  return output;
}

/** RFC 9651 §4.1.1.3, Key character constraints. */
function isKey(key: string): boolean {
  return /^[a-z*]/.test(key) && !/[^a-z0-9_.*-]/.test(key);
}

/** RFC 9651 §4.1.3.1 and §4.1.4–§4.1.11, Bare Items. */
function serializeBareItem(item: StructuredBareItem): string | null {
  switch (item.type) {
    case 'integer':
      return serializeInteger(item.value);
    case 'decimal':
      return serializeDecimal(item.value);
    case 'string':
      if (/[^\x20-\x7e]/.test(item.value)) return null;
      return `"${item.value.replace(/["\\]/g, '\\$&')}"`;
    case 'token':
      if (
        !/^[A-Za-z*]/.test(item.value) ||
        /[^A-Za-z0-9!#$%&'*+\-.^_`|~:/]/.test(item.value)
      ) return null;
      return item.value;
    case 'bytes':
      return `:${forgivingBase64Encode(item.value)}:`;
    case 'boolean':
      return item.value ? '?1' : '?0';
    case 'date': {
      const seconds = serializeInteger(item.value);
      return seconds === null ? null : `@${seconds}`;
    }
    case 'display-string':
      return serializeDisplayString(item.value);
  }
}

function serializeInteger(value: number): string | null {
  if (!Number.isInteger(value) || Math.abs(value) > 999_999_999_999_999) {
    return null;
  }
  return String(value);
}

function serializeDecimal(value: number): string | null {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(value) || magnitude >= 1_000_000_000_000) return null;
  if (magnitude <= 0.0005) return '0.0';

  // Remaining magnitudes have no exponent in their shortest decimal spelling.
  // Round those digits, avoiding binary multiplication changing a decimal tie.
  const [integer, fraction = ''] = String(magnitude).split('.');
  let thousandths = Number(integer) * 1000 +
    Number(fraction.padEnd(3, '0').slice(0, 3));
  const discarded = fraction.slice(3);
  if (
    discarded[0] !== undefined && (
      discarded[0] > '5' ||
      discarded[0] === '5' && (
        /[1-9]/.test(discarded.slice(1)) || thousandths % 2 !== 0
      )
    )
  ) thousandths++;

  if (thousandths > 999_999_999_999_999) return null;
  const whole = Math.floor(thousandths / 1000);
  const fractional = String(thousandths % 1000).padStart(3, '0')
    .replace(/0+$/, '') || '0';
  return `${value < 0 ? '-' : ''}${whole}.${fractional}`;
}

function serializeDisplayString(value: string): string | null {
  if (!value.isWellFormed()) return null;
  let output = '%"';
  for (const byte of utf8Encode(value)) {
    output += byte === 0x25 || byte === 0x22 || byte < 0x20 || byte > 0x7e
      ? `%${byte.toString(16).padStart(2, '0')}`
      : String.fromCharCode(byte);
  }
  return output + '"';
}
