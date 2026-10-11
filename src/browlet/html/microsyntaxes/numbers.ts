import { isAsciiWhitespace } from '../../../infra/index';

/** Check the complete authoring syntax, without whitespace, a leading plus, or trailing input. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-integer
export function isValidInteger(input: string): boolean {
  const start = input.charCodeAt(0) === 45 ? 1 : 0;
  return start < input.length && skipDigits(input, start) === input.length;
}

/** Parse an exact integer prefix, returning null on error; callers own bounds and defaults. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-integers
export function parseInteger(input: string): bigint | null {
  let position = skipWhitespace(input, 0);
  const sign = input.charCodeAt(position);
  if (sign === 43 || sign === 45) position++;

  const start = position;
  position = skipDigits(input, position);
  if (position === start) return null;

  const value = BigInt(input.slice(start, position));
  return sign === 45 ? -value : value;
}

/** Check for one or more ASCII digits, without a sign or any other characters. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-non-negative-integer
export function isValidNonNegativeInteger(input: string): boolean {
  return input.length > 0 && skipDigits(input, 0) === input.length;
}

/** Parse an exact nonnegative integer prefix; negative zero is accepted as zero. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-non-negative-integers
export function parseNonNegativeInteger(input: string): bigint | null {
  const value = parseInteger(input);
  return value !== null && value >= 0n ? value : null;
}

/** Check the complete floating-point syntax and reject values that overflow a double. */
// SPEC_CLASH(html-float-empty-fraction): Follow HTML/Firefox's authoring grammar: 1.e2 is invalid.
// Chromium/WebKit accept it in number inputs. The permissive parser below accepts it in all three.
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-floating-point-number
export function isValidFloatingPointNumber(input: string): boolean {
  return validFloatPattern.test(input) && Number.isFinite(Number(input));
}

/** Parse a finite floating-point prefix, returning null on error and positive zero on underflow. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-floating-point-number-values
export function parseFloatingPointNumber(input: string): number | null {
  const start = skipWhitespace(input, 0);
  const first = input.charCodeAt(start);
  // SPEC_CLASH(html-float-ascii-whitespace): Follow HTML/Chromium/WebKit; Firefox also skips NBSP.
  // Guard the start before parseFloat, whose own whitespace grammar is broader than HTML's.
  if (!isDigit(first) && first !== 43 && first !== 45 && first !== 46) return null;

  // parseFloat consumes the same decimal prefix, including incomplete exponent recovery.
  // Convert the decimal once, avoiding intermediate floating-point rounding of its digits.
  const value = Number.parseFloat(input.slice(start));
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}

/** Return HTML's best representation of a number using ECMAScript's decimal conversion. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#best-representation-of-the-number-as-a-floating-point-number
export function serializeFloatingPointNumber(value: number): string {
  return String(value);
}

/** Parse a nonnegative length or percentage prefix, returning null on syntax error or overflow. */
// The numeric value and its category travel together; Absolute denotes the spec's length category.
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-dimension-values
export function parseDimensionValue(input: string): DimensionValue | null {
  const start = skipWhitespace(input, 0);
  let position = skipDigits(input, start);
  if (position === start) return null;

  if (input.charCodeAt(position) === 46) position = skipDigits(input, position + 1);
  const value = Number(input.slice(start, position));
  // SPEC_GAP(html-dimension-overflow): HTML leaves numerical limits open; reject double overflow.
  // Ordinary finite rounding is retained. Caller-specific size limits remain with consumers.
  if (!Number.isFinite(value)) return null;

  return {
    value,
    unit: input.charCodeAt(position) === 37 ? DimensionUnit.Percentage : DimensionUnit.Absolute,
  };
}

