import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseStructuredField, serializeStructuredField, type StructuredBareItem,
  type StructuredField, type StructuredInnerList, type StructuredItem,
} from '../../src/http/structured-fields';

describe('HTTPWG structured-field parsing fixtures', () => {
  const fixtureDirectory = join(__dirname, './fixtures/httpwg/parsing-tests');

  for (const filename of readdirSync(fixtureDirectory)) {
    const fixtures = readFixtures(join(fixtureDirectory, filename));
    describe(filename, () => {
      for (const fixture of fixtures) {
        it(fixture.name, () => {
          const input = new TextEncoder().encode(fixture.raw!.join(', '));
          const actual = parseStructuredField(input, fixture.header_type);
          if (fixture.must_fail) {
            expect(actual).toBeNull();
          } else if (actual !== null || !fixture.can_fail) {
            // can_fail is an RFC-permitted outcome in the upstream corpus,
            // not an expected-failure classification for a known defect.
            expect(actual).toEqual(fromFixture(fixture));
          }
        });

        if (!fixture.must_fail) {
          it(`serializes the expected value: ${fixture.name}`, () => {
            // Serialize the independent fixture value, not our parser's result.
            const actual = serializeStructuredField(fromFixture(fixture));
            const canonical = fixture.canonical ?? fixture.raw!;
            expect(actual).toBe(canonical.length === 0 ? undefined : canonical.join(', '));
          });
        }
      }
    });
  }
});

describe('HTTPWG structured-field serialization fixtures', () => {
  const fixtureDirectory = join(__dirname, './fixtures/httpwg/serialisation-tests');

  for (const filename of readdirSync(fixtureDirectory)) {
    const fixtures = readFixtures(join(fixtureDirectory, filename));
    describe(filename, () => {
      for (const fixture of fixtures) {
        it(fixture.name, () => {
          const actual = serializeStructuredField(fromFixture(fixture));
          if (fixture.must_fail) {
            expect(actual).toBeNull();
          } else {
            expect(actual === undefined ? [] : [actual]).toEqual(fixture.canonical);
          }
        });
      }
    });
  }
});

function readFixtures(filename: string): Fixture[] {
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

function fromFixture(fixture: Fixture): StructuredField {
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

type Fixture = {
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

function fromItem([bareItem, parameters]: FixtureItem): StructuredItem {
  return {
    type: 'item', bareItem: fromBareItem(bareItem),
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
