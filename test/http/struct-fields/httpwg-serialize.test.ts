import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { serializeStructuredField } from '../../../src/http/struct-fields';
import { fromFixture, readFixtures } from './fixtures';

const fixtureDirectory = join(__dirname, './fixtures/httpwg/serialisation-tests');

describe('HTTPWG structured-field serialization fixtures', () => {
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
