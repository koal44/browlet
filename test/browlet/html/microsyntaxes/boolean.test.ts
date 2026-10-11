import { describe, expect, it } from 'vitest';

import {
  isValidBooleanAttributeValue, parseBooleanAttribute,
} from '../../../../src/browlet/html/microsyntaxes/index';

describe('HTML boolean attributes', () => {
  it('represents absence as false', () => {
    expect(parseBooleanAttribute(null)).toBe(false);
  });

  it.each(['', 'disabled', 'DISABLED', 'true', 'false', '0', ' ', '\0'])(
    'represents every present value as true: %j', (value) => {
      expect(parseBooleanAttribute(value)).toBe(true);
    },
  );

  it.each(['', 'disabled', 'DISABLED', 'DiSaBlEd'])(
    'accepts conforming spellings: %j', (value) => {
      expect(isValidBooleanAttributeValue(value, 'disabled')).toBe(true);
    },
  );

  it.each(['true', 'false', '0', ' disabled', 'disabled ', '\tdisabled', 'disabled\n', 'dısabled'])(
    'rejects invalid authoring syntax without changing its meaning: %j', (value) => {
      expect(isValidBooleanAttributeValue(value, 'disabled')).toBe(false);
      expect(parseBooleanAttribute(value)).toBe(true);
    },
  );

  it('compares the supplied canonical name with ASCII case folding only', () => {
    expect(isValidBooleanAttributeValue('disabled', 'DISABLED')).toBe(true);
    expect(isValidBooleanAttributeValue('K', 'k')).toBe(false);
  });
});
