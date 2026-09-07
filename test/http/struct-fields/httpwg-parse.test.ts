import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseStructuredField, serializeStructuredField } from '../../../src/http/struct-fields';
import { fromFixture, readFixtures } from './fixtures';

const fixtureDirectory = join(__dirname, './fixtures/httpwg/parsing-tests');

describe('HTTPWG structured-field parsing fixtures', () => {
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
