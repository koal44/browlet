import { readFileSync } from 'node:fs';

import type {
  StructuredBareItem, StructuredField, StructuredInnerList, StructuredItem,
} from '../../../src/http/struct-fields';

export function readFixtures(filename: string): Fixture[] {
  // The native reviver's source text distinguishes JSON 1.0 from JSON 1.
  return JSON.parse(readFileSync(filename, 'utf8'), (
    _key: string, value: unknown, context?: { source: string; },
  ) => {
    if (typeof value === 'number' && /[.eE]/.test(context!.source)) {
      return { __type: 'decimal', value };
    }
    return value;
  }) as Fixture[];
}

export function fromFixture(fixture: Fixture): StructuredField {
  switch (fixture.header_type) {
    case 'item':
      return fromItem(fixture.expected!);
    case 'list':
      return { type: 'list', members: fixture.expected!.map(fromMember) };
    case 'dictionary':
      return {
        type: 'dictionary',
        members: new Map(fixture.expected!.map(([key, value]) => [key, fromMember(value)])),
      };
  }
}

export type Fixture = {
  name: string;
  raw?: string[];
  canonical?: string[];
  must_fail?: boolean;
  can_fail?: boolean;
} & (
  | { header_type: 'item'; expected?: FixtureItem; }
  | { header_type: 'list'; expected?: FixtureMember[]; }
  | { header_type: 'dictionary'; expected?: [string, FixtureMember][]; }
);

type FixtureItem = [FixtureBareItem, [string, FixtureBareItem][]];
type FixtureMember = [FixtureBareItem | FixtureItem[], [string, FixtureBareItem][]];
type FixtureBareItem = number | string | boolean
  | { __type: 'decimal' | 'date'; value: number; }
  | { __type: 'token' | 'binary' | 'displaystring'; value: string; };

function fromMember([value, parameters]: FixtureMember): StructuredItem | StructuredInnerList {
  return Array.isArray(value)
    ? {
      type: 'inner-list', items: value.map(fromItem),
      parameters: new Map(parameters.map(([key, value]) => [key, fromBareItem(value)])),
    }
    : fromItem([value, parameters]);
}

function fromItem([value, parameters]: FixtureItem): StructuredItem {
  return {
    type: 'item', value: fromBareItem(value),
    parameters: new Map(parameters.map(([key, value]) => [key, fromBareItem(value)])),
  };
}

function fromBareItem(value: FixtureBareItem): StructuredBareItem {
  switch (typeof value) {
    case 'number': return { type: 'integer', value };
    case 'string': return { type: 'string', value };
    case 'boolean': return { type: 'boolean', value };
  }
  switch (value.__type) {
    case 'decimal': return { type: 'decimal', value: value.value };
    case 'date': return { type: 'date', value: value.value };
    case 'token': return { type: 'token', value: value.value };
    case 'displaystring': return { type: 'display-string', value: value.value };
    case 'binary': return { type: 'bytes', value: decodeBase32(value.value) };
  }
}

// The fixtures encode binary values in Base32, independently of the field's
// Base64 wire representation. This decoder only reads upstream fixture data.
function decodeBase32(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input.replace(/=+$/, '')) {
    const value = alphabet.indexOf(char);
    if (value === -1) throw new Error('Invalid Base32 fixture');
    buffer = buffer << 5 | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(buffer >> bits & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}
