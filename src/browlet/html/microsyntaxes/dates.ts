import { isAsciiWhitespace } from '../../../infra/index';

// HTML date/time grammars with explicit value names and exact calendar/clock fields.
// Public parsers consume the complete input; private consumers advance a shared cursor.
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#dates-and-times

/** Parse YYYY-MM into a year and a month numbered 1–12. Reject incomplete or trailing input. */
// HTML calls this "parse a month": https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-month-string
export function parseYearMonth(input: string): YearMonth | null {
  const parser = new DateTimeParser(input);
  const result = parser.consumeYearMonth();
  return parser.eof() ? result : null;
}

/** Parse YYYY-MM-DD, checking the Gregorian calendar without imposing JavaScript Date's limits. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-date-string
export function parseCalendarDate(input: string): CalendarDate | null {
  const parser = new DateTimeParser(input);
  const result = parser.consumeCalendarDate();
  return parser.eof() ? result : null;
}

/** Parse MM-DD or --MM-DD; February 29 is allowed because no year is supplied. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-yearless-date-string
export function parseMonthDay(input: string): MonthDay | null {
  const parser = new DateTimeParser(input);
  const result = parser.consumeMonthDay();
  return parser.eof() ? result : null;
}

/** Parse HH:MM[:SS[.digits]], retaining every fractional digit without rounding. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-time-string
export function parseClockTime(input: string): ClockTime | null {
  const parser = new DateTimeParser(input);
  const result = parser.consumeClockTime();
  return parser.eof() ? result : null;
}

/** Parse calendar and clock fields separated by T or one space, without selecting a time zone. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-local-date-and-time-string
export function parseLocalDateTime(input: string): DateTime | null {
  const parser = new DateTimeParser(input);
  const result = parser.consumeDateTime();
  return parser.eof() ? result : null;
}

/** Parse Z, ±HH:MM, or ±HHMM into signed minutes east of UTC; -05:30 returns -330. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-time-zone-offset-string
export function parseUtcOffsetMinutes(input: string): number | null {
  const parser = new DateTimeParser(input);
  const result = parser.consumeUtcOffsetMinutes();
  return parser.eof() ? result : null;
}

/** Parse a date-time with an explicit offset, returning UTC fields and the original offset in minutes. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-global-date-and-time-string
export function parseOffsetDateTime(input: string): OffsetDateTime | null {
  const parser = new DateTimeParser(input);
  const local = parser.consumeDateTime();
  if (local === null) return null;
  const offsetMinutes = parser.consumeUtcOffsetMinutes();
  if (offsetMinutes === null || !parser.eof()) return null;
  convertToUTC(local, offsetMinutes);
  return { utc: local, offsetMinutes };
}

/** Parse YYYY-Www into its week-year and week number, checking whether week 53 exists. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-week-string
export function parseYearWeek(input: string): YearWeek | null {
  const parser = new DateTimeParser(input);
  const result = parser.consumeYearWeek();
  return parser.eof() ? result : null;
}

/** Parse a duration into finite seconds; nonzero calendar years/months cannot be converted. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-duration-string
export function parseDurationSeconds(input: string): number | null {
  let position = skipWhitespace(input, 0);
  let mMeansMonths = input.charCodeAt(position) === 80; // P
  if (mMeansMonths) position = skipWhitespace(input, position + 1);

  let seconds = 0;
  let componentCount = 0;
  while (position < input.length) {
    if (input.charCodeAt(position) === 84) { // T
      mMeansMonths = false;
      position = skipWhitespace(input, position + 1);
      continue;
    }
    const start = position;
    position = skipDigits(input, position);
    const fractional = input.charCodeAt(position) === 46;
    if (fractional) {
      const fractionStart = position + 1;
      position = skipDigits(input, fractionStart);
      if (position === fractionStart) return null;
    } else if (position === start) {
      return null;
    }
    const amount = Number(input.slice(start, position));
    position = skipWhitespace(input, position);
    const unit = durationUnit(input.charCodeAt(position));
    if (unit === DurationUnit.Invalid || (fractional && unit !== DurationUnit.Second)) return null;
    position = skipWhitespace(input, position + 1);
    componentCount++;
    if (unit === DurationUnit.Year || (unit === DurationUnit.Minute && mMeansMonths)) {
      if (amount !== 0) return null;
      mMeansMonths = true;
    } else {
      if (!fractional) mMeansMonths = false;
      seconds += amount * durationScales[unit];
    }
  }
  // SPEC_GAP(html-duration-overflow): HTML supplies no numeric limit; preserve the reviewed finite-result policy.
  return componentCount > 0 && Number.isFinite(seconds) ? seconds : null;
}

/** Parse a calendar date, clock time, or date-time with an explicit offset, tagging the result. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-date-or-time-string
export function parseDateOrTime(input: string): ParsedDateOrTime | null {
  const parser = new DateTimeParser(input);
  return parser.parseDateOrTime();
}

// Separate authoring checks exist only where successful parsing is not sufficient.

/** Check clock syntax with no more than three fractional digits. Parsing itself preserves longer fractions. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-time-string
export function isValidClockTimeSyntax(input: string): boolean {
  const time = parseClockTime(input);
  return time !== null && time.fractionDigits.length <= 3;
}

/** Check local date-time syntax, including the three-digit authoring limit on fractions. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-local-date-and-time-string
export function isValidLocalDateTimeSyntax(input: string): boolean {
  const dateTime = parseLocalDateTime(input);
  return dateTime !== null && dateTime.fractionDigits.length <= 3;
}

/** Check offset syntax; parsing accepts negative zero, but authoring syntax excludes it. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-time-zone-offset-string
export function isValidUtcOffsetSyntax(input: string): boolean {
  return input !== '-00:00' && input !== '-0000' && parseUtcOffsetMinutes(input) !== null;
}

/** Check explicit-offset date-time syntax, excluding long fractions and a negative-zero offset. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-global-date-and-time-string
export function isValidOffsetDateTimeSyntax(input: string): boolean {
  const parser = new DateTimeParser(input);
  return parser.consumeCalendarDate() !== null && parser.consumeValidOffsetTime();
}

/** Check duration authoring syntax, independent of numeric overflow in the forgiving seconds parser. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-duration-string
export function isValidDurationSyntax(input: string): boolean {
  if (input.startsWith('P')) return validISODurationPattern.test(input);

  let position = skipWhitespace(input, 0);
  let seen = 0;
  while (position < input.length) {
    const start = position;
    position = skipDigits(input, position);
    if (position === start) return false;
    const fractional = input.charCodeAt(position) === 46;
    if (fractional) {
      const fractionStart = position + 1;
      position = skipDigits(input, fractionStart);
      if (position === fractionStart || position - fractionStart > 3) return false;
    }
    position = skipWhitespace(input, position);
    const unit = durationUnit(input.charCodeAt(position));
    // Human-readable syntax has no calendar units, duplicate scales, or fractions on non-second units.
    if (unit < DurationUnit.Week || (fractional && unit !== DurationUnit.Second)) return false;
    const mask = 1 << unit;
    if ((seen & mask) !== 0) return false;
    seen |= mask;
    position = skipWhitespace(input, position + 1);
  }
  return seen !== 0;
}

/** Check a calendar date with either no clock time or an explicitly offset clock time. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-date-string-with-optional-time
export function isValidDateWithOptionalTimeSyntax(input: string): boolean {
  const parser = new DateTimeParser(input);
  return parser.consumeCalendarDate() !== null && (parser.eof() || parser.consumeValidOffsetTime());
}

/** Use T and the shortest time spelling; preserve the date spelling and reject invalid authoring syntax. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-normalised-local-date-and-time-string
export function normalizeLocalDateTime(input: string): string | null {
  const dateTime = parseLocalDateTime(input);
  if (dateTime === null || dateTime.fractionDigits.length > 3) return null;
  const separator = input.indexOf('T');
  const dateEnd = separator === -1 ? input.indexOf(' ') : separator;
  // SPEC_CLASH(html-local-datetime-fraction-normalization): HTML/Chromium omit fractional trailing zeros; Firefox keeps them.
  let fractionEnd = dateTime.fractionDigits.length;
  while (dateTime.fractionDigits.charCodeAt(fractionEnd - 1) === 48) fractionEnd--;
  // Reuse validated digits. Counts include T plus HH:MM or HH:MM:SS.
  const end = fractionEnd === 0 ? dateEnd + (dateTime.second === 0 ? 6 : 9) :
    input.length - dateTime.fractionDigits.length + fractionEnd;
  if (separator !== -1) return end === input.length ? input : input.slice(0, end);
  return input.slice(0, dateEnd) + 'T' + input.slice(dateEnd + 1, end);
}

/** Count days in Gregorian month 1–12; astronomical year numbering includes year zero. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#number-of-days-in-month-month-of-year-year
export function getDaysInMonth(month: number, year: bigint): number {
  if (month === 2) return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Count weeks in a positive week-year: week 1 contains January 4, and weeks start on Monday. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#week-number-of-the-last-day
export function getWeeksInYear(year: bigint): number {
  // Gregorian weekdays repeat every 400 years; keep the remaining arithmetic small and exact.
  const cycleYear = Number(year % 400n);
  const previous = (cycleYear + 399) % 400;
  const weekday = (previous + Math.floor(previous / 4) - Math.floor(previous / 100)) % 7;
  const leap = cycleYear % 4 === 0 && (cycleYear % 100 !== 0 || cycleYear === 0);
  return weekday === 3 || (weekday === 2 && leap) ? 53 : 52;
}

/** A positive year paired with a month numbered 1–12. */
export type YearMonth = { year: bigint; month: number; };

