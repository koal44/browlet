import { describe, expect, it } from 'vitest';
import { normalizeMixPercentages } from '../../../../src/stylelet/values/mix';

describe('mix values', () => {
  it.each([
    [[undefined, undefined], [50, 50]],
    [[40, undefined], [40, 60]],
    [[80, undefined, undefined], [80, 10, 10]],
    [[80, 80], [50, 50]],
    [[80, 80, undefined], [50, 50, 0]],
  ])(
    'normalizes the mix percentages %j',
    (percentages, normalized) => {
      expect(normalizeMixPercentages(percentages)).toEqual({
        percentages: normalized,
        leftover: 0,
      });
    },
  );

  it('leaves a deficit for the notation-specific none value', () => {
    expect(normalizeMixPercentages([30, 30])).toEqual({
      percentages: [30, 30],
      leftover: 40,
    });
  });

  it('force-normalizes relative weights while retaining the deficit', () => {
    expect(normalizeMixPercentages([30, 30], true)).toEqual({
      percentages: [50, 50],
      leftover: 40,
    });
    expect(normalizeMixPercentages([20, 30], true)).toEqual({
      percentages: [40, 60],
      leftover: 50,
    });
  });

  it('does not force-normalize an all-zero mix', () => {
    expect(normalizeMixPercentages([0, 0], true)).toEqual({
      percentages: [0, 0],
      leftover: 100,
    });
  });
});
