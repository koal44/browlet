import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { exerciseMargin, marginExpectations } from '../../stylelet/margin.contracts';

describe('margin through CSSOM bindings', () => {
  it.each(Object.keys(marginExpectations) as (keyof typeof marginExpectations)[])('%s', async (kind) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseMargin, kind)).toEqual(marginExpectations[kind]);
  });
});
