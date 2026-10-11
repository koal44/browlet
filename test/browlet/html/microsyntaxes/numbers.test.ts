import { describe, expect, it } from 'vitest';

import {
  isValidInteger, parseInteger, isValidNonNegativeInteger, parseNonNegativeInteger,
  isValidFloatingPointNumber, parseFloatingPointNumber, serializeFloatingPointNumber,
  parseDimensionValue, parseNonzeroDimensionValue,
  isValidListOfFloatingPointNumbers, parseListOfFloatingPointNumbers, parseListOfDimensions,
  DimensionUnit,
} from '../../../../src/browlet/html/microsyntaxes/index';

describe('HTML integers', () => {
  it.each([
    ['0', 0n], ['-0', 0n], ['0012', 12n], ['-12', -12n],
    ['+12', 12n], [' \t\n\f\r-12tail', -12n], ['12.5', 12n], ['12e3', 12n],
    ['0x10', 0n], ['12\u00a03', 12n],
  ])('parses the integer prefix of %j', (input, expected) => {
    expect(parseInteger(input)).toBe(expected);
  });

  it.each(['', ' \t\n\f\r', '+', '-', '+ 1', '--1', '-+1', '.5', 'x1', '\v1', '\u00a01', '\ufeff1', '１２'])(
    'returns an error for %j', (input) => {
      expect(parseInteger(input)).toBeNull();
    },
  );

  it('preserves integers beyond double precision and range', () => {
    expect(parseInteger('9007199254740993')).toBe(9007199254740993n);
    expect(parseInteger('-9007199254740993')).toBe(-9007199254740993n);
    expect(parseInteger(`1${'0'.repeat(400)}tail`)).toBe(10n ** 400n);
  });

  it.each(['0', '-0', '-1', '0012', '9007199254740993'])(
    'accepts complete integer syntax: %j', (input) => {
      expect(isValidInteger(input)).toBe(true);
    },
  );

  it.each(['', '+1', ' 1', '1 ', '1\n', '1\r', '1\u2028', '1.0', '1e0', '0x10', '- 1', '１２'])(
    'rejects nonconforming integer syntax: %j', (input) => {
      expect(isValidInteger(input)).toBe(false);
    },
  );

  it('distinguishes nonnegative authoring syntax from permissive parsing', () => {
    expect(isValidNonNegativeInteger('0012')).toBe(true);
    for (const input of ['-0', '+0', ' 0', '0tail']) {
      expect(isValidNonNegativeInteger(input)).toBe(false);
      expect(parseNonNegativeInteger(input)).toBe(0n);
    }
    expect(isValidNonNegativeInteger('')).toBe(false);
    expect(isValidNonNegativeInteger('1\n')).toBe(false);
    expect(parseNonNegativeInteger('-1')).toBeNull();
    expect(parseNonNegativeInteger('garbage')).toBeNull();
    expect(parseNonNegativeInteger('9007199254740993')).toBe(9007199254740993n);
  });
});

describe('HTML floating-point numbers', () => {
  it.each([
    ['0', 0], ['-0', 0], ['+1.25', 1.25], [' \t\n\f\r-.25tail', -0.25],
    ['1.', 1], ['1.e2', 100], ['1.5e+2junk', 150], ['1e-', 1], ['1e+tail', 1],
    ['1.2.3', 1.2], ['0x10', 0], ['0e9999', 0], ['1e-9999', 0], ['-1e-9999', 0],
    ['5e-324', Number.MIN_VALUE], ['1.7976931348623158e308', Number.MAX_VALUE],
    ['-1.7976931348623158e308', -Number.MAX_VALUE],
  ])('parses the decimal prefix of %j', (input, expected) => {
    expect(parseFloatingPointNumber(input)).toBe(expected);
  });

  it.each(['', ' ', '+', '-', '.', '.e1', '-.e1', '+ 1', 'NaN', 'Infinity', '-Infinity', '1e9999', '-1e9999', '1.7976931348623159e308'])(
    'returns an error for %j', (input) => {
      expect(parseFloatingPointNumber(input)).toBeNull();
    },
  );

  it.each(['\v1', '\u00a01.5', '\ufeff1', '\u20281'])(
    'skips only HTML ASCII whitespace: %j', (input) => {
      expect(parseFloatingPointNumber(input)).toBeNull();
    },
  );

  it('rounds the complete decimal once, including exponents that offset large significands', () => {
    expect(parseFloatingPointNumber('1.234567890123456789')).toBe(1.2345678901234567);
    expect(parseFloatingPointNumber(`1${'0'.repeat(400)}e-400`)).toBe(1);
    expect(parseFloatingPointNumber(`0.${'0'.repeat(400)}1e401`)).toBe(1);
  });

  it.each(['0', '-0', '1', '001', '-.5', '1.25', '1e2', '1E+2', '1e-2', '1e-9999', '0e9999'])(
    'accepts complete floating-point syntax: %j', (input) => {
      expect(isValidFloatingPointNumber(input)).toBe(true);
    },
  );

  it.each(['', '+1', ' 1', '1 ', '1\n', '1\r', '1\u2028', '1\u2029', '1.', '1.e2', '.', '.e1', '1e', '1e+', '0x10', '1tail', 'Infinity', 'NaN', '1e9999'])(
    'rejects nonconforming floating-point syntax: %j', (input) => {
      expect(isValidFloatingPointNumber(input)).toBe(false);
    },
  );

  it.each([
    [0, '0'], [-0, '0'], [0.1, '0.1'], [1e-7, '1e-7'], [1e-6, '0.000001'],
    [1e20, '100000000000000000000'], [1e21, '1e+21'], [Number.MIN_VALUE, '5e-324'],
    [Number.MAX_VALUE, '1.7976931348623157e+308'],
  ])('serializes %j using the best representation', (input, expected) => {
    expect(serializeFloatingPointNumber(input)).toBe(expected);
  });
});