/** Gregorian calendar fields. Parsing requires year > 0; UTC adjustment may reach year zero. */
export type CalendarDate = { year: bigint; month: number; day: number; };

/** Month 1–12 and day 1–31, validated together; February 29 is allowed. */
export type MonthDay = { month: number; day: number; };

/** Clock fields with exact fractional digits. No host time zone or floating-point seconds are involved. */
export type ClockTime = {
  hour: number;
  minute: number;
  /** Whole seconds, 0–59. */
  second: number;
  /** Digits following the decimal point, preserving zeros; empty when absent. */
  fractionDigits: string;
};

/** One record containing calendar and clock fields; its containing result establishes local time or UTC. */
export type DateTime = CalendarDate & ClockTime;

/** UTC fields plus the original signed offset, measured in minutes east of UTC. */
export type OffsetDateTime = { utc: DateTime; offsetMinutes: number; };

/** A week-year and its one-based week; the week-year can differ from the calendar year. */
export type YearWeek = { year: bigint; week: number; };

/** The three supported complete-input alternatives; an offset-free date-time is excluded. */
export type ParsedDateOrTime =
  { kind: 'date'; value: CalendarDate; } |
  { kind: 'time'; value: ClockTime; } |
  { kind: 'offsetDateTime'; value: OffsetDateTime; };