/** Parse a length or percentage whose value is nonzero after numeric conversion. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-non-zero-dimension-values
export function parseNonzeroDimensionValue(input: string): DimensionValue | null {
  const dimension = parseDimensionValue(input);
  return dimension !== null && dimension.value !== 0 ? dimension : null;
}

/** Check a comma-separated authoring list, with no whitespace or empty members. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-list-of-floating-point-numbers
export function isValidListOfFloatingPointNumbers(input: string): boolean {
  if (input.length === 0) return true;
  let position = 0;
  while (position < input.length) {
    const comma = input.indexOf(',', position);
    if (comma === -1) return isValidFloatingPointNumber(input.slice(position));
    if (!isValidFloatingPointNumber(input.slice(position, comma))) return false;
    position = comma + 1;
  }
  return false;
}

/** Parse a forgiving numeric list; unparseable members become zero, not an omitted entry. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-list-of-floating-point-numbers
export function parseListOfFloatingPointNumbers(input: string): number[] {
  const numbers: number[] = [];
  let position = 0;
  while (isListDelimiter(input.charCodeAt(position))) position++;

  while (position < input.length) {
    // Skip leading garbage, including '+', until a delimiter or possible number start.
    while (position < input.length) {
      const code = input.charCodeAt(position);
      if (isListDelimiter(code) || isDigit(code) || code === 46 || code === 45) break;
      position++;
    }
    const start = position;
    while (position < input.length && !isListDelimiter(input.charCodeAt(position))) position++;
    numbers.push(parseFloatingPointNumber(input.slice(start, position)) ?? 0);
    while (isListDelimiter(input.charCodeAt(position))) position++;
  }
  return numbers;
}

/** Parse obsolete frameset dimensions, retaining empty members and recovering overflow as 0*. */
// Named value/unit records replace the pairs, using the same categories as the single-value parser.
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-list-of-dimensions
export function parseListOfDimensions(input: string): ListDimension[] {
  const dimensions: ListDimension[] = [];
  const end = input.endsWith(',') ? input.length - 1 : input.length;
  let position = 0;

  // Apply Infra's comma splitting lazily: trim ASCII whitespace and omit a final empty token.
  // SPEC_CLASH(html-dimension-list-final-empty): Keep the written split; Chromium/WebKit retain a final empty member.
  // https://infra.spec.whatwg.org/#split-on-commas
  while (position < end) {
    const comma = input.indexOf(',', position);
    const tokenEnd = comma === -1 ? end : comma;
    const start = skipWhitespace(input, position);
    if (start >= tokenEnd) {
      dimensions.push({ value: 0, unit: DimensionUnit.Relative });
    } else {
      dimensions.push(parseListDimension(input, start, tokenEnd));
    }
    position = tokenEnd + 1;
  }
  return dimensions;
}

/** HTML dimension categories; a standalone length and a list's absolute unit share Absolute. */
export enum DimensionUnit {
  Absolute,
  Percentage,
  Relative,
}

/** A finite, nonnegative length or percentage, without applying any layout or element limits. */
export type DimensionValue = {
  value: number;
  unit: DimensionUnit.Absolute | DimensionUnit.Percentage;
};

/** One obsolete frameset dimension, whose relative unit denotes a star weight. */
export type ListDimension = {
  value: number;
  unit: DimensionUnit;
};

// Unlike $, the final assertion requires the actual end, including after line terminators.
const validFloatPattern = /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?(?![\s\S])/;

/** Parse one nonempty, comma-delimited member; the caller handles empty members separately. */
function parseListDimension(input: string, start: number, end: number): ListDimension {
  let position = skipDigits(input, start);
  let numericText = position === start ? '0' : input.slice(start, position);

  if (input.charCodeAt(position) === 46) {
    // SPEC_CLASH(html-dimension-list-fraction): Consume the dot omitted by HTML's written steps.
    // Chromium/WebKit preserve fractions; Firefox truncates them but still recognizes the unit.
    position++;
    numericText += '.';
    while (position < end) {
      const code = input.charCodeAt(position);
      if (isDigit(code)) numericText += input[position];
      else if (!isAsciiWhitespace(code)) break;
      position++;
    }
  }

  const value = Number(numericText);
  // SPEC_GAP(html-dimension-overflow): Recover double overflow as 0*, borrowing Chromium's fallback.
  // Chromium/WebKit use smaller component limits; WebKit falls back to 1*. See the roadmap.
  if (!Number.isFinite(value)) return { value: 0, unit: DimensionUnit.Relative };

  position = skipWhitespace(input, position);
  const code = input.charCodeAt(position);
  const unit = code === 37 ? DimensionUnit.Percentage :
    code === 42 ? DimensionUnit.Relative : DimensionUnit.Absolute;
  return { value, unit };
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function skipDigits(input: string, position: number): number {
  while (isDigit(input.charCodeAt(position))) position++;
  return position;
}

function skipWhitespace(input: string, position: number): number {
  while (isAsciiWhitespace(input.charCodeAt(position))) position++;
  return position;
}

function isListDelimiter(code: number): boolean {
  return isAsciiWhitespace(code) || code === 44 || code === 59;
}