describe('HTML lengths and percentages', () => {
  it.each([
    ['0', 0, DimensionUnit.Absolute], ['0012', 12, DimensionUnit.Absolute],
    [' \t\n\f\r12.5px', 12.5, DimensionUnit.Absolute], ['12.5%', 12.5, DimensionUnit.Percentage],
    ['12.%tail', 12, DimensionUnit.Percentage], ['12.', 12, DimensionUnit.Absolute],
    ['12. %', 12, DimensionUnit.Absolute], ['12 %', 12, DimensionUnit.Absolute],
    ['12. 5%', 12, DimensionUnit.Absolute], ['12e2%', 12, DimensionUnit.Absolute],
    ['12*', 12, DimensionUnit.Absolute], ['0x10', 0, DimensionUnit.Absolute],
  ])('parses the dimension prefix of %j', (input, value, unit) => {
    expect(parseDimensionValue(input)).toEqual({ value, unit });
  });

  it.each(['', ' ', '.5', '+1', '-1', 'Infinity', 'NaN', '\u00a01', '\v1', '１２'])(
    'rejects dimensions without an initial ASCII digit: %j', (input) => {
      expect(parseDimensionValue(input)).toBeNull();
    },
  );

  it('retains finite values and rounding without imposing an element size limit', () => {
    expect(parseDimensionValue('0.1%')).toEqual({ value: 0.1, unit: DimensionUnit.Percentage });
    expect(parseDimensionValue('9007199254740993')).toEqual({ value: 9007199254740992, unit: DimensionUnit.Absolute });
    expect(parseDimensionValue(`1${'0'.repeat(308)}`)).toEqual({ value: 1e308, unit: DimensionUnit.Absolute });
  });

  it('returns an error for dimensions beyond the finite-number range', () => {
    expect(parseDimensionValue('9'.repeat(400))).toBeNull();
    expect(parseDimensionValue(`${'9'.repeat(400)}%`)).toBeNull();
    expect(parseNonzeroDimensionValue('9'.repeat(400))).toBeNull();
  });

  it('distinguishes zero rejection from unit categorization', () => {
    for (const input of ['0', '0%', '0.00%', `0.${'0'.repeat(400)}1`]) {
      expect(parseDimensionValue(input)?.value).toBe(0);
      expect(parseNonzeroDimensionValue(input)).toBeNull();
    }
    expect(parseNonzeroDimensionValue('0.001%')).toEqual({ value: 0.001, unit: DimensionUnit.Percentage });
    expect(parseNonzeroDimensionValue('12px')).toEqual({ value: 12, unit: DimensionUnit.Absolute });
    expect(parseNonzeroDimensionValue('garbage')).toBeNull();
  });
});

