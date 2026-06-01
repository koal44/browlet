import { describe, expect, it } from 'vitest';
import { parseSelectorList } from '../../src/parser/parser';
import { buildStrictSelectorListMatch, createBuildContext } from '../../src/planner/filter';

describe('buildStrictSelectorListMatch', () => {
  it('orders strict selector-list matcher arms by cost', () => {
    const list = parseSelectorList(':nth-of-type(9), [data-hot="yes"], #i9', {});
    const ctx = createBuildContext();

    const source = buildStrictSelectorListMatch(list, ctx);

    expect(source.indexOf('s.checkId')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('s.matchAttribute')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('s.isNthOfType')).toBeGreaterThanOrEqual(0);

    expect(source.indexOf('s.checkId)')).toBeLessThan(
      source.indexOf('s.matchAttribute'),
    );

    expect(source.indexOf('s.matchAttribute')).toBeLessThan(
      source.indexOf('s.isNthOfType'),
    );
  });

  it('orders compound candidate tests by cost', () => {
    const list = parseSelectorList(':nth-of-type(9)[data-hot="yes"]#i9', {});
    const ctx = createBuildContext();
    const source = buildStrictSelectorListMatch(list, ctx);

    const id = source.indexOf('s.checkId');
    const attr = source.indexOf('s.matchAttribute');
    const nth = source.indexOf('s.isNthOfType');

    expect(id).toBeGreaterThanOrEqual(0);
    expect(attr).toBeGreaterThanOrEqual(0);
    expect(nth).toBeGreaterThanOrEqual(0);

    expect(id).toBeLessThan(attr);
    expect(attr).toBeLessThan(nth);
  });
});