/**
 * Consumers advance the shared position without requiring EOF; failure may leave it advanced.
 * Complete parse operations reject trailing input.
 */
class DateTimeParser {
  #input: string;
  /** Next unread UTF-16 code unit. */
  #position = 0;

  constructor(input: string) {
    this.#input = input;
  }

  /** Whether the selected grammar consumed the complete input. */
  eof(): boolean { return this.#position >= this.#input.length; }

  /** Consume YYYY-MM without creating a separate position object. */
  consumeYearMonth(): YearMonth | null {
    const year = this.#consumeYear();
    if (year === null || !this.#match('-')) return null;
    const month = this.#consumeMonth();
    return month === null ? null : { year, month };
  }

  /** Consume a full calendar date, allocating only its final record. */
  consumeCalendarDate(): CalendarDate | null {
    const year = this.#consumeYear();
    if (year === null || !this.#match('-')) return null;
    const month = this.#consumeMonth();
    if (month === null || !this.#match('-')) return null;
    const day = this.#consumeTwoDigits();
    return day === null || day < 1 || day > getDaysInMonth(month, year) ? null : { year, month, day };
  }

  /** Consume MM-DD with an optional -- prefix. */
  consumeMonthDay(): MonthDay | null {
    if (this.#match('-') && !this.#match('-')) return null;
    const month = this.#consumeMonth();
    if (month === null || !this.#match('-')) return null;
    const day = this.#consumeTwoDigits();
    return day === null || day < 1 || day > getDaysInMonth(month, 4n) ? null : { month, day };
  }

  /** Consume clock fields, optionally combining already-read calendar scalars into the same result record. */
  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-time-component
  consumeClockTime(): ClockTime | null;
  consumeClockTime(year: bigint, month: number, day: number): DateTime | null;
  consumeClockTime(year?: bigint, month?: number, day?: number): ClockTime | DateTime | null {
    const hour = this.#consumeTwoDigits();
    if (hour === null || hour > 23 || !this.#match(':')) return null;
    const minute = this.#consumeTwoDigits();
    if (minute === null || minute > 59) return null;
    let second = 0;
    let fractionDigits = '';
    if (this.#match(':')) {
      const value = this.#consumeTwoDigits();
      if (value === null || value > 59) return null;
      second = value;
      if (this.#match('.')) {
        const start = this.#position;
        if (this.#consumeDigits() === 0) return null;
        // SPEC_CLASH(html-time-parser-fraction): Preserve HTML's long fractions; browser form parsers cap them at three digits.
        fractionDigits = this.#input.slice(start, this.#position);
      }
    }
    return year === undefined ? { hour, minute, second, fractionDigits } :
      // The calendar overload supplies all three fields together.
      { year, month: month!, day: day!, hour, minute, second, fractionDigits };
  }

  /** Consume a combined value directly, without allocating separate calendar and clock records. */
  consumeDateTime(): DateTime | null {
    const year = this.#consumeYear();
    if (year === null || !this.#match('-')) return null;
    const month = this.#consumeMonth();
    if (month === null || !this.#match('-')) return null;
    const day = this.#consumeTwoDigits();
    if (day === null || day < 1 || day > getDaysInMonth(month, year) || !this.#consumeDateTimeSeparator()) return null;
    return this.consumeClockTime(year, month, day);
  }

  /** Consume an explicit UTC offset, combining the signed components into exact integer minutes. */
  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-time-zone-offset-component
  consumeUtcOffsetMinutes(): number | null {
    if (this.#match('Z')) return 0;
    const negative = this.#match('-');
    if (!negative && !this.#match('+')) return null;
    const hours = this.#consumeTwoDigits();
    if (hours === null || hours > 23) return null;
    this.#match(':');
    const minutes = this.#consumeTwoDigits();
    if (minutes === null || minutes > 59) return null;
    const offset = hours * 60 + minutes;
    return negative && offset !== 0 ? -offset : offset;
  }

  /** Consume a week-year and its bounded week number. */
  consumeYearWeek(): YearWeek | null {
    const year = this.#consumeYear();
    if (year === null || !this.#match('-') || !this.#match('W')) return null;
    const week = this.#consumeTwoDigits();
    return week === null || week < 1 || week > getWeeksInYear(year) ? null : { year, week };
  }

  /** Parse a complete date/time alternative, restoring this cursor before trying a clock-only input. */
  parseDateOrTime(): ParsedDateOrTime | null {
    const start = this.#position;
    const date = this.consumeCalendarDate();
    if (date === null) {
      this.#position = start;
      const time = this.consumeClockTime();
      return time !== null && this.eof() ? { kind: 'time', value: time } : null;
    }
    if (this.eof()) return { kind: 'date', value: date };
    if (!this.#consumeDateTimeSeparator()) return null;
    const utc = this.consumeClockTime(date.year, date.month, date.day);
    if (utc === null) return null;
    const offsetMinutes = this.consumeUtcOffsetMinutes();
    if (offsetMinutes === null || !this.eof()) return null;
    convertToUTC(utc, offsetMinutes);
    return { kind: 'offsetDateTime', value: { utc, offsetMinutes } };
  }

  /** Consume the separator, clock, and offset through EOF, checking authoring syntax without adjusting to UTC. */
  consumeValidOffsetTime(): boolean {
    if (!this.#consumeDateTimeSeparator()) return false;
    const time = this.consumeClockTime();
    if (time === null || time.fractionDigits.length > 3) return false;
    const negative = this.#input.charCodeAt(this.#position) === 45;
    const offset = this.consumeUtcOffsetMinutes();
    return offset !== null && this.eof() && !(negative && offset === 0);
  }

  /** Consume at least four year digits, keeping large values exact. */
  #consumeYear(): bigint | null {
    const start = this.#position;
    const length = this.#consumeDigits();
    if (length < 4) return null;
    // Four year digits fit exactly in a number, avoiding a temporary substring.
    // SPEC_CLASH(html-date-year-range): HTML has no maximum year; browser form parsers impose differing limits.
    const year = length === 4 ? BigInt(
      (this.#input.charCodeAt(start) - 48) * 1000 + (this.#input.charCodeAt(start + 1) - 48) * 100 +
      (this.#input.charCodeAt(start + 2) - 48) * 10 + this.#input.charCodeAt(start + 3) - 48,
    ) : BigInt(this.#input.slice(start, this.#position));
    return year > 0n ? year : null;
  }

  /** Consume the month number itself: two digits, value 1–12. */
  #consumeMonth(): number | null {
    const month = this.#consumeTwoDigits();
    return month !== null && month >= 1 && month <= 12 ? month : null;
  }

  /** Consume two digits; surrounding grammar or the end-of-input check excludes any extra digits. */
  #consumeTwoDigits(): number | null {
    const start = this.#position;
    const first = this.#input.charCodeAt(start) - 48;
    const second = this.#input.charCodeAt(start + 1) - 48;
    if (!(first >= 0 && first <= 9 && second >= 0 && second <= 9)) return null;
    this.#position += 2;
    return first * 10 + second;
  }

  /** Consume one literal separator when it is present. */
  #match(character: string): boolean {
    if (this.#input[this.#position] !== character) return false;
    this.#position++;
    return true;
  }

  #consumeDateTimeSeparator(): boolean {
    return this.#match('T') || this.#match(' ');
  }

  /** Advance over ASCII digits with one direct scan; return the number consumed. */
  #consumeDigits(): number {
    const start = this.#position;
    this.#position = skipDigits(this.#input, start);
    return this.#position - start;
  }
}

/** Adjust freshly parsed, unshared fields in place; the bounded offset permits at most one day of carry. */
// UTC conversion within https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-global-date-and-time-string
function convertToUTC(value: DateTime, offsetMinutes: number): void {
  if (offsetMinutes === 0) return;
  let minutes = value.hour * 60 + value.minute - offsetMinutes;
  if (minutes < 0) {
    minutes += 1440;
    value.day--;
    if (value.day === 0) {
      value.month--;
      if (value.month === 0) {
        value.year--;
        value.month = 12;
      }
      value.day = getDaysInMonth(value.month, value.year);
    }
  } else if (minutes >= 1440) {
    minutes -= 1440;
    value.day++;
    if (value.day > getDaysInMonth(value.month, value.year)) {
      value.day = 1;
      value.month++;
      if (value.month === 13) {
        value.year++;
        value.month = 1;
      }
    }
  }
  value.hour = Math.floor(minutes / 60);
  value.minute = minutes % 60;
}

/** Return the end of an ASCII digit run, keeping scanning independent of cursor ownership. */
function skipDigits(input: string, position: number): number {
  while (true) {
    const code = input.charCodeAt(position);
    if (!(code >= 48 && code <= 57)) return position;
    position++;
  }
}

/** Return the first position after an ASCII whitespace run. */
function skipWhitespace(input: string, position: number): number {
  while (isAsciiWhitespace(input.charCodeAt(position))) position++;
  return position;
}

/** Numeric tags for duration units; M's interpretation depends on the preceding components. */
enum DurationUnit { Invalid, Year, Week, Day, Hour, Minute, Second }

/** Fixed unit lengths in seconds; calendar years/months are handled separately. */
const durationScales = [0, 0, 604800, 86400, 3600, 60, 1] as const;

function durationUnit(code: number): DurationUnit {
  switch (code) {
    case 89: case 121: return DurationUnit.Year; // Y, y
    case 87: case 119: return DurationUnit.Week; // W, w
    case 68: case 100: return DurationUnit.Day; // D, d
    case 72: case 104: return DurationUnit.Hour; // H, h
    case 77: case 109: return DurationUnit.Minute; // M, m
    case 83: case 115: return DurationUnit.Second; // S, s
    default: return DurationUnit.Invalid;
  }
}

// ISO-style authoring syntax requires a component and forbids a trailing empty T.
const validISODurationPattern = /^P(?=[0-9T])(?:[0-9]+D)?(?:T(?=[0-9])(?:[0-9]+H)?(?:[0-9]+M)?(?:[0-9]+(?:\.[0-9]{1,3})?S)?)?(?![\s\S])/;
