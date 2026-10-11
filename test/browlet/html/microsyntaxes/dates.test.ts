import { describe, expect, it } from 'vitest';

import {
  parseYearMonth, parseCalendarDate, parseMonthDay, parseClockTime, parseLocalDateTime,
  parseUtcOffsetMinutes, parseOffsetDateTime, parseYearWeek, parseDurationSeconds, parseDateOrTime,
  isValidClockTimeSyntax, isValidLocalDateTimeSyntax, isValidUtcOffsetSyntax, isValidOffsetDateTimeSyntax,
  isValidDurationSyntax, isValidDateWithOptionalTimeSyntax, normalizeLocalDateTime,
  getDaysInMonth, getWeeksInYear,
} from '../../../../src/browlet/html/microsyntaxes/index';

describe('HTML date/time contracts', () => {
  describe('HTML months and Gregorian dates', () => {
    it('uses the Gregorian month lengths and century leap-year rules', () => {
      expect(Array.from({ length: 12 }, (_, month) => getDaysInMonth(month + 1, 2026n)))
        .toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
      for (const year of [4n, 400n, 1600n, 2000n, 2024n, 9007199254740992n]) {
        expect(getDaysInMonth(2, year)).toBe(29);
      }
      for (const year of [1n, 100n, 1900n, 2100n, 2026n, 9007199254740993n]) {
        expect(getDaysInMonth(2, year)).toBe(28);
      }
    });

    it.each([
      ['0001-01', 1n, 1], ['2026-12', 2026n, 12], ['00002026-02', 2026n, 2],
      ['1000000-03', 1000000n, 3], ['9007199254740993-04', 9007199254740993n, 4],
    ])('parses the complete month %j', (input, year, month) => {
      expect(parseYearMonth(input)).toEqual({ year, month });
    });

    it.each([
      '', '2026', '026-01', '0000-01', '-0001-01', '+2026-01', '2026-00', '2026-13',
      '2026-1', '2026-001', '2026-01-01', '2026-01x', ' 2026-01', '2026-01\n', '２０２６-01',
    ])('rejects the incomplete or invalid month %j', (input) => {
      expect(parseYearMonth(input)).toBeNull();
    });

    it.each([
      ['0001-01-01', 1n, 1, 1], ['0004-02-29', 4n, 2, 29], ['2000-02-29', 2000n, 2, 29],
      ['1900-02-28', 1900n, 2, 28], ['2026-12-31', 2026n, 12, 31],
      ['275760-09-14', 275760n, 9, 14], ['1000000-02-29', 1000000n, 2, 29],
      ['9007199254740992-02-29', 9007199254740992n, 2, 29],
    ])('parses the complete date %j', (input, year, month, day) => {
      expect(parseCalendarDate(input)).toEqual({ year, month, day });
    });

    it.each([
      '', '2026-01', '2026-01-1', '2026-01-001', '2026-00-01', '2026-13-01',
      '2026-01-00', '2026-01-32', '2026-04-31', '1900-02-29', '2100-02-29',
      '2026-02-29', '9007199254740993-02-29', '2026-01-01T00:00',
      '2026-01-01Z', '2026-01-01 ', '\t2026-01-01', '0000-01-01',
    ])('rejects the incomplete or impossible date %j', (input) => {
      expect(parseCalendarDate(input)).toBeNull();
    });

    it('keeps short and long years exact across the four-digit conversion path', () => {
      for (const digits of ['0001', '2026', '9999', '00001', '10000', '9007199254740993']) {
        expect(parseYearMonth(`${digits}-12`)).toEqual({ year: BigInt(digits), month: 12 });
      }
      expect(parseYearMonth('999-12')).toBeNull();
      expect(parseYearMonth('0000-12')).toBeNull();
      expect(parseYearMonth('00000-12')).toBeNull();
    });

    it('does not round or cap an unbounded year', () => {
      const year = `1${'0'.repeat(400)}`;
      expect(parseCalendarDate(`${year}-02-29`)).toEqual({ year: 10n ** 400n, month: 2, day: 29 });
      expect(parseCalendarDate(`${year.slice(0, -1)}1-02-29`)).toBeNull();
    });
  });

  describe('HTML yearless dates', () => {
    it.each([
      ['01-01', 1, 1], ['--01-01', 1, 1], ['02-29', 2, 29], ['--02-29', 2, 29], ['12-31', 12, 31],
    ])('parses %j', (input, month, day) => {
      expect(parseMonthDay(input)).toEqual({ month, day });
    });

    it.each([
      '', '-01-01', '---01-01', '----01-01', '1-01', '001-01', '00-01', '13-01',
      '01-00', '01-32', '02-30', '04-31', '01-1', '01-001', '2026-01-01', '01-01\n', ' 01-01',
    ])('rejects %j', (input) => {
      expect(parseMonthDay(input)).toBeNull();
    });
  });

  describe('HTML times', () => {
    it.each([
      ['00:00', 0, 0, 0, ''], ['23:59', 23, 59, 0, ''], ['12:34:56', 12, 34, 56, ''],
      ['12:34:00.1', 12, 34, 0, '1'], ['12:34:01.01', 12, 34, 1, '01'],
      ['12:34:59.999', 12, 34, 59, '999'], ['12:34:00.000', 12, 34, 0, '000'],
    ])('parses valid time syntax %j', (input, hour, minute, second, fractionDigits) => {
      expect(parseClockTime(input)).toEqual({ hour, minute, second, fractionDigits });
      expect(isValidClockTimeSyntax(input)).toBe(true);
    });

    it('preserves fractional precision at the next-second boundary and below double range', () => {
      expect(parseClockTime('12:34:59.999999999999999999')).toEqual({
        hour: 12, minute: 34, second: 59, fractionDigits: '999999999999999999',
      });
      const fractionDigits = `${'0'.repeat(400)}1`;
      expect(parseClockTime(`12:34:00.${fractionDigits}`)).toEqual({ hour: 12, minute: 34, second: 0, fractionDigits });
    });

    it.each(['12:34:56.1234', '12:34:00.0000', '12:34:59.999999999999999999'])(
      'distinguishes permissive parsing from authoring validity for %j', (input) => {
        expect(parseClockTime(input)).not.toBeNull();
        expect(isValidClockTimeSyntax(input)).toBe(false);
      },
    );

    it.each([
      '', '1:00', '001:00', '12:0', '12:000', '24:00', '12:60', '12:34:', '12:34:5',
      '12:34:056', '12:34:60', '12:34:61', '12:34:56.', '12:34:56..1', '12:34:56.1.2',
      '12:34:.1', '12:34.5', '12:34:56e0', '12:34Z', '12:34+00:00', ' 12:34', '12:34\n', '１２:34',
    ])('rejects malformed, out-of-range, or partially consumed time %j', (input) => {
      expect(parseClockTime(input)).toBeNull();
      expect(isValidClockTimeSyntax(input)).toBe(false);
    });
  });

  describe('HTML local date-times', () => {
    it('returns flat combined fields without limiting years or fractional precision', () => {
      expect(parseLocalDateTime('9007199254740993-12-31T23:59:59.999999999999999999')).toEqual({
        year: 9007199254740993n, month: 12, day: 31,
        hour: 23, minute: 59, second: 59, fractionDigits: '999999999999999999',
      });
      expect(parseDateOrTime('0001-01-01T00:00:00.010+00:01')).toEqual({
        kind: 'offsetDateTime', value: {
          utc: { year: 0n, month: 12, day: 31, hour: 23, minute: 59, second: 0, fractionDigits: '010' },
          offsetMinutes: 1,
        },
      });
    });

    it.each(['2026-10-10T12:34:56.12', '2026-10-10 12:34:56.12'])(
      'parses the local date-time %j without a host time zone', (input) => {
        expect(parseLocalDateTime(input)).toEqual({
          year: 2026n, month: 10, day: 10, hour: 12, minute: 34, second: 56, fractionDigits: '12',
        });
        expect(isValidLocalDateTimeSyntax(input)).toBe(true);
      },
    );

    it.each([
      '2026-10-10', '2026-10-10T', '2026-10-10t12:34', '2026-10-10  12:34',
      '2026-10-10\t12:34', '2026-10-10T12:34Z', '2026-10-10T12:34+00:00',
      '2026-02-29T12:34', '2026-10-10T24:00', '2026-10-10T12:34\n',
    ])('rejects %j', (input) => {
      expect(parseLocalDateTime(input)).toBeNull();
      expect(isValidLocalDateTimeSyntax(input)).toBe(false);
      expect(normalizeLocalDateTime(input)).toBeNull();
    });

    it.each([
      ['2026-10-10 12:34', '2026-10-10T12:34'],
      ['2026-10-10T12:34:00', '2026-10-10T12:34'],
      ['2026-10-10T12:34:00.000', '2026-10-10T12:34'],
      ['2026-10-10T12:34:00.010', '2026-10-10T12:34:00.01'],
      ['2026-10-10T12:34:01.100', '2026-10-10T12:34:01.1'],
      ['2026-10-10T12:34:59.999', '2026-10-10T12:34:59.999'],
      ['02026-10-10 12:34:01.000', '02026-10-10T12:34:01'],
    ])('normalizes %j without changing its value', (input, normalized) => {
      expect(normalizeLocalDateTime(input)).toBe(normalized);
    });

    it('does not silently truncate a parseable, nonconforming fraction while normalizing', () => {
      for (const input of ['2026-10-10T12:34:56.1234', '2026-10-10T12:34:00.0000']) {
        expect(parseLocalDateTime(input)).not.toBeNull();
        expect(isValidLocalDateTimeSyntax(input)).toBe(false);
        expect(normalizeLocalDateTime(input)).toBeNull();
      }
    });
  });

  describe('HTML time-zone offsets', () => {
    it.each([
      ['Z', 0, 0], ['+00:00', 0, 0], ['+0000', 0, 0],
      ['+02:09', 2, 9], ['-0230', -2, -30], ['-00:30', 0, -30], ['+23:59', 23, 59], ['-2359', -23, -59],
    ])('parses %j', (input, hours, minutes) => {
      expect(parseUtcOffsetMinutes(input)).toBe(hours * 60 + minutes);
      expect(isValidUtcOffsetSyntax(input)).toBe(true);
    });

    it.each(['-00:00', '-0000'])('parses nonconforming negative zero %j', (input) => {
      expect(parseUtcOffsetMinutes(input)).toBe(0);
      expect(isValidUtcOffsetSyntax(input)).toBe(false);
    });

    it.each([
      '', 'z', 'UTC', '+0:00', '+00:0', '+00:000', '+000', '+00000', '+00', '+24:00',
      '+00:60', '+-0000', '+00:00:00', ' Z', 'Z\n', 'Z+0000', '\u221200:30',
    ])('rejects %j', (input) => {
      expect(parseUtcOffsetMinutes(input)).toBeNull();
      expect(isValidUtcOffsetSyntax(input)).toBe(false);
    });
  });

  describe('HTML global date-times', () => {
    it('converts to UTC while retaining offset and fractional digits', () => {
      expect(parseOffsetDateTime('1979-10-14T12:00:00.001-04:00')).toEqual({
        utc: {
          year: 1979n, month: 10, day: 14, hour: 16, minute: 0, second: 0, fractionDigits: '001',
        },
        offsetMinutes: -240,
      });
    });

    it('carries across midnight without rounding a fraction into the next second', () => {
      expect(parseOffsetDateTime('2026-01-01T00:00:59.999999999999999999+00:01')).toEqual({
        utc: {
          year: 2025n, month: 12, day: 31, hour: 23, minute: 59, second: 59, fractionDigits: '999999999999999999',
        },
        offsetMinutes: 1,
      });
    });

    it.each([
      ['2024-03-01T00:00+00:30', 2024n, 2, 29, 23, 30],
      ['1900-03-01T00:00+00:30', 1900n, 2, 28, 23, 30],
      ['2026-12-31T23:45-00:30', 2027n, 1, 1, 0, 15],
      ['2026-01-01T00:00+23:59', 2025n, 12, 31, 0, 1],
      ['2026-12-31T23:59-23:59', 2027n, 1, 1, 23, 58],
      ['0001-01-01T00:00+00:01', 0n, 12, 31, 23, 59],
      ['9007199254740993-12-31T23:59-00:01', 9007199254740994n, 1, 1, 0, 0],
    ])('carries UTC conversion across the calendar boundary in %j', (input, year, month, day, hour, minute) => {
      expect(parseOffsetDateTime(input)?.utc).toEqual({
        year, month, day, hour, minute, second: 0, fractionDigits: '',
      });
      expect(isValidOffsetDateTimeSyntax(input)).toBe(true);
    });

    it.each(['2026-10-10T12:34-00:00', '2026-10-10T12:34-0000', '2026-10-10T12:34:56.1234Z'])(
      'separates global parsing from authoring validity for %j', (input) => {
        expect(parseOffsetDateTime(input)).not.toBeNull();
        expect(isValidOffsetDateTimeSyntax(input)).toBe(false);
      },
    );

    it.each([
      '', '2026-10-10', '2026-10-10T12:34', '2026-10-10T12:34z', '2026-10-10T12:34 Z',
      '2026-10-10T12:34+24:00', '2026-10-10T12:34+00:60', '2026-10-10T12:34Z\n',
      '2026-10-10T12:34:56..1Z', '2026-10-10T12:34:56.1.2Z',
    ])('rejects %j', (input) => {
      expect(parseOffsetDateTime(input)).toBeNull();
      expect(isValidOffsetDateTimeSyntax(input)).toBe(false);
    });
  });

  describe('HTML week-years', () => {
    it.each([
      ['0001-W01', 1n, 1], ['2004-W53', 2004n, 53], ['2015-W53', 2015n, 53],
      ['2020-W53', 2020n, 53], ['2026-W53', 2026n, 53], ['2027-W52', 2027n, 52],
      ['9007199254740993-W01', 9007199254740993n, 1],
    ])('parses %j', (input, year, week) => {
      expect(parseYearWeek(input)).toEqual({ year, week });
    });

    it.each([
      '', '0000-W01', '026-W01', '2026-w01', '2026-01', '2026-W1', '2026-W001',
      '2026-W00', '2026-W54', '2016-W53', '2027-W53', ' 2026-W01', '2026-W01\n',
    ])('rejects %j', (input) => {
      expect(parseYearWeek(input)).toBeNull();
    });

    it('has 71 long week-years per Gregorian 400-year cycle, including beyond double precision', () => {
      let longYears = 0;
      const cycles = 10n ** 30n * 400n;
      for (let year = 1n; year <= 400n; year++) {
        const weeks = getWeeksInYear(year);
        if (weeks === 53) longYears++;
        expect(getWeeksInYear(year + cycles)).toBe(weeks);
      }
      expect(longYears).toBe(71);
    });
  });

  describe('HTML durations', () => {
    it.each([
      ['PT0S', 0], ['P1D', 86400], ['PT2H', 7200], ['PT90M', 5400], ['PT1.125S', 1.125],
      ['P1DT2H3M4.005S', 93784.005], ['1w', 604800], ['1 W 2 D', 777600],
      ['3m 1h', 3780], [' 1 h 2 m 3.5 s\n', 3723.5], ['0.000s', 0], ['1D2h3M4s', 93784],
    ])('parses valid duration syntax %j', (input, seconds) => {
      expect(isValidDurationSyntax(input)).toBe(true);
      expect(parseDurationSeconds(input)).toBe(seconds);
    });

    it.each([
      ['P2W', 1209600], ['P1H', 3600], ['P1D2M', 86520], ['PT1M1H', 3660],
      ['1s1S', 2], ['1H2h', 10800], ['.5s', 0.5], ['PT.5S', 0.5], ['1.1234s', 1.1234],
      [' P 1 D T 2 H ', 93600], ['TT1ST', 1], ['P1DT', 86400],
      ['P0Y0M', 0], ['0y', 0], ['P0Y1D', 86400], ['P1S1M', 61], ['P1.5S1D', 86401.5],
    ])('recovers the nonconforming duration %j', (input, seconds) => {
      expect(parseDurationSeconds(input)).toBe(seconds);
      expect(isValidDurationSyntax(input)).toBe(false);
    });

    it.each([
      '', ' ', 'P', 'PT', 'TT', '1', '1X', '+1s', '-1s', '1e2s', 'p1d', '1,5s',
      '.s', '1.s', '1 .5s', '1.5h', '1.5d', 'P1Y', 'P1M', '1y', '0y1m', 'P1.5S1M',
      '1s?', '\u00a01s', '1s\u00a0', '1秒', '１s',
    ])('rejects unparseable or calendar-dependent duration %j', (input) => {
      expect(parseDurationSeconds(input)).toBeNull();
      expect(isValidDurationSyntax(input)).toBe(false);
    });

    it('uses finite numeric seconds and leaves authoring validity independent of overflow', () => {
      const input = `PT1${'0'.repeat(400)}S`;
      expect(isValidDurationSyntax(input)).toBe(true);
      expect(parseDurationSeconds(input)).toBeNull();
      expect(parseDurationSeconds(`1${'0'.repeat(308)}w`)).toBeNull();
      expect(parseDurationSeconds(`.${'0'.repeat(400)}1s`)).toBe(0);
    });
  });

  describe('HTML date-or-time alternatives', () => {
    it('distinguishes the returned kinds without inventing a local time zone', () => {
      expect(parseDateOrTime('2026-10-10')).toEqual({ kind: 'date', value: { year: 2026n, month: 10, day: 10 } });
      expect(parseDateOrTime('12:34')).toEqual({ kind: 'time', value: { hour: 12, minute: 34, second: 0, fractionDigits: '' } });
      expect(parseDateOrTime('2026-10-10 12:34+02:00')).toEqual({
        kind: 'offsetDateTime', value: {
          utc: {
            year: 2026n, month: 10, day: 10, hour: 10, minute: 34, second: 0, fractionDigits: '',
          },
          offsetMinutes: 120,
        },
      });
    });

    it.each(['2026-10-10', '2026-10-10T12:34Z'])(
      'accepts %j as valid date-with-optional-time syntax', (input) => {
        expect(isValidDateWithOptionalTimeSyntax(input)).toBe(true);
      },
    );

    it.each(['12:34', '2026-10-10T12:34', '2026-10-10T12:34-0000'])(
      'rejects %j as date-with-optional-time authoring syntax', (input) => {
        expect(isValidDateWithOptionalTimeSyntax(input)).toBe(false);
      },
    );

    it.each(['', '2026-10', '--10-10', '2026-W41', 'P1D', '2026-10-10T12:34', '2026-10-10x12:34', '12:34Z', '2026-10-10\n'])(
      'rejects %j when no complete alternative matches', (input) => {
        expect(parseDateOrTime(input)).toBeNull();
      },
    );
  });
});
