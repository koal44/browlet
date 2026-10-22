import { describe, expect, it } from 'vitest';
import { MixPercentages } from '../../../../../src/stylelet/values/collections/mix';

describe('MixPercentages', () => {
  it('completes and normalizes retained weights without changing the source array', () => {
    const percentages = [80, 80, undefined];
    const mix = new MixPercentages(percentages);

    expect(mix.percentages).toBe(percentages);
    expect(mix.complete()).toEqual([80, 80, 0]);
    expect(mix.normalize()).toEqual({ percentages: [50, 50, 0], leftover: 0 });
    expect(mix.complete()).toEqual([80, 80, 0]);
    expect(percentages).toEqual([80, 80, undefined]);
  });

  it.each([
    [[undefined, undefined], [50, 50]],
    [[40, undefined], [40, 60]],
    [[80, undefined, undefined], [80, 10, 10]],
    [[80, 80], [50, 50]],
    [[80, 80, undefined], [50, 50, 0]],
  ])(
    'normalizes the mix percentages %j',
    (percentages, normalized) => {
      expect(new MixPercentages(percentages).normalize()).toEqual({
        percentages: normalized,
        leftover: 0,
      });
    },
  );

  it('leaves a deficit for the notation-specific none value', () => {
    expect(new MixPercentages([30, 30]).normalize()).toEqual({
      percentages: [30, 30],
      leftover: 40,
    });
  });

  it('force-normalizes relative weights while retaining the deficit', () => {
    expect(new MixPercentages([30, 30]).normalize(true)).toEqual({
      percentages: [50, 50],
      leftover: 40,
    });
    expect(new MixPercentages([20, 30]).normalize(true)).toEqual({
      percentages: [40, 60],
      leftover: 50,
    });
  });

  it('does not force-normalize an all-zero mix', () => {
    expect(new MixPercentages([0, 0]).normalize(true)).toEqual({
      percentages: [0, 0],
      leftover: 100,
    });
  });
});