describe('HTML floating-point lists', () => {
  it.each(['', '0', '1,-2,.5,1e+2'])(
    'accepts a conforming list: %j', (input) => {
      expect(isValidListOfFloatingPointNumbers(input)).toBe(true);
    },
  );

  it.each([',', '1,', ',1', '1,,2', '1, 2', '1;2', '1\n2', '+1,2', '1.e2,2', '1e9999'])(
    'rejects a nonconforming list: %j', (input) => {
      expect(isValidListOfFloatingPointNumbers(input)).toBe(false);
    },
  );

  it('accepts whitespace, commas, and semicolons as repeated delimiters', () => {
    expect(parseListOfFloatingPointNumbers(' \t,;1,, -2; .5\n3e2;')).toEqual([1, -2, 0.5, 300]);
    expect(parseListOfFloatingPointNumbers('')).toEqual([]);
    expect(parseListOfFloatingPointNumbers(' \t\n\f\r,;')).toEqual([]);
  });

  it('skips leading garbage but retains zero entries for failed parses', () => {
    expect(parseListOfFloatingPointNumbers('foo12,bar-3,+4,foo,.,1e9999,baz')).toEqual([12, -3, 4, 0, 0, 0, 0]);
    expect(parseListOfFloatingPointNumbers('1+2,1-2,1.2.3,1e+')).toEqual([1, 1, 1.2, 1]);
  });

  it('does not mistake non-ASCII whitespace for a delimiter', () => {
    expect(parseListOfFloatingPointNumbers('\u00a01,2\u00a03,\v4')).toEqual([1, 2, 4]);
  });
});

describe('HTML dimension lists', () => {
  it('keeps absolute, percentage, and relative units distinct', () => {
    expect(parseListOfDimensions('10, 25%, 2*, *')).toEqual([
      { value: 10, unit: DimensionUnit.Absolute },
      { value: 25, unit: DimensionUnit.Percentage },
      { value: 2, unit: DimensionUnit.Relative },
      { value: 0, unit: DimensionUnit.Relative },
    ]);
  });

  it('consumes the decimal point and permits whitespace inside the fraction', () => {
    expect(parseListOfDimensions('10.5%, 10. 5%, 10.05\r25*, .5%, 8.%')).toEqual([
      { value: 10.5, unit: DimensionUnit.Percentage },
      { value: 10.5, unit: DimensionUnit.Percentage },
      { value: 10.0525, unit: DimensionUnit.Relative },
      { value: 0.5, unit: DimensionUnit.Percentage },
      { value: 8, unit: DimensionUnit.Percentage },
    ]);
  });

  it('does not remove whitespace inside the integer or before the decimal point', () => {
    expect(parseListOfDimensions('1\n0.5%, 10 .5%')).toEqual([
      { value: 1, unit: DimensionUnit.Absolute },
      { value: 10, unit: DimensionUnit.Absolute },
    ]);
  });

  it('trims only ASCII whitespace and retains interior empty tokens', () => {
    expect(parseListOfDimensions(' \t10*\r,\n,\f25 % ,\u00a030%')).toEqual([
      { value: 10, unit: DimensionUnit.Relative },
      { value: 0, unit: DimensionUnit.Relative },
      { value: 25, unit: DimensionUnit.Percentage },
      { value: 0, unit: DimensionUnit.Absolute },
    ]);
    expect(parseListOfDimensions(' ')).toEqual([{ value: 0, unit: DimensionUnit.Relative }]);
  });

  it('removes the last comma before applying Infra comma splitting', () => {
    expect(parseListOfDimensions('')).toEqual([]);
    expect(parseListOfDimensions(',')).toEqual([]);
    expect(parseListOfDimensions(',,')).toEqual([{ value: 0, unit: DimensionUnit.Relative }]);
    expect(parseListOfDimensions('10,,')).toEqual([{ value: 10, unit: DimensionUnit.Absolute }]);
    expect(parseListOfDimensions('10,, ')).toEqual([
      { value: 10, unit: DimensionUnit.Absolute },
      { value: 0, unit: DimensionUnit.Relative },
      { value: 0, unit: DimensionUnit.Relative },
    ]);
  });

  it('recognizes units at the numeric prefix and ignores subsequent garbage', () => {
    expect(parseListOfDimensions('10.5%junk, 2*tail, 12e2%, +10%, -10%, %')).toEqual([
      { value: 10.5, unit: DimensionUnit.Percentage },
      { value: 2, unit: DimensionUnit.Relative },
      { value: 12, unit: DimensionUnit.Absolute },
      { value: 0, unit: DimensionUnit.Absolute },
      { value: 0, unit: DimensionUnit.Absolute },
      { value: 0, unit: DimensionUnit.Percentage },
    ]);
  });

  it('recovers an overflowing member as 0* without losing surrounding entries', () => {
    expect(parseListOfDimensions(`25%,${'9'.repeat(400)},2*`)).toEqual([
      { value: 25, unit: DimensionUnit.Percentage },
      { value: 0, unit: DimensionUnit.Relative },
      { value: 2, unit: DimensionUnit.Relative },
    ]);
  });

  it('converts the complete decimal without overflowing a fractional component', () => {
    expect(parseListOfDimensions(`10.${'5'.repeat(400)}%`)).toEqual([
      { value: 10.555555555555555, unit: DimensionUnit.Percentage },
    ]);
  });
});
