import { describe, expect, it } from 'vitest';

import { parseHashNameReference } from '../../../../src/browlet/html/microsyntaxes/index';

describe('HTML hash-name reference parsing', () => {
  it.each([
    ['', null],
    ['target', null],
    ['#', null],
    ['prefix#', null],
    ['#target', 'target'],
    ['prefix#target', 'target'],
    ['https://other.example/#target', 'target'],
    [' \n#target', 'target'],
    ['#TARGET', 'TARGET'],
    ['#target ', 'target '],
    ['#%74arget', '%74arget'],
    ['#other#target', 'other#target'],
    ['##target', '#target'],
    ['# target ', ' target '],
    ['#café', 'café'],
    ['##', '#'],
  ] as const)('parses %j as %j without consulting a tree', (input, expected) => {
    expect(parseHashNameReference(input)).toBe(expected);
  });
});
