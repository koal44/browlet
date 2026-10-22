import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { exerciseOrdinaryProperties, ordinaryPropertyExpectations } from '../../stylelet/ordinary-properties.contracts';

describe('ordinary property computation through bindings', () => {
  it.each(Object.keys(ordinaryPropertyExpectations) as (keyof typeof ordinaryPropertyExpectations)[])('%s', async (kind) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseOrdinaryProperties, kind)).toEqual(ordinaryPropertyExpectations[kind]);
  });
});
